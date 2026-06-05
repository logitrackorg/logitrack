import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Filter, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/utils/date";
import { vehicleApi, type Vehicle, type VehicleStatus, type VehicleStatusResponse, type VehicleType } from "../api/vehicles";
import { interBranchTripsApi, type InterBranchTrip } from "../api/interBranchTrips";
import { shipmentApi } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { usersApi, type UserProfile } from "../api/users";
import { useAuth } from "../context/AuthContext";
import { TopbarActions } from "../components/topbarContext";
import { Card } from "../components/ui/card";
import { SelectMenu } from "../components/ui/SelectMenu";

const inputClass =
  "h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)] transition-all";
const thClass = "px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider";
const tdClass = "px-4 py-3 text-slate-700";

const vehicleTypeLabels: Record<VehicleType, string> = {
  auto: "Auto",
  furgoneta: "Furgoneta",
  camion: "Camión",
};


const vehicleStatusLabels: Record<VehicleStatus, string> = {
  disponible: "Disponible",
  en_carga: "En carga",
  mantenimiento: "En mantenimiento",
  en_transito: "En tránsito",
  inactivo: "Inactivo",
};

function statusClasses(status: VehicleStatus) {
  switch (status) {
    case "disponible": return { bg: "bg-green-100", text: "text-green-700", dot: "bg-green-500", iconBg: "bg-green-50" };
    case "en_carga": return { bg: "bg-amber-100", text: "text-amber-700", dot: "bg-amber-500", iconBg: "bg-amber-50" };
    case "mantenimiento": return { bg: "bg-orange-100", text: "text-orange-700", dot: "bg-orange-500", iconBg: "bg-orange-50" };
    case "en_transito": return { bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500", iconBg: "bg-violet-50" };
    case "inactivo": return { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-500", iconBg: "bg-gray-50" };
    default: return { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400", iconBg: "bg-slate-50" };
  }
}

export function VehicleList() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [shipmentWeights, setShipmentWeights] = useState<Record<string, number>>({});
  const [activeLastMileTrips, setActiveLastMileTrips] = useState<InterBranchTrip[]>([]);
  const [activeInterBranchTrips, setActiveInterBranchTrips] = useState<InterBranchTrip[]>([]);
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleStatusResponse | null>(null);
  const [showVehicleDetail, setShowVehicleDetail] = useState(false);
  const [selectedForAssign, setSelectedForAssign] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | "">("");
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(false);
  const [plateSearch, setPlateSearch] = useState("");
  // End-trip modal
  const [showEndTripModal, setShowEndTripModal] = useState(false);
  const [endingTrip, setEndingTrip] = useState(false);
  // Receive trip modal (QR scan)
  // Load shipments modal
  const [loadModalVehicle, setLoadModalVehicle] = useState<Vehicle | null>(null);
  const [loadInput, setLoadInput] = useState("");
  const [loadAdded, setLoadAdded] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loadBusy, setLoadBusy] = useState(false);
  const { hasRole, user } = useAuth();

  const isAdmin = hasRole("admin");
  const canWrite = hasRole("admin") || hasRole("supervisor") || hasRole("operator");
  const canManageTrips = hasRole("supervisor") || hasRole("operator");
  const isOperator = user?.role === "operator";
  const hasBranchDefault = isOperator || user?.role === "supervisor";
  const [branchFilter, setBranchFilter] = useState(hasBranchDefault ? (user?.branch_id ?? "") : "");

  const [formData, setFormData] = useState({
    license_plate: "",
    type: "furgoneta" as VehicleType,
    mode: "ultima_milla" as import("../api/vehicles").VehicleMode,
    capacity_kg: 0,
    branch_id: "",
  });

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const data = await vehicleApi.list();
      setVehicles(data ?? []);

      // Load shipment weights for vehicles with assigned shipments
      const weights: Record<string, number> = {};
      const vehiclesWithShipments = (data ?? []).filter(v => (v.assigned_shipments ?? []).length > 0);
      if (vehiclesWithShipments.length > 0) {
        try {
          const shipments = await shipmentApi.list();
          const effectiveKg = (s: { weight_kg: number; corrections?: Record<string, string> }) => {
            const c = s.corrections?.weight_kg;
            if (c !== undefined) { const p = parseFloat(c); if (!isNaN(p)) return p; }
            return s.weight_kg;
          };
          const shipmentMap = new Map(shipments.map(s => [s.tracking_id, effectiveKg(s)]));
          for (const v of vehiclesWithShipments) {
            let totalWeight = 0;
            for (const tid of v.assigned_shipments ?? []) {
              totalWeight += shipmentMap.get(tid) ?? 0;
            }
            weights[v.license_plate] = totalWeight;
          }
        } catch (err) {
          console.error("Failed to load shipment weights:", err);
        }
      }
      setShipmentWeights(weights);

      // Fetch active last-mile trips and drivers in parallel for driver assignment display
      const [trips, driverList] = await Promise.all([
        interBranchTripsApi.listByBranch().catch(() => [] as InterBranchTrip[]),
        usersApi.listDrivers().catch(() => [] as UserProfile[]),
      ]);
      setActiveLastMileTrips(trips.filter(t => t.kind === "last_mile" && t.status !== "completado" && t.status !== "cancelado"));
      setActiveInterBranchTrips(trips.filter(t => t.kind === "inter_branch" && t.status !== "completado" && t.status !== "cancelado"));
      setDrivers(driverList);
    } catch (err) {
      console.error("Failed to load vehicles:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVehicles();
    // Load branches for display in the list
    branchApi.listActive().then(data => setBranches(data)).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!formData.license_plate.trim()) {
      setError("La patente es obligatoria");
      return;
    }
    if (formData.capacity_kg <= 0) {
      setError("La capacidad debe ser mayor a 0");
      return;
    }

    try {
      await vehicleApi.create(formData);
      setSuccess("Vehículo registrado correctamente");
      setShowForm(false);
      setFormData({ license_plate: "", type: "furgoneta", mode: "ultima_milla", capacity_kg: 0, branch_id: "" });
      loadVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 409) {
        setError("Ya existe un vehículo con esa patente");
      } else if (e.response?.data?.error) {
        setError(e.response.data.error);
      } else {
        setError("Error al registrar el vehículo");
      }
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setFormData({ license_plate: "", type: "furgoneta", mode: "ultima_milla", capacity_kg: 0, branch_id: "" });
    setError("");
    setSuccess("");
  };

  const handleViewVehicle = async (plate: string) => {
    try {
      const data = await vehicleApi.getByPlate(plate);
      setSelectedVehicle(data);
      setShowVehicleDetail(true);
    } catch (err) {
      console.error("Failed to load vehicle details:", err);
    }
  };

  const closeVehicleDetail = () => {
    setShowVehicleDetail(false);
    setSelectedVehicle(null);
  };

  const handleEndTrip = (plate: string) => {
    if (!plate) return;
    setSelectedForAssign(plate);
    setError("");
    setShowVehicleDetail(false);
    setSelectedVehicle(null);
    setShowEndTripModal(true);
  };

  const confirmEndTrip = async () => {
    if (!selectedForAssign) return;
    setEndingTrip(true);
    setError("");
    try {
      await vehicleApi.endTrip(selectedForAssign);
      setSuccess("Viaje finalizado. El vehículo está disponible.");
      setShowEndTripModal(false);
      setSelectedForAssign("");
      loadVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? "Error al finalizar el viaje");
    } finally {
      setEndingTrip(false);
    }
  };

  const vehicleCanEndTrip = (v: { status: VehicleStatus; destination_branch?: string | null }) => {
    if (!canManageTrips || v.status !== "en_transito") return false;
    if ((user?.role === "supervisor" || user?.role === "operator") && user.branch_id) {
      return v.destination_branch === user.branch_id;
    }
    return true;
  };

  const openLoadModal = (v: Vehicle) => {
    setLoadModalVehicle(v);
    setLoadAdded(v.assigned_shipments ?? []);
    setLoadInput("");
    setLoadError("");
  };

  const closeLoadModal = () => {
    setLoadModalVehicle(null);
    loadVehicles();
  };

const handleAddShipment = async () => {
    if (!loadModalVehicle || !loadInput.trim()) return;
    const trackingId = `LT-${loadInput.trim().toUpperCase()}`;
    setLoadBusy(true);
    setLoadError("");
    try {
      // Validar que el envío no esté en la sucursal de destino
      const shipment = await shipmentApi.get(trackingId);
      if (shipment.status === "at_hub" && shipment.current_location === shipment.final_branch_id) {
        setLoadError("El envío ya está en la sucursal de destino y no puede reenviarse a otra sucursal.");
        setLoadBusy(false);
        return;
      }
      const updated = await vehicleApi.assignToShipment(loadModalVehicle.license_plate, { tracking_id: trackingId });
      setLoadAdded(updated.assigned_shipments ?? []);
      setLoadModalVehicle(prev => prev ? { ...prev, assigned_shipments: updated.assigned_shipments, status: updated.status } : prev);
      setLoadInput("");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      const msg = err.response?.data?.error;
      setLoadError(msg ?? "No se pudo agregar el envío.");
    } finally {
      setLoadBusy(false);
    }
  };

  const [modeTab, setModeTab] = useState<"ultima_milla" | "inter_sucursal">("ultima_milla");

  // Filtrar vehículos
  const filteredVehicles = vehicles.filter((v) => {
    if (v.mode !== modeTab) return false;
    if (branchFilter && v.assigned_branch !== branchFilter && v.destination_branch !== branchFilter) return false;
    if (statusFilter && v.status !== statusFilter) return false;
    if (showOnlyAvailable && v.status !== "disponible") return false;
    if (plateSearch && !v.license_plate.toUpperCase().includes(plateSearch.toUpperCase())) return false;
    return true;
  });

  const countByMode = (mode: "ultima_milla" | "inter_sucursal") =>
    vehicles.filter((v) => {
      if (v.mode !== mode) return false;
      if (branchFilter && v.assigned_branch !== branchFilter && v.destination_branch !== branchFilter) return false;
      if (statusFilter && v.status !== statusFilter) return false;
      if (showOnlyAvailable && v.status !== "disponible") return false;
      if (plateSearch && !v.license_plate.toUpperCase().includes(plateSearch.toUpperCase())) return false;
      return true;
    }).length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {isAdmin && (
        <TopbarActions>
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-[var(--brand-strong)] hover:brightness-90 text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nuevo vehículo
          </button>
        </TopbarActions>
      )}

      {/* New Vehicle modal */}
      {showForm && isAdmin && (
        <div className="fixed inset-0 bg-black/45 z-[1000] flex items-center justify-center p-4"
          onClick={handleCancel}
        >
          <div className="bg-white rounded-xl p-6 max-w-[460px] w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-5">
              <h2 className="m-0 text-lg font-bold">Registrar nuevo vehículo</h2>
              <button onClick={handleCancel} className="bg-transparent border-none text-2xl cursor-pointer text-slate-600">✕</button>
            </div>

            {error && (
              <div className="px-3 py-2 rounded-md mb-3 text-sm bg-rose-50 border border-rose-200 text-rose-700">{error}</div>
            )}
            {success && (
              <div className="px-3 py-2 rounded-md mb-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-700">{success}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block mb-1.5 font-medium text-sm">Patente *</label>
                <input
                  type="text"
                  value={formData.license_plate}
                  onChange={(e) => setFormData({ ...formData, license_plate: e.target.value.toUpperCase() })}
                  placeholder="Ej.: AB123CD"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm uppercase box-border"
                />
              </div>
              <div className="mb-4">
                <label className="block mb-1.5 font-medium text-sm">Tipo *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as VehicleType })}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white box-border"
                >
                  {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block mb-1.5 font-medium text-sm">Modo *</label>
                <select
                  value={formData.mode}
                  onChange={(e) => setFormData({ ...formData, mode: e.target.value as import("../api/vehicles").VehicleMode })}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white box-border"
                >
                  <option value="ultima_milla">Última milla (entrega local)</option>
                  <option value="inter_sucursal">Inter-sucursal (transferencia)</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block mb-1.5 font-medium text-sm">Capacidad (kg) *</label>
                <input
                  type="number"
                  value={formData.capacity_kg || ""}
                  onChange={(e) => setFormData({ ...formData, capacity_kg: parseFloat(e.target.value) || 0 })}
                  placeholder="Ej.: 500"
                  min="1"
                  step="0.1"
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm box-border"
                />
              </div>
              <div className="mb-5">
                <label className="block mb-1.5 font-medium text-sm">Sucursal base *</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white box-border"
                >
                  <option value="">Seleccioná una sucursal...</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={handleCancel} className="px-4 py-2 rounded-md border-none cursor-pointer font-medium text-sm bg-slate-100 text-slate-800">
                  Cancelar
                </button>
                <button type="submit" className="px-4 py-2 rounded-md border-none cursor-pointer font-semibold text-sm text-white bg-[var(--brand-strong)]">
                  Registrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filtros */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="text"
            value={plateSearch}
            onChange={(e) => setPlateSearch(e.target.value)}
            placeholder="Buscar por patente…"
            className={`${inputClass} w-44 uppercase`}
          />
          <button
            onClick={() => { setShowOnlyAvailable(!showOnlyAvailable); setStatusFilter(""); }}
            className={`h-10 px-4 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
              showOnlyAvailable
                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {showOnlyAvailable ? "✓ Disponible" : "Disponible"}
          </button>

          {isOperator ? (
            <span className="h-10 inline-flex items-center px-3 rounded-lg bg-blue-50 border border-blue-200 text-sm font-medium text-[var(--brand-strong)]">
              {branches.find(b => b.id === branchFilter)?.name ?? branchFilter}
            </span>
          ) : (
            <SelectMenu
              value={branchFilter}
              onChange={setBranchFilter}
              placeholder="Todas las sucursales"
              ariaLabel="Filtrar por sucursal"
              className="w-[220px]"
              options={[...branches]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((b) => ({ value: b.id, label: `${b.name} — ${b.address.city}` }))}
            />
          )}

          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</span>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as VehicleStatus | ""); setShowOnlyAvailable(false); }}
            className={inputClass}
          >
            <option value="">Todos los estados</option>
            <option value="disponible">Disponible</option>
            <option value="en_carga">En carga</option>
            <option value="en_transito">En tránsito</option>
            <option value="mantenimiento">En mantenimiento</option>
            <option value="inactivo">Inactivo</option>
          </select>

          {(statusFilter || showOnlyAvailable || plateSearch || (!isOperator && branchFilter)) && (
            <button
              onClick={() => { setStatusFilter(""); setShowOnlyAvailable(false); setPlateSearch(""); if (!isOperator) setBranchFilter(hasBranchDefault ? (user?.branch_id ?? "") : ""); }}
              className="text-sm text-slate-500 hover:text-slate-700 underline cursor-pointer"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </Card>

      {/* Mensajes */}
      {error && (
        <div className="px-4 py-3 rounded-md mb-5 text-sm bg-rose-50 border border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      {success && (
        <div className="px-4 py-3 rounded-md mb-5 text-sm bg-emerald-50 border border-emerald-200 text-emerald-700">
          {success}
        </div>
      )}

      {/* Tabs por modo */}
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {(["ultima_milla", "inter_sucursal"] as const).map((mode) => {
          const label = mode === "ultima_milla" ? "Última milla" : "Inter-sucursal";
          const count = countByMode(mode);
          const active = modeTab === mode;
          return (
            <button
              key={mode}
              onClick={() => setModeTab(mode)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                active
                  ? "border-[var(--brand-strong)] text-[var(--brand-strong)]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${active ? "bg-[var(--brand-strong)] text-white" : "bg-slate-100 text-slate-600"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Lista de vehículos */}
      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : filteredVehicles.length === 0 ? (
        <Card className="p-10 text-center">
          <Filter className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Ningún vehículo coincide con los filtros seleccionados.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {filteredVehicles.length} {filteredVehicles.length !== 1 ? "vehículos" : "vehículo"} {showOnlyAvailable ? (filteredVehicles.length !== 1 ? "disponibles" : "disponible") : "en la flota"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50/50 text-left border-b border-slate-100">
                  <th className={thClass}>Patente</th>
                  <th className={thClass}>Tipo</th>
                  <th className={thClass}>Sucursal actual</th>
                  {modeTab === "inter_sucursal" && <th className={thClass}>Sucursal destino</th>}
                  {modeTab === "inter_sucursal" && <th className={thClass}>Chofer asignado</th>}
                  {modeTab === "ultima_milla" && <th className={thClass}>Chofer asignado</th>}
                  <th className={thClass}>Capacidad</th>
                  <th className={thClass}>Cap. disponible</th>
                  <th className={thClass}>Estado</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((v) => {
                  const assignedBranch = v.assigned_branch ? branches.find(b => b.id === v.assigned_branch) : null;
                  const destinationBranch = v.destination_branch ? branches.find(b => b.id === v.destination_branch) : null;
                  const assignedWeight = shipmentWeights[v.license_plate];
                  const available = assignedWeight !== undefined
                    ? Math.max(0, v.capacity_kg - assignedWeight)
                    : v.capacity_kg;
                  const hasAssignment = assignedWeight !== undefined;
                  const availableColor = available > 0 ? "text-emerald-600" : "text-rose-600";
                  return (
                    <tr
                      key={v.id}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("button, a")) return;
                        handleViewVehicle(v.license_plate);
                      }}
                      className="border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50"
                    >
                      <td className={tdClass}>
                        <code className="text-xs font-mono font-semibold text-slate-700">{v.license_plate}</code>
                      </td>
                      <td className={tdClass}>{vehicleTypeLabels[v.type]}</td>
                      <td className={tdClass}>
                        {assignedBranch ? (
                          <span className="text-[var(--brand-strong)] font-medium">{assignedBranch.name}</span>
                        ) : (
                          <span className="text-slate-400 italic">Sin sucursal</span>
                        )}
                      </td>
                      {modeTab === "inter_sucursal" && (
                        <td className={tdClass}>
                          {destinationBranch ? (
                            <span className="text-[var(--brand-strong)] font-medium">{destinationBranch.name}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      {modeTab === "inter_sucursal" && (() => {
                        const trip = activeInterBranchTrips.find(t => t.vehicle_id === v.id);
                        const driver = trip?.driver_id ? drivers.find(d => d.id === trip.driver_id) : null;
                        return (
                          <td className={tdClass}>
                            {driver ? (
                              <span className="text-slate-800 font-medium">{driver.full_name}</span>
                            ) : trip ? (
                              <span className="text-amber-600 text-xs font-medium">Sin reclamar</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        );
                      })()}
                      {modeTab === "ultima_milla" && (() => {
                        const trip = activeLastMileTrips.find(t => t.vehicle_id === v.id);
                        const driver = trip?.driver_id ? drivers.find(d => d.id === trip.driver_id) : null;
                        return (
                          <td className={tdClass}>
                            {driver ? (
                              <span className="text-slate-800 font-medium">{driver.full_name}</span>
                            ) : trip ? (
                              <span className="text-amber-600 text-xs font-medium">Sin reclamar</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        );
                      })()}
                      <td className={tdClass}>
                        <span className="tabular-nums">{v.capacity_kg} kg</span>
                      </td>
                      <td className={tdClass}>
                        <span className={`tabular-nums ${availableColor} ${hasAssignment ? "font-semibold" : ""}`}>
                          {available.toFixed(1)} kg
                        </span>
                      </td>
                      <td className={tdClass}>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusClasses(v.status).bg} ${statusClasses(v.status).text}`}>
                          <span className={`w-2 h-2 rounded-full ${statusClasses(v.status).dot}`} />
                          {vehicleStatusLabels[v.status]}
                        </span>
                      </td>
                      <td className={tdClass}>
                        {hasRole("operator", "supervisor") && (v.status === "disponible" || v.status === "en_carga") && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openLoadModal(v); }}
                            className="inline-flex items-center h-8 px-3 rounded-md bg-[var(--brand-strong)] hover:brightness-90 text-white text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer"
                          >
                            Cargar envíos
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal de detalle de vehículo */}
      {showVehicleDetail && selectedVehicle && (
        <VehicleDetailModal
          vehicle={selectedVehicle}
          onClose={closeVehicleDetail}
          onRefresh={loadVehicles}
          readOnly={!canWrite}
          canAssignBranch={isAdmin}
          hideShipments={isAdmin}
          canEndTrip={vehicleCanEndTrip(selectedVehicle)}
          onEndTrip={() => handleEndTrip(selectedVehicle.license_plate)}
        />
      )}

      {/* Load Shipments modal */}
      {loadModalVehicle && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center"
          onClick={closeLoadModal}>
          <div className="bg-white rounded-xl p-7 w-[480px] max-w-[95vw] max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-5">
              <div>
                <h2 className="m-0 text-lg text-slate-900">Cargar envíos</h2>
                <p className="mt-1 text-xs text-slate-600">
                  <code className="font-bold">{loadModalVehicle.license_plate}</code>
                  {" · "}{vehicleTypeLabels[loadModalVehicle.type]}
                  {" · "}{loadModalVehicle.capacity_kg} kg de capacidad
                </p>
              </div>
              <button onClick={closeLoadModal} className="bg-transparent border-none text-2xl cursor-pointer text-slate-600">✕</button>
            </div>

            {/* Already loaded */}
            {loadAdded.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-800 m-0 mb-2">
                  Envíos cargados ({loadAdded.length}):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {loadAdded.map(tid => (
                    <span key={tid} className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700">
                      {tid}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <p className="text-xs font-semibold text-slate-800 m-0 mb-2">Agregar envío:</p>
            <div className="flex gap-2 items-center">
              <span className="text-sm font-bold text-slate-600 whitespace-nowrap">LT-</span>
              <input
                autoFocus
                value={loadInput}
                onChange={e => { setLoadInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setLoadError(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleAddShipment(); }}
                placeholder="A1B2C3D4"
                maxLength={20}
                className="flex-1 px-3 py-2 rounded-md border border-slate-300 text-sm font-mono tracking-wide"
              />
              <button
                onClick={handleAddShipment}
                disabled={loadBusy || !loadInput.trim()}
                className={`px-4 py-2 rounded-md border-none font-semibold text-sm text-white bg-[var(--brand-strong)] ${
                  loadBusy || !loadInput.trim() ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                {loadBusy ? "Agregando…" : "Agregar"}
              </button>
            </div>
            {loadError && (
              <p className="mt-2 text-xs text-rose-700">{loadError}</p>
            )}

            <div className="mt-5 flex justify-end">
              <button onClick={closeLoadModal}
                className="px-5 py-2 rounded-md border-none cursor-pointer font-semibold text-sm bg-slate-100 text-slate-800">
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Trip modal */}
      {/* End Trip confirmation modal */}
      {showEndTripModal && (() => {
        const vehicle = vehicles.find(v => v.license_plate === selectedForAssign);
        const numShipments = vehicle?.assigned_shipments?.length ?? 0;
        const destBranch = vehicle?.destination_branch ? branches.find(b => b.id === vehicle.destination_branch) : null;
        return (
          <div
            className="fixed inset-0 bg-black/45 z-[1000] flex items-center justify-center p-4"
            onClick={() => !endingTrip && setShowEndTripModal(false)}
          >
            <div
              className="bg-white rounded-xl p-6 max-w-[440px] w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-bold m-0">Finalizar viaje</h2>
                <button onClick={() => !endingTrip && setShowEndTripModal(false)}
                  className={`bg-transparent border-none text-2xl ${endingTrip ? "cursor-not-allowed" : "cursor-pointer"} text-slate-600`}>✕</button>
              </div>
              <p className="text-sm text-slate-800 m-0 mb-3">
                ¿Confirmás finalizar el viaje del vehículo <strong>{selectedForAssign}</strong>?
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 text-xs text-slate-800">
                <p className="m-0 mb-1.5">
                  • Los {numShipments} envío{numShipments !== 1 ? "s" : ""} pasarán al estado <strong>En sucursal</strong>{destBranch ? <> en <strong>{destBranch.name}</strong></> : ""}.
                </p>
                <p className="m-0">
                  • El vehículo quedará <strong>Disponible</strong>.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowEndTripModal(false)}
                  disabled={endingTrip}
                  className={`px-4 py-2 rounded-md border font-medium text-sm ${
                    endingTrip ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                  } border-slate-200 bg-white text-slate-800`}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmEndTrip}
                  disabled={endingTrip}
                  className={`px-5 py-2 rounded-md border-none font-semibold text-white text-sm ${
                    endingTrip ? "opacity-70 cursor-not-allowed bg-slate-400" : "cursor-pointer bg-rose-600"
                  }`}
                >
                  {endingTrip ? "Finalizando..." : "Finalizar viaje"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Vehicle Detail Modal Component
const MANUAL_STATUSES: { value: VehicleStatus; label: string }[] = [
  { value: "disponible", label: "Disponible" },
  { value: "mantenimiento", label: "En mantenimiento" },
  { value: "inactivo", label: "Inactivo" },
];

export function VehicleDetailModal({ vehicle, onClose, onRefresh, readOnly, canAssignBranch, hideShipments, canEndTrip, onEndTrip }: { vehicle: VehicleStatusResponse; onClose: () => void; onRefresh?: () => void; readOnly?: boolean; canAssignBranch?: boolean; hideShipments?: boolean; canEndTrip?: boolean; onEndTrip?: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [assigningBranch, setAssigningBranch] = useState(false);
  const [branchError, setBranchError] = useState("");
  const [branchSuccess, setBranchSuccess] = useState("");
  const [unassigning, setUnassigning] = useState<string | null>(null);
  const [unassignAllBusy, setUnassignAllBusy] = useState(false);
  const [showUnassignAllConfirm, setShowUnassignAllConfirm] = useState(false);
  const [unassignError, setUnassignError] = useState("");
  const [currentShipments, setCurrentShipments] = useState<string[]>(vehicle.assigned_shipments ?? []);
  const [currentStatus, setCurrentStatus] = useState<VehicleStatus>(vehicle.status);
  const [selectedStatus, setSelectedStatus] = useState<VehicleStatus | "">("");
  const [statusNotes, setStatusNotes] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusSuccess, setStatusSuccess] = useState("");

  const hasShipments = currentShipments.length > 0;

  useEffect(() => {
    const loadBranches = async () => {
      try {
        const data = await branchApi.listActive();
        setBranches(data);
      } catch (err) {
        console.error("Failed to load branches:", err);
      }
    };
    loadBranches();
  }, []);

  const handleAssignBranch = async () => {
    if (!selectedBranch) {
      setBranchError("Seleccioná una sucursal");
      return;
    }
    setAssigningBranch(true);
    setBranchError("");
    setBranchSuccess("");
    try {
      await vehicleApi.assignBranch(vehicle.license_plate, { branch_id: selectedBranch });
      setBranchSuccess("Sucursal asignada correctamente");
      setSelectedBranch("");
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBranchError(e.response?.data?.error || "Error al asignar la sucursal");
    } finally {
      setAssigningBranch(false);
    }
  };

  const handleUnassign = async (trackingId: string) => {
    setUnassigning(trackingId);
    setUnassignError("");
    try {
      const updated = await vehicleApi.unassignShipment(vehicle.license_plate, trackingId);
      setCurrentShipments(updated.assigned_shipments ?? []);
      setCurrentStatus(updated.status);
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUnassignError(e.response?.data?.error || "Error al desasignar el envío");
    } finally {
      setUnassigning(null);
    }
  };

  const handleUnassignAll = async () => {
    if (currentShipments.length === 0) return;
    setShowUnassignAllConfirm(false);
    setUnassignAllBusy(true);
    setUnassignError("");
    let lastStatus: VehicleStatus = currentStatus;
    let remaining = [...currentShipments];
    try {
      for (const trackingId of currentShipments) {
        const updated = await vehicleApi.unassignShipment(vehicle.license_plate, trackingId);
        remaining = updated.assigned_shipments ?? [];
        lastStatus = updated.status;
        setCurrentShipments(remaining);
        setCurrentStatus(lastStatus);
      }
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUnassignError(e.response?.data?.error || "Error al desasignar los envíos");
      onRefresh?.();
    } finally {
      setUnassignAllBusy(false);
    }
  };

  const handleStatusChange = async () => {
    if (!selectedStatus) return;
    setStatusBusy(true);
    setStatusError("");
    setStatusSuccess("");
    try {
      const updated = await vehicleApi.updateStatus(vehicle.license_plate, {
        status: selectedStatus,
        notes: statusNotes.trim() || undefined,
        force: currentShipments.length > 0,
      });
      setCurrentStatus(updated.status);
      setSelectedStatus("");
      setStatusNotes("");
      setStatusSuccess(`Estado actualizado a ${vehicleStatusLabels[updated.status]}`);
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setStatusError(e.response?.data?.error ?? "Error al actualizar el estado");
    } finally {
      setStatusBusy(false);
    }
  };

  const [qrBase64, setQrBase64] = useState<string | null>(null);

  useEffect(() => {
    vehicleApi.getQR(vehicle.license_plate)
      .then(r => setQrBase64(r.qr_png_base64))
      .catch((err) => { console.error("QR fetch failed:", err?.response?.status, err?.response?.data); setQrBase64(null); });
  }, [vehicle.license_plate]);

  const currentBranch = branches.find(b => b.id === vehicle.assigned_branch);
  const sClasses = statusClasses(vehicle.status);
  return (
    <Dialog open onClose={onClose}>
      <DialogContent className="max-w-[560px]">
        <div className="px-6">
        <div className="flex justify-between items-center mb-5">
          <div>
            <p className="text-xs text-[var(--text-secondary)] m-0 uppercase">Detalle del vehículo</p>
            <h2 className="text-2xl font-bold mt-1 text-[var(--text-primary)]">
              {vehicle.license_plate}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer shrink-0 rounded-md p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors duration-200"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${sClasses.iconBg}`}>
            <svg className={`w-7 h-7 ${sClasses.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${sClasses.bg} ${sClasses.text}`}>
                {vehicleStatusLabels[vehicle.status]}
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              ID: #{vehicle.id}
            </p>
          </div>
        </div>

        <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-4 mb-5">
          <h3 className="text-sm font-semibold text-[var(--text-strong)] m-0 mb-3">Información del vehículo</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-[var(--text-secondary)] m-0 mb-0.5">Tipo</p>
              <p className="text-sm font-semibold text-[var(--text-primary)] m-0">{vehicleTypeLabels[vehicle.type]}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-secondary)] m-0 mb-0.5">Capacidad</p>
              <p className="text-sm font-semibold text-[var(--text-primary)] m-0">{vehicle.capacity_kg} kg</p>
            </div>
            {vehicle.updated_at && (
              <div>
                <p className="text-xs text-[var(--text-secondary)] m-0 mb-0.5">Última actualización</p>
                <p className="text-sm font-medium text-[var(--text-strong)] m-0">
                  {fmtDateTime(vehicle.updated_at)}
                </p>
              </div>
            )}
            {vehicle.updated_by && (
              <div>
                <p className="text-xs text-[var(--text-secondary)] m-0 mb-0.5">Actualizado por</p>
                <p className="text-sm font-medium text-[var(--text-strong)] m-0">{vehicle.updated_by}</p>
              </div>
            )}
          </div>
        </div>

        {/* Acciones de viaje — operador / supervisor de la sucursal correspondiente */}
        {!readOnly && canEndTrip && (
          <div className="mb-4">
            <Button variant="destructive" onClick={onEndTrip} className="w-full">
              Finalizar viaje
            </Button>
          </div>
        )}

        {/* Cambio de estado — solo admin */}
        {!readOnly && hideShipments && (
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-4 mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-strong)] m-0 mb-3">Cambiar estado</h3>

            {["en_carga", "en_transito"].includes(currentStatus) && (
              <div className="px-3 py-2 rounded-md mb-2.5 text-xs bg-[var(--warn-bg)] border border-[var(--warn-border)] text-[var(--warn-text)]">
                El estado <strong>{vehicleStatusLabels[currentStatus]}</strong> es gestionado automáticamente por las operaciones de viaje y no puede cambiarse de forma manual.
              </div>
            )}

            {!["en_carga", "en_transito"].includes(currentStatus) && (
              <>
                {currentShipments.length > 0 && (
                  <div className="px-3 py-2 rounded-md mb-2.5 text-xs bg-[var(--warn-bg)] border border-[var(--warn-border)] text-[var(--warn-text)]">
                    Este vehículo tiene {currentShipments.length} envío{currentShipments.length !== 1 ? "s" : ""} asignado{currentShipments.length !== 1 ? "s" : ""}. El cambio de estado se aplicará de forma forzada.
                  </div>
                )}
                {statusError && (
                  <div className="px-3 py-2 rounded-md mb-2 text-xs bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)]">{statusError}</div>
                )}
                {statusSuccess && (
                  <div className="px-3 py-2 rounded-md mb-2 text-xs bg-[var(--ok-bg)] border border-[var(--ok-border)] text-[var(--ok-text)]">{statusSuccess}</div>
                )}
                <select
                  value={selectedStatus}
                  onChange={(e) => { setSelectedStatus(e.target.value as VehicleStatus | ""); setStatusError(""); setStatusSuccess(""); }}
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm bg-[var(--bg-card)] text-[var(--text-primary)] mb-2"
                >
                  <option value="">Seleccioná el nuevo estado…</option>
                  {MANUAL_STATUSES.filter(s => s.value !== currentStatus).map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={statusNotes}
                  onChange={(e) => setStatusNotes(e.target.value)}
                  placeholder="Notas (opcional)"
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm mb-2 box-border bg-[var(--bg-card)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
                <Button
                  onClick={handleStatusChange}
                  disabled={!selectedStatus || statusBusy}
                  className="w-full"
                >
                  {statusBusy ? "Actualizando…" : "Actualizar estado"}
                </Button>
              </>
            )}
          </div>
        )}

          {/* Branch asignado */}
        <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-[var(--text-strong)] m-0 mb-3">Sucursal actual</h3>
          {currentBranch ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 mb-0">
              <p className="text-base font-bold text-[var(--text-primary)] m-0">
                {currentBranch.name}
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {currentBranch.address.city}, {currentBranch.province}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-secondary)] m-0">Sin sucursal asignada</p>
          )}

          {!hasShipments && canAssignBranch && (
            <>
              {branchError && (
                <div className="px-3 py-2 rounded-md mb-2 text-xs bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)]">{branchError}</div>
              )}
              {branchSuccess && (
                <div className="px-3 py-2 rounded-md mb-2 text-xs bg-[var(--ok-bg)] border border-[var(--ok-border)] text-[var(--ok-text)]">{branchSuccess}</div>
              )}
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-[var(--border-strong)] text-sm bg-[var(--bg-card)] text-[var(--text-primary)] mb-2"
              >
                <option value="">Cambiar sucursal...</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                ))}
              </select>
              <Button
                onClick={handleAssignBranch}
                disabled={assigningBranch || !selectedBranch}
                className="w-full"
              >
                {assigningBranch ? "Asignando..." : "Asignar sucursal"}
              </Button>
            </>
          )}
        </div>

        {/* Envíos asignados */}
        {!hideShipments && <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-[var(--text-strong)] m-0">Envíos asignados</h3>
            {!readOnly && currentStatus === "en_carga" && currentShipments.length > 1 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowUnassignAllConfirm(true)}
                disabled={unassignAllBusy || unassigning !== null}
              >
                {unassignAllBusy ? "Desasignando…" : "Desasignar todos"}
              </Button>
            )}
          </div>
          {unassignError && (
            <div className="px-3 py-2 rounded-md mb-2 text-xs bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-text)]">{unassignError}</div>
          )}
          {currentShipments.length > 0 ? (
            <div className="flex flex-col gap-2">
              {currentShipments.map((trackingId) => (
                <div
                  key={trackingId}
                  className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-base font-bold text-[var(--text-primary)] m-0">
                      {trackingId}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      ID de seguimiento
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Link
                      to={`/shipments/${trackingId}`}
                      className="px-3 py-1.5 rounded-md text-xs font-medium text-white bg-[var(--brand-strong)] no-underline"
                      onClick={onClose}
                    >
                      Ver
                    </Link>
                    {!readOnly && currentStatus === "en_carga" && (
                      <button
                        onClick={() => handleUnassign(trackingId)}
                        disabled={unassigning === trackingId || unassignAllBusy}
                        title="Desasignar envío"
                        className={`w-8 h-8 rounded-md border text-base font-bold flex items-center justify-center shrink-0 ${
                          unassigning === trackingId || unassignAllBusy
                            ? "bg-slate-100 text-rose-700 border-rose-200 cursor-not-allowed opacity-50"
                            : "bg-rose-50 text-rose-700 border-rose-200 cursor-pointer"
                        }`}
                      >
                        {unassigning === trackingId ? "…" : "✕"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-5 text-[var(--text-secondary)]">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-sm m-0">Sin envíos asignados</p>
              <p className="text-xs mt-1 text-[var(--text-muted)]">Este vehículo no tiene envíos cargados</p>
            </div>
          )}
        </div>}

        {/* QR del vehículo */}
        {qrBase64 && (
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-4 mt-4 text-center">
            <h3 className="text-sm font-semibold text-[var(--text-strong)] m-0 mb-3">Código QR del vehículo</h3>
            <p className="text-xs text-[var(--text-secondary)] m-0 mb-3">
              El chofer escanea este QR para reclamar el viaje del día.
            </p>
            <img
              src={`data:image/png;base64,${qrBase64}`}
              alt={`QR ${vehicle.license_plate}`}
              className="w-40 h-40 block mx-auto [image-rendering:pixelated]"
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-2.5 font-mono">{vehicle.license_plate}</p>
          </div>
        )}
        </div>
      </DialogContent>
      {showUnassignAllConfirm && (
      <Dialog open onClose={() => !unassignAllBusy && setShowUnassignAllConfirm(false)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader onClose={() => !unassignAllBusy && setShowUnassignAllConfirm(false)}>
            <DialogTitle>Desasignar todos los envíos</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-2">
            <p className="text-sm text-[var(--text-strong)] m-0 mb-3">
              ¿Confirmás desasignar los <strong>{currentShipments.length} envíos</strong> cargados en el vehículo <strong>{vehicle.license_plate}</strong>?
            </p>
            <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-lg p-3 mb-4 text-xs text-[var(--text-strong)]">
              <p className="m-0 mb-1.5">• Los envíos volverán al estado <strong>En sucursal</strong>.</p>
              <p className="m-0">• El vehículo quedará <strong>Disponible</strong>.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUnassignAllConfirm(false)} disabled={unassignAllBusy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleUnassignAll} disabled={unassignAllBusy}>
              {unassignAllBusy ? "Desasignando…" : "Confirmar desasignación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </Dialog>
  );
}