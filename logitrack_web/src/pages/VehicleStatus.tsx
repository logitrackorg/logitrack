import { useState, useEffect } from "react";
import { vehicleApi, type VehicleStatusResponse, type VehicleStatus, type VehicleType, type UpdateVehicleStatusRequest } from "../api/vehicles";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

const vehicleTypeLabels: Record<VehicleType, string> = {
  auto: "Auto",
  furgoneta: "Furgoneta",
  camion: "Camión",
};

function statusBgClass(status: VehicleStatus): string {
  switch (status) {
    case "disponible": return "bg-green-50";
    case "mantenimiento": return "bg-orange-50";
    case "en_transito": return "bg-violet-50";
    case "inactivo": return "bg-gray-50";
    default: return "bg-slate-50";
  }
}
function statusBorderClass(status: VehicleStatus): string {
  switch (status) {
    case "disponible": return "border-green-200";
    case "mantenimiento": return "border-orange-200";
    case "en_transito": return "border-violet-200";
    case "inactivo": return "border-gray-200";
    default: return "border-slate-200";
  }
}
function statusDotClass(status: VehicleStatus): string {
  switch (status) {
    case "disponible": return "bg-green-500";
    case "mantenimiento": return "bg-orange-500";
    case "en_transito": return "bg-violet-500";
    case "inactivo": return "bg-gray-500";
    default: return "bg-slate-400";
  }
}
function statusTextClass(status: VehicleStatus): string {
  switch (status) {
    case "disponible": return "text-green-600";
    case "mantenimiento": return "text-orange-600";
    case "en_transito": return "text-violet-600";
    case "inactivo": return "text-gray-600";
    default: return "text-slate-600";
  }
}
function statusBadgeClass(status: VehicleStatus): string {
  switch (status) {
    case "disponible": return "bg-green-100";
    case "mantenimiento": return "bg-orange-100";
    case "en_transito": return "bg-violet-100";
    case "inactivo": return "bg-gray-100";
    default: return "bg-slate-100";
  }
}

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString("es-AR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const statusOptions: { value: VehicleStatus; label: string }[] = [
  { value: "disponible", label: "Disponible" },
  { value: "en_transito", label: "En tránsito" },
  { value: "mantenimiento", label: "En mantenimiento" },
  { value: "inactivo", label: "Inactivo" },
];

export function VehicleStatus() {
  const { hasRole } = useAuth();
  const [plate, setPlate] = useState("");
  const [vehicle, setVehicle] = useState<VehicleStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [notFound, setNotFound] = useState(false);
  const [success, setSuccess] = useState<string>("");
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    branchApi.list().then(setBranches).catch(() => {});
  }, []);

  // State change modal
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState<VehicleStatus>("disponible");
  const [notes, setNotes] = useState("");
  const [changingStatus, setChangingStatus] = useState(false);
  const [transitionError, setTransitionError] = useState<string>("");
  const [showForceConfirm, setShowForceConfirm] = useState(false);

  // Only supervisor and admin can manage the fleet
  if (!hasRole("supervisor") && !hasRole("admin")) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plate.trim()) {
      setError("La patente es obligatoria");
      return;
    }

    setLoading(true);
    setError("");
    setVehicle(null);
    setNotFound(false);
    setSuccess("");
    setTransitionError("");

    try {
      const data = await vehicleApi.getByPlate(plate.toUpperCase().trim());
      setVehicle(data);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 404) {
        setNotFound(true);
      } else if (e.response?.status === 400) {
        setError(e.response?.data?.error || "Error en la búsqueda");
      } else {
        setError("Error al buscar el vehículo");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setPlate("");
    setVehicle(null);
    setError("");
    setNotFound(false);
    setSuccess("");
    setTransitionError("");
    setShowStatusModal(false);
    setNewStatus("disponible");
    setNotes("");
  };

  const openStatusModal = () => {
    setNewStatus(vehicle?.status || "disponible");
    setNotes("");
    setTransitionError("");
    setShowForceConfirm(false);
    setShowStatusModal(true);
  };

  const handleStatusChange = async () => {
    if (!vehicle) return;

    setChangingStatus(true);
    setTransitionError("");

    try {
      // If the vehicle is in transit and we want to change it to available,
      // use the endTrip endpoint which clears the assigned shipment
      if (vehicle.status === "en_transito" && newStatus === "disponible") {
        const updated = await vehicleApi.endTrip(vehicle.license_plate);
        setVehicle(updated);
        setSuccess(`Viaje finalizado. El vehículo está disponible.`);
        setShowStatusModal(false);
      } else {
        const data: UpdateVehicleStatusRequest = {
          status: newStatus,
          notes: notes || undefined,
          force: showForceConfirm,
        };

        const updated = await vehicleApi.updateStatus(vehicle.license_plate, data);
        setVehicle(updated);
        setSuccess(`Estado actualizado a "${updated.status_label}"`);
        setShowStatusModal(false);
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; requires_force?: boolean } } };
      if (e.response?.status === 409) {
        const errorData = e.response?.data;
        setTransitionError(errorData?.error || "Transición inválida");
        if (errorData?.requires_force) {
          setShowForceConfirm(true);
        }
      } else if (e.response?.status === 400) {
        setTransitionError(e.response?.data?.error || "Datos inválidos");
      } else {
        setTransitionError(e.response?.data?.error || "Error al actualizar el estado");
      }
    } finally {
      setChangingStatus(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Search form */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block mb-1.5 font-medium text-sm">
              Patente *
            </label>
            <input
              type="text"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="Ej.: AB123CD"
              className="w-full px-3.5 py-2.5 rounded-md border border-slate-300 text-base uppercase font-medium"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className={`px-5 py-2.5 rounded-md border-none font-semibold text-sm text-white bg-[#1e3a5f] ${
              loading ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            {loading ? "Buscando..." : "Buscar"}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="px-5 py-2.5 rounded-md border-none font-medium text-sm cursor-pointer bg-slate-100 text-slate-800"
          >
            Limpiar
          </button>
        </div>
      </form>

      {/* Error message */}
      {error && (
        <div className="px-4 py-3 rounded-md mb-5 text-sm bg-rose-50 border border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      {/* Vehicle not found */}
      {notFound && (
        <div className="px-5 py-4 rounded-lg mb-5 text-center bg-amber-50 border border-amber-200 text-amber-800">
          <svg
            className="w-12 h-12 mx-auto mb-3 block"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="text-base font-semibold m-0">Vehículo no encontrado</p>
          <p className="text-sm mt-1 opacity-80">
            No se encontró ningún vehículo con la patente <strong>{plate.toUpperCase()}</strong> en el sistema.
          </p>
        </div>
      )}

      {/* Success message */}
      {success && (
        <div className="px-4 py-3 rounded-md mb-5 text-sm bg-emerald-50 border border-emerald-200 text-emerald-700">
          {success}
        </div>
      )}

      {/* Lookup result */}
      {vehicle && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {/* Header with status */}
          <div className={`p-6 ${statusBgClass(vehicle.status)} border-b-2 ${statusBorderClass(vehicle.status)}`}>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <p className="text-xs text-slate-600 m-0 uppercase tracking-wide">
                  Patente
                </p>
                <h2 className="text-[28px] font-bold mt-1 text-slate-900">
                  {vehicle.license_plate}
                </h2>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${statusBadgeClass(vehicle.status)}`}>
                  <span className={`w-3 h-3 rounded-full animate-pulse ${statusDotClass(vehicle.status)}`} />
                  <span className={`text-base font-semibold ${statusTextClass(vehicle.status)}`}>
                    {vehicle.status_label}
                  </span>
                </div>
                <button
                  onClick={openStatusModal}
                  className="px-4 py-2 rounded-md border-none cursor-pointer font-medium text-sm text-white bg-[#1e3a5f]"
                >
                  Cambiar estado
                </button>
              </div>
            </div>
          </div>

          {/* Vehicle information */}
          <div className="p-6">
            <h3 className="text-sm font-semibold text-slate-600 m-0 mb-4 uppercase tracking-wide">
              Información del vehículo
            </h3>
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
              <InfoCard
                label="Tipo"
                value={vehicleTypeLabels[vehicle.type] || vehicle.type}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                }
              />
              <InfoCard
                label="Capacidad"
                value={`${vehicle.capacity_kg} kg`}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                }
              />
              <InfoCard
                label="Última actualización"
                value={formatDate(vehicle.updated_at)}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              {vehicle.updated_by && (
                <InfoCard
                  label="Actualizado por"
                  value={vehicle.updated_by}
                  icon={
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  }
                />
              )}
              <InfoCard
                label="ID de vehículo"
                value={`#${vehicle.id}`}
                icon={
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                }
              />
              {vehicle.assigned_branch && (() => {
                const branch = branches.find(b => b.id === vehicle.assigned_branch);
                return (
                  <InfoCard
                    label="Sucursal asignada"
                    value={branch ? `${branch.name} — ${branch.address.city}` : vehicle.assigned_branch}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    }
                  />
                );
              })()}
              {vehicle.destination_branch && (() => {
                const branch = branches.find(b => b.id === vehicle.destination_branch);
                return (
                  <InfoCard
                    label="Sucursal destino"
                    value={branch ? `${branch.name} — ${branch.address.city}` : vehicle.destination_branch}
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    }
                  />
                );
              })()}
            </div>

            {/* Assigned shipments */}
            {vehicle.assigned_shipments && vehicle.assigned_shipments.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-sm font-semibold text-blue-600 m-0 mb-2 flex items-center gap-2">
                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Envíos asignados
                </h3>
                <p className="text-base font-semibold text-slate-900 m-0">
                  {vehicle.assigned_shipments.join(", ")}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Este vehículo tiene envíos cargados activos.
                </p>
              </div>
            )}

            {/* No assigned shipment */}
            {!(vehicle.assigned_shipments && vehicle.assigned_shipments.length > 0) && vehicle.status === "disponible" && (
              <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm text-emerald-700 m-0 flex items-center gap-2">
                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Vehículo disponible para asignación
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status change modal */}
      {showStatusModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
          onClick={() => !changingStatus && setShowStatusModal(false)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-[450px] w-[90%] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold m-0 mb-5 text-slate-900">
              Cambiar estado del vehículo
            </h2>

            {transitionError && (
              <div
                className={`px-4 py-3 rounded-md mb-4 text-sm ${
                  showForceConfirm
                    ? "bg-amber-50 border border-amber-200 text-amber-800"
                    : "bg-rose-50 border border-rose-200 text-rose-700"
                }`}
              >
                {transitionError}
                {showForceConfirm && (
                  <p className="mt-2 text-xs">
                    ¿Querés forzar el cambio de estado de todas formas?
                  </p>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="block mb-1.5 font-medium text-sm">
                Nuevo estado *
              </label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as VehicleStatus)}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm bg-white"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="mb-5">
              <label className="block mb-1.5 font-medium text-sm">
                Notas (opcional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Motivo del cambio de estado..."
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm resize-y"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                disabled={changingStatus}
                className={`px-4 py-2 rounded-md border-none font-medium cursor-pointer text-sm ${
                  changingStatus ? "opacity-70 cursor-not-allowed" : ""
                } bg-slate-100 text-slate-800`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStatusChange}
                disabled={changingStatus}
                className={`px-5 py-2 rounded-md border-none font-semibold text-white text-sm bg-[#1e3a5f] ${
                  changingStatus ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
                }`}
              >
                {changingStatus ? "Guardando..." : (showForceConfirm ? "Forzar cambio" : "Guardar")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Initial instructions */}
      {!vehicle && !error && !notFound && (
        <div className="text-center py-[60px] px-5 text-slate-600">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z"
            />
          </svg>
          <p className="text-base m-0">
            Ingresá la patente del vehículo para consultar su estado actual
          </p>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-3">
      <div className="text-slate-600 shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-slate-600 m-0 mb-1 uppercase tracking-wide">
          {label}
        </p>
        <p className="text-base font-semibold text-slate-900 m-0">{value}</p>
      </div>
    </div>
  );
}