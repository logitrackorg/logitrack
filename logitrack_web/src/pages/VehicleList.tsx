import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { vehicleApi, type Vehicle, type VehicleStatus, type VehicleStatusResponse, type VehicleType } from "../api/vehicles";
import { shipmentApi } from "../api/shipments";
import { branchApi, type Branch, type BranchCapacity } from "../api/branches";
import { useAuth } from "../context/AuthContext";

const vehicleTypeLabels: Record<VehicleType, string> = {
  motocicleta: "Motocicleta",
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

const getStatusColor = (status: VehicleStatus): string => {
  switch (status) {
    case "disponible":
      return "#10b981";
    case "en_carga":
      return "#f59e0b";
    case "mantenimiento":
      return "#f97316";
    case "en_transito":
      return "#3b82f6";
    case "inactivo":
      return "#6b7280";
    default:
      return "#9ca3af";
  }
};

export function VehicleList() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [shipmentWeights, setShipmentWeights] = useState<Record<string, number>>({});
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
  // Start-trip modal
  const [showStartTripModal, setShowStartTripModal] = useState(false);
  const [startTripDestBranch, setStartTripDestBranch] = useState("");
  const [startingTrip, setStartingTrip] = useState(false);
  const [startTripCapacity, setStartTripCapacity] = useState<BranchCapacity | null>(null);
  const [startTripCapacityLoading, setStartTripCapacityLoading] = useState(false);
  const [startTripCapacityConfirmed, setStartTripCapacityConfirmed] = useState(false);
  // Load shipments modal
  const [loadModalVehicle, setLoadModalVehicle] = useState<Vehicle | null>(null);
  const [loadInput, setLoadInput] = useState("");
  const [loadAdded, setLoadAdded] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loadBusy, setLoadBusy] = useState(false);
  const { hasRole, user } = useAuth();

  const isAdmin = hasRole("admin");
  const canWrite = hasRole("admin") || hasRole("supervisor");
  const canManageTrips = hasRole("supervisor");
  const isOperator = user?.role === "operator";
  const hasBranchDefault = isOperator || user?.role === "supervisor";
  const [branchFilter, setBranchFilter] = useState(hasBranchDefault ? (user?.branch_id ?? "") : "");

  const [formData, setFormData] = useState({
    license_plate: "",
    type: "furgoneta" as VehicleType,
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
      setFormData({ license_plate: "", type: "furgoneta", capacity_kg: 0, branch_id: "" });
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
    setFormData({ license_plate: "", type: "furgoneta", capacity_kg: 0, branch_id: "" });
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

  const handleStartTrip = async () => {
    if (!selectedForAssign) {
      setError("Debés seleccionar un vehículo");
      return;
    }
    setStartTripDestBranch("");
    setStartTripCapacity(null);
    setStartTripCapacityConfirmed(false);
    setShowStartTripModal(true);
  };

  const handleStartTripBranchChange = async (branchId: string) => {
    setStartTripDestBranch(branchId);
    setStartTripCapacity(null);
    setStartTripCapacityConfirmed(false);
    if (!branchId) return;
    setStartTripCapacityLoading(true);
    try {
      const cap = await branchApi.getCapacity(branchId);
      setStartTripCapacity(cap);
    } catch {
      setStartTripCapacity(null);
    } finally {
      setStartTripCapacityLoading(false);
    }
  };

  const confirmStartTrip = async () => {
    if (!selectedForAssign || !startTripDestBranch) return;
    setStartingTrip(true);
    setError("");
    try {
      await vehicleApi.startTrip(selectedForAssign, { destination_branch: startTripDestBranch });
      setSuccess("Viaje iniciado. Todos los envíos están ahora en tránsito.");
      setShowStartTripModal(false);
      setSelectedForAssign("");
      loadVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? "Error al iniciar el viaje");
    } finally {
      setStartingTrip(false);
    }
  };

  const handleEndTrip = async () => {
    if (!selectedForAssign) {
      setError("Debés seleccionar un vehículo");
      return;
    }

    setError("");
    try {
      // Call the end-trip endpoint to clear shipment, destination_branch and change status to available
      await vehicleApi.endTrip(selectedForAssign);
      setSuccess("Viaje finalizado. El vehículo está disponible.");
      setSelectedForAssign("");
      loadVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      if (e.response?.data?.error) {
        setError(e.response.data.error);
      } else {
        setError("Error al finalizar el viaje");
      }
    }
  };

  // Check if the selected vehicle can start trip (status is "en_carga" and supervisor matches current branch)
  const canStartTrip = () => {
    if (!selectedForAssign) return false;
    const vehicle = vehicles.find(v => v.license_plate === selectedForAssign);
    if (!vehicle || vehicle.status !== "en_carga") return false;
    if (user?.role === "supervisor" && user.branch_id) {
      return vehicle.assigned_branch === user.branch_id;
    }
    return true;
  };

  // Check if the selected vehicle can end trip (status is "en_transito" and supervisor matches destination branch)
  const canEndTrip = () => {
    if (!selectedForAssign) return false;
    const vehicle = vehicles.find(v => v.license_plate === selectedForAssign);
    if (!vehicle || vehicle.status !== "en_transito") return false;
    if (user?.role === "supervisor" && user.branch_id) {
      return vehicle.destination_branch === user.branch_id;
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
      const updated = await vehicleApi.assignToShipment(loadModalVehicle.license_plate, { tracking_id: trackingId });
      setLoadAdded(updated.assigned_shipments ?? []);
      setLoadModalVehicle(prev => prev ? { ...prev, assigned_shipments: updated.assigned_shipments, status: updated.status } : prev);
      setLoadInput("");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setLoadError(msg ?? "No se pudo agregar el envío.");
    } finally {
      setLoadBusy(false);
    }
  };

  // Filtrar vehículos
  const filteredVehicles = vehicles.filter((v) => {
    if (branchFilter && v.assigned_branch !== branchFilter && v.destination_branch !== branchFilter) return false;
    if (statusFilter && v.status !== statusFilter) return false;
    if (showOnlyAvailable && v.status !== "disponible") return false;
    if (plateSearch && !v.license_plate.toUpperCase().includes(plateSearch.toUpperCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Gestión de flota</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {isAdmin && (
            <button
              onClick={() => setShowForm(!showForm)}
              style={{
                background: "#1e3a5f",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              + Nuevo vehículo
            </button>
          )}
        </div>
      </div>

      {/* New Vehicle modal */}
      {showForm && isAdmin && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={handleCancel}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 460, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Registrar nuevo vehículo</h2>
              <button onClick={handleCancel} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 14 }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 14 }}>
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Patente *</label>
                <input
                  type="text"
                  value={formData.license_plate}
                  onChange={(e) => setFormData({ ...formData, license_plate: e.target.value.toUpperCase() })}
                  placeholder="Ej.: AB123CD"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, textTransform: "uppercase", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Tipo *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as VehicleType })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff", boxSizing: "border-box" }}
                >
                  {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Capacidad (kg) *</label>
                <input
                  type="number"
                  value={formData.capacity_kg || ""}
                  onChange={(e) => setFormData({ ...formData, capacity_kg: parseFloat(e.target.value) || 0 })}
                  placeholder="Ej.: 500"
                  min="1"
                  step="0.1"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Sucursal base *</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  required
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff", boxSizing: "border-box" }}
                >
                  <option value="">Seleccioná una sucursal...</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={handleCancel} style={{ background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 500 }}>
                  Cancelar
                </button>
                <button type="submit" style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 600 }}>
                  Registrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <input
          type="text"
          value={plateSearch}
          onChange={(e) => setPlateSearch(e.target.value)}
          placeholder="Buscar por patente..."
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14,
            width: 160,
            textTransform: "uppercase",
          }}
        />
        <button
          onClick={() => { setShowOnlyAvailable(!showOnlyAvailable); setStatusFilter(""); }}
          style={{
            background: showOnlyAvailable ? "#10b981" : "#e5e7eb",
            color: showOnlyAvailable ? "#fff" : "#374151",
            border: "none",
            borderRadius: 6,
            padding: "6px 14px",
            cursor: "pointer",
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          {showOnlyAvailable ? "✓ Disponible" : "Disponible"}
        </button>
        {/* Branch filter */}
        {isOperator ? (
          <span style={{ padding: "6px 12px", background: "#f0f9ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 14, color: "#1e3a5f", fontWeight: 500 }}>
            {branches.find(b => b.id === branchFilter)?.name ?? branchFilter}
          </span>
        ) : (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" }}
          >
            <option value="">Todas las sucursales</option>
            {[...branches].sort((a, b) => a.name.localeCompare(b.name)).map(b => (
              <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: 14, fontWeight: 500, color: "#374151" }}>Filtrar por estado:</span>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as VehicleStatus | ""); setShowOnlyAvailable(false); }}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14,
            background: "#fff",
          }}
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
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 14,
              textDecoration: "underline",
            }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Mensajes */}
      {error && (
        <div style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#dc2626",
          padding: "12px 16px",
          borderRadius: 6,
          marginBottom: 20,
          fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          color: "#16a34a",
          padding: "12px 16px",
          borderRadius: 6,
          marginBottom: 20,
          fontSize: 14,
        }}>
          {success}
        </div>
      )}

      {/* Lista de vehículos */}
      {loading ? (
        <p>Cargando...</p>
      ) : filteredVehicles.length === 0 ? (
        <p style={{ color: "#6b7280" }}>Ningún vehículo coincide con los filtros seleccionados.</p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
              {filteredVehicles.length} vehículo{filteredVehicles.length !== 1 ? "s" : ""} {showOnlyAvailable ? "disponible" + (filteredVehicles.length !== 1 ? "s" : "") : "en la flota"}
            </p>
          </div>
          {canManageTrips && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleStartTrip}
                  disabled={!canStartTrip()}
                  style={{
                    background: canStartTrip() ? "#3b82f6" : "#9ca3af",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 20px",
                    cursor: canStartTrip() ? "pointer" : "not-allowed",
                    fontWeight: 600,
                    opacity: canStartTrip() ? 1 : 0.6,
                    fontSize: 14,
                  }}
                >
                  Iniciar viaje
                </button>
                <button
                  onClick={handleEndTrip}
                  disabled={!canEndTrip()}
                  style={{
                    background: canEndTrip() ? "#dc2626" : "#9ca3af",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 20px",
                    cursor: canEndTrip() ? "pointer" : "not-allowed",
                    fontWeight: 600,
                    opacity: canEndTrip() ? 1 : 0.6,
                    fontSize: 14,
                  }}
                >
                  Finalizar viaje
                </button>
              </div>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 500 }}>
              <thead>
                <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                  {canManageTrips && <th style={thStyle}>Seleccionar</th>}
                  <th style={thStyle}>Patente</th>
                  <th style={thStyle}>Tipo</th>
                  <th style={thStyle}>Sucursal actual</th>
                  <th style={thStyle}>Sucursal destino</th>
                  <th style={thStyle}>Capacidad (kg)</th>
                  <th style={thStyle}>Cap. disponible (kg)</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((v) => (
                  <tr
                    key={v.id}
                    style={{ borderBottom: "1px solid #e5e7eb" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {canManageTrips && (
                      <td style={tdStyle}>
                        <input
                          type="radio"
                          name="vehicle-select"
                          checked={selectedForAssign === v.license_plate}
                          onChange={() => setSelectedForAssign(v.license_plate)}
                          style={{ width: 18, height: 18, cursor: "pointer" }}
                        />
                      </td>
                    )}
                    <td style={{ ...tdStyle, cursor: "pointer" }} onClick={() => handleViewVehicle(v.license_plate)}>
                      <code style={{ fontWeight: 600, fontSize: 15 }}>{v.license_plate}</code>
                    </td>
                    <td style={{ ...tdStyle, cursor: "pointer" }} onClick={() => handleViewVehicle(v.license_plate)}>{vehicleTypeLabels[v.type]}</td>
                    <td style={{ ...tdStyle, cursor: "pointer" }} onClick={() => handleViewVehicle(v.license_plate)}>
                      {(() => {
                        const branch = v.assigned_branch ? branches.find(b => b.id === v.assigned_branch) : null;
                        if (branch) {
                          return (
                            <span style={{ fontSize: 13, color: "#1e3a5f", fontWeight: 500 }}>
                              {branch.name}
                            </span>
                          );
                        }
                        return <span style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>Sin sucursal</span>;
                      })()}
                    </td>
                    <td style={{ ...tdStyle, cursor: "pointer" }} onClick={() => handleViewVehicle(v.license_plate)}>
                      {(() => {
                        const branch = v.destination_branch ? branches.find(b => b.id === v.destination_branch) : null;
                        if (branch) {
                          return (
                            <span style={{ fontSize: 13, color: "#1e3a5f", fontWeight: 500 }}>
                              {branch.name}
                            </span>
                          );
                        }
                        return <span style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>—</span>;
                      })()}
                    </td>
                    <td style={{ ...tdStyle, cursor: "pointer" }} onClick={() => handleViewVehicle(v.license_plate)}>{v.capacity_kg} kg</td>
                    <td style={{ ...tdStyle, cursor: "pointer" }} onClick={() => handleViewVehicle(v.license_plate)}>
                      {(() => {
                        const assignedWeight = shipmentWeights[v.license_plate];
                        const available = assignedWeight !== undefined 
                          ? Math.max(0, v.capacity_kg - assignedWeight)
                          : v.capacity_kg;
                        const hasAssignment = assignedWeight !== undefined;
                        const color = available > 0 ? "#10b981" : "#ef4444";
                        return (
                          <span style={{ fontWeight: hasAssignment ? 600 : 400, color }}>
                            {available.toFixed(1)} kg
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ ...tdStyle, cursor: "pointer" }} onClick={() => handleViewVehicle(v.license_plate)}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 10px",
                          borderRadius: 9999,
                          fontSize: 13,
                          fontWeight: 500,
                          background: `${getStatusColor(v.status)}20`,
                          color: getStatusColor(v.status),
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: getStatusColor(v.status),
                          }}
                        />
                        {vehicleStatusLabels[v.status]}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {hasRole("operator", "supervisor") && (v.status === "disponible" || v.status === "en_carga") && (
                        <button
                          onClick={() => openLoadModal(v)}
                          style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}
                        >
                          Cargar envíos
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
        />
      )}

      {/* Load Shipments modal */}
      {loadModalVehicle && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={closeLoadModal}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 480, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#1e3a5f" }}>Cargar envíos</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                  <code style={{ fontWeight: 700 }}>{loadModalVehicle.license_plate}</code>
                  {" · "}{vehicleTypeLabels[loadModalVehicle.type]}
                  {" · "}{loadModalVehicle.capacity_kg} kg de capacidad
                </p>
              </div>
              <button onClick={closeLoadModal} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>

            {/* Already loaded */}
            {loadAdded.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>
                  Envíos cargados ({loadAdded.length}):
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {loadAdded.map(tid => (
                    <span key={tid} style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "3px 10px", fontSize: 13, fontWeight: 600, color: "#166534" }}>
                      {tid}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>Agregar envío:</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#6b7280", whiteSpace: "nowrap" }}>LT-</span>
              <input
                autoFocus
                value={loadInput}
                onChange={e => { setLoadInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); setLoadError(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleAddShipment(); }}
                placeholder="A1B2C3D4"
                maxLength={20}
                style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, fontFamily: "monospace", letterSpacing: 1 }}
              />
              <button
                onClick={handleAddShipment}
                disabled={loadBusy || !loadInput.trim()}
                style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: loadBusy || !loadInput.trim() ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, opacity: loadBusy || !loadInput.trim() ? 0.6 : 1 }}
              >
                {loadBusy ? "Agregando…" : "Agregar"}
              </button>
            </div>
            {loadError && (
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "#dc2626" }}>{loadError}</p>
            )}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={closeLoadModal}
                style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 6, padding: "8px 20px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start Trip modal — asks for destination branch */}
      {showStartTripModal && (() => {
        const vehicle = vehicles.find(v => v.license_plate === selectedForAssign);
        const numShipments = vehicle?.assigned_shipments?.length ?? 0;
        const wouldExceed = startTripCapacity != null && (startTripCapacity.current + numShipments) > startTripCapacity.max_capacity;
        const canConfirm = !!startTripDestBranch && !startingTrip && !startTripCapacityLoading && (!wouldExceed || startTripCapacityConfirmed);
        return (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={() => setShowStartTripModal(false)}
          >
            <div
              style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Iniciar viaje</h2>
                <button onClick={() => setShowStartTripModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
              </div>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
                El vehículo <strong>{selectedForAssign}</strong> iniciará un viaje. Todos los envíos cargados pasarán a En tránsito.
              </p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Sucursal destino *</label>
                <select
                  value={startTripDestBranch}
                  onChange={(e) => handleStartTripBranchChange(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" }}
                >
                  <option value="">Seleccioná la sucursal destino...</option>
                  {(() => {
                    const byProvince = branches.reduce((acc, b) => {
                      if (!acc[b.province]) acc[b.province] = [];
                      acc[b.province].push(b);
                      return acc;
                    }, {} as Record<string, typeof branches>);
                    return Object.entries(byProvince)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([province, pBranches]) => (
                        <optgroup key={province} label={province}>
                          {[...pBranches]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map(b => (
                              <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                            ))}
                        </optgroup>
                      ));
                  })()}
                </select>
                {startTripCapacityLoading && (
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "6px 0 0" }}>Verificando capacidad de la sucursal...</p>
                )}
                {startTripCapacity && !startTripCapacityLoading && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                    Capacidad actual: {startTripCapacity.current} / {startTripCapacity.max_capacity} bultos
                  </div>
                )}
              </div>

              {wouldExceed && (
                <div style={{ background: "#fff7ed", border: "1px solid #fb923c", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                  <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: "#c2410c" }}>
                    La sucursal superará su capacidad
                  </p>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "#9a3412" }}>
                    Con los {numShipments} bulto{numShipments !== 1 ? "s" : ""} de este vehículo, la sucursal quedaría con {startTripCapacity!.current + numShipments} de {startTripCapacity!.max_capacity} bultos ({Math.round(((startTripCapacity!.current + numShipments) / startTripCapacity!.max_capacity) * 100)}% de capacidad).
                  </p>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: "#7c2d12", fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={startTripCapacityConfirmed}
                      onChange={(e) => setStartTripCapacityConfirmed(e.target.checked)}
                    />
                    Entiendo la situación y quiero continuar de todas formas
                  </label>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setShowStartTripModal(false)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 500 }}>
                  Cancelar
                </button>
                <button
                  onClick={confirmStartTrip}
                  disabled={!canConfirm}
                  style={{
                    padding: "8px 20px", borderRadius: 6, border: "none", fontWeight: 600,
                    background: !canConfirm ? "#9ca3af" : "#3b82f6",
                    color: "#fff", cursor: !canConfirm ? "not-allowed" : "pointer",
                    opacity: startingTrip ? 0.7 : 1,
                  }}
                >
                  {startingTrip ? "Iniciando..." : "Iniciar viaje"}
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

export function VehicleDetailModal({ vehicle, onClose, onRefresh, readOnly, canAssignBranch, hideShipments }: { vehicle: VehicleStatusResponse; onClose: () => void; onRefresh?: () => void; readOnly?: boolean; canAssignBranch?: boolean; hideShipments?: boolean }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [assigningBranch, setAssigningBranch] = useState(false);
  const [branchError, setBranchError] = useState("");
  const [branchSuccess, setBranchSuccess] = useState("");
  const [unassigning, setUnassigning] = useState<string | null>(null);
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
      await vehicleApi.unassignShipment(vehicle.license_plate, trackingId);
      setCurrentShipments(prev => prev.filter(t => t !== trackingId));
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setUnassignError(e.response?.data?.error || "Error al desasignar el envío");
    } finally {
      setUnassigning(null);
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

  const currentBranch = branches.find(b => b.id === vehicle.assigned_branch);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          maxWidth: 560,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 13, color: "#6b7280", margin: 0, textTransform: "uppercase" }}>Detalle del vehículo</p>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0", color: "#111827" }}>
              {vehicle.license_plate}
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              color: "#6b7280",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: getStatusColor(vehicle.status) + "20",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg style={{ width: 28, height: 28, color: getStatusColor(vehicle.status) }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  padding: "4px 12px",
                  borderRadius: 9999,
                  background: getStatusColor(vehicle.status) + "20",
                  fontSize: 13,
                  fontWeight: 600,
                  color: getStatusColor(vehicle.status),
                }}
              >
                {vehicleStatusLabels[vehicle.status]}
              </span>
            </div>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>
              ID: #{vehicle.id}
            </p>
          </div>
        </div>

        <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" }}>Información del vehículo</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Tipo</p>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicleTypeLabels[vehicle.type]}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Capacidad</p>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicle.capacity_kg} kg</p>
            </div>
            {vehicle.updated_at && (
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Última actualización</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#374151", margin: 0 }}>
                  {new Date(vehicle.updated_at).toLocaleString()}
                </p>
              </div>
            )}
            {vehicle.updated_by && (
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Actualizado por</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#374151", margin: 0 }}>{vehicle.updated_by}</p>
              </div>
            )}
          </div>
        </div>

        {/* Cambio de estado — solo admin */}
        {!readOnly && hideShipments && (
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" }}>Cambiar estado</h3>

            {["en_carga", "en_transito"].includes(currentStatus) && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 13, color: "#92400e" }}>
                El estado <strong>{vehicleStatusLabels[currentStatus]}</strong> es gestionado automáticamente por las operaciones de viaje y no puede cambiarse de forma manual.
              </div>
            )}

            {!["en_carga", "en_transito"].includes(currentStatus) && (
              <>
                {currentShipments.length > 0 && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 13, color: "#92400e" }}>
                    Este vehículo tiene {currentShipments.length} envío{currentShipments.length !== 1 ? "s" : ""} asignado{currentShipments.length !== 1 ? "s" : ""}. El cambio de estado se aplicará de forma forzada.
                  </div>
                )}
                {statusError && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "8px 12px", borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
                    {statusError}
                  </div>
                )}
                {statusSuccess && (
                  <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", padding: "8px 12px", borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
                    {statusSuccess}
                  </div>
                )}
                <select
                  value={selectedStatus}
                  onChange={(e) => { setSelectedStatus(e.target.value as VehicleStatus | ""); setStatusError(""); setStatusSuccess(""); }}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff", marginBottom: 8 }}
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
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, marginBottom: 8, boxSizing: "border-box" }}
                />
                <button
                  onClick={handleStatusChange}
                  disabled={!selectedStatus || statusBusy}
                  style={{
                    background: !selectedStatus || statusBusy ? "#9ca3af" : "#1e3a5f",
                    color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px",
                    cursor: !selectedStatus || statusBusy ? "not-allowed" : "pointer",
                    fontWeight: 600, width: "100%", opacity: statusBusy ? 0.7 : 1,
                  }}
                >
                  {statusBusy ? "Actualizando…" : "Actualizar estado"}
                </button>
              </>
            )}
          </div>
        )}

          {/* Branch asignado */}
        <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" }}>Sucursal actual</h3>
          {currentBranch ? (
            <div style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 12,
              marginBottom: hasShipments ? 0 : 12,
            }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f", margin: 0 }}>
                {currentBranch.name}
              </p>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0" }}>
                {currentBranch.address.city}, {currentBranch.province}
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#6b7280", margin: hasShipments ? 0 : "0 0 12px" }}>Sin sucursal asignada</p>
          )}

          {!hasShipments && canAssignBranch && (
            <>
              {branchError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "8px 12px", borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
                  {branchError}
                </div>
              )}
              {branchSuccess && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", padding: "8px 12px", borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
                  {branchSuccess}
                </div>
              )}
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff", marginBottom: 8 }}
              >
                <option value="">Cambiar sucursal...</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                ))}
              </select>
              <button
                onClick={handleAssignBranch}
                disabled={assigningBranch || !selectedBranch}
                style={{
                  background: assigningBranch || !selectedBranch ? "#9ca3af" : "#1e3a5f",
                  color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px",
                  cursor: assigningBranch || !selectedBranch ? "not-allowed" : "pointer",
                  fontWeight: 600, width: "100%", opacity: assigningBranch ? 0.7 : 1,
                }}
              >
                {assigningBranch ? "Asignando..." : "Asignar sucursal"}
              </button>
            </>
          )}
        </div>

        {/* Envíos asignados */}
        {!hideShipments && <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" }}>Envíos asignados</h3>
          {unassignError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "8px 12px", borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
              {unassignError}
            </div>
          )}
          {currentShipments.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {currentShipments.map((trackingId) => (
                <div
                  key={trackingId}
                  style={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: "#1e3a5f", margin: 0 }}>
                      {trackingId}
                    </p>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0" }}>
                      ID de seguimiento
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Link
                      to={`/shipments/${trackingId}`}
                      style={{
                        background: "#1e3a5f",
                        color: "#fff",
                        textDecoration: "none",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                      onClick={onClose}
                    >
                      Ver
                    </Link>
                    {!readOnly && (
                      <button
                        onClick={() => handleUnassign(trackingId)}
                        disabled={unassigning === trackingId}
                        title="Desasignar envío"
                        style={{
                          background: unassigning === trackingId ? "#f3f4f6" : "#fef2f2",
                          color: "#dc2626",
                          border: "1px solid #fecaca",
                          borderRadius: 6,
                          width: 32,
                          height: 32,
                          cursor: unassigning === trackingId ? "not-allowed" : "pointer",
                          fontWeight: 700,
                          fontSize: 16,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          opacity: unassigning === trackingId ? 0.5 : 1,
                        }}
                      >
                        {unassigning === trackingId ? "…" : "✕"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: "20px 0",
                color: "#6b7280",
              }}
            >
              <svg style={{ width: 32, height: 32, margin: "0 auto 8px", opacity: 0.5 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p style={{ fontSize: 14, margin: 0 }}>Sin envíos asignados</p>
              <p style={{ fontSize: 12, margin: "4px 0 0" }}>Este vehículo no tiene envíos cargados</p>
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, color: "#374151" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };