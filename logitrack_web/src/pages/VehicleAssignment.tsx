import { useState, useEffect } from "react";
import { vehicleApi, type Vehicle, type VehicleStatusResponse } from "../api/vehicles";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

const vehicleTypeLabels: Record<string, string> = {
  auto: "Auto",
  furgoneta: "Furgoneta",
  camion: "Camión",
};

export function VehicleAssignment() {
  const { hasRole } = useAuth();

  const [availableVehicles, setAvailableVehicles] = useState<Vehicle[]>([]);
  const [selectedPlate, setSelectedPlate] = useState("");
  const [vehicle, setVehicle] = useState<VehicleStatusResponse | null>(null);
  const [trackingId, setTrackingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [alreadyAssigned, setAlreadyAssigned] = useState<{ shipment: string; status: string } | null>(null);

  // Load available vehicles on mount
  useEffect(() => {
    loadAvailableVehicles();
  }, []);

  // Only supervisor and admin can assign vehicles
  if (!hasRole("supervisor") && !hasRole("admin")) {
    return <Navigate to="/dashboard" replace />;
  }

  const loadAvailableVehicles = async () => {
    setLoading(true);
    try {
      const data = await vehicleApi.listAvailable();
      setAvailableVehicles(data ?? []);
    } catch (err) {
      console.error("Failed to load available vehicles:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectVehicle = async (plate: string) => {
    setSelectedPlate(plate);
    setError("");
    setSuccess("");
    setAlreadyAssigned(null);

    try {
      const data = await vehicleApi.getByPlate(plate);
      setVehicle(data);

      if (data.assigned_shipments && data.assigned_shipments.length > 0) {
        setAlreadyAssigned({
          shipment: data.assigned_shipments[0],
          status: data.status_label,
        });
      }
    } catch {
      setError("Error al cargar el vehículo");
    }
  };

  const validateTrackingId = (id: string): boolean => {
    // Validar formato LT-XXXXXXXX (LT- seguido de 8 caracteres alfanuméricos)
    const regex = /^LT-[A-Za-z0-9]{8}$/;
    return regex.test(id.toUpperCase());
  };

  const handleAssign = async () => {
    if (!vehicle) {
      setError("Debés seleccionar un vehículo");
      return;
    }

    if (!trackingId.trim()) {
      setError("El ID de seguimiento del envío es obligatorio");
      return;
    }

    if (!validateTrackingId(trackingId.trim())) {
      setError("El ID de seguimiento debe tener el formato LT-XXXXXXXX (ej. LT-AB123456)");
      return;
    }

    setAssigning(true);
    setError("");
    setSuccess("");

    try {
      const result = await vehicleApi.assignToShipment(vehicle.license_plate, { tracking_id: trackingId.trim() });
      setVehicle(result);
      setSuccess(result.message || "Vehículo asignado correctamente");
      setTrackingId("");
      setSelectedPlate("");
      setAlreadyAssigned(null);
      // Reload available vehicles
      loadAvailableVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; assigned_shipments?: string[]; current_status?: string; requires_force?: boolean } } };
      if (e.response?.status === 409) {
        const errorData = e.response?.data;
        if (errorData?.assigned_shipments && errorData.assigned_shipments.length > 0) {
          setAlreadyAssigned({
            shipment: errorData.assigned_shipments[0],
            status: errorData.current_status ?? "",
          });
          setError(`El vehículo ya está asignado al envío ${errorData.assigned_shipments[0]}`);
        } else {
          setError(errorData?.error || "No se puede asignar el vehículo");
        }
      } else if (e.response?.status === 404) {
        setError("No se encontró ningún envío con ese ID de seguimiento");
      } else if (e.response?.status === 400) {
        setError(e.response?.data?.error || "Datos inválidos");
      } else {
        setError("Error al asignar el vehículo");
      }
    } finally {
      setAssigning(false);
    }
  };

  const handleClear = () => {
    setSelectedPlate("");
    setVehicle(null);
    setTrackingId("");
    setError("");
    setSuccess("");
    setAlreadyAssigned(null);
  };

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      {/* Available vehicles list */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-4 dark:text-gray-100 text-slate-900">
          Vehículos disponibles
        </h2>

        {loading && availableVehicles.length === 0 ? (
          <p className="dark:text-gray-400 text-slate-600">Cargando vehículos...</p>
        ) : availableVehicles.length === 0 ? (
          <div className="dark:bg-gray-800/50 bg-slate-50 border dark:border-gray-700 border-slate-200 rounded-lg p-6 text-center dark:text-gray-400 text-slate-600">
            No hay vehículos disponibles para asignación
          </div>
        ) : (
          <div className="grid gap-3">
            {availableVehicles.map((v) => {
              const isSelected = selectedPlate === v.license_plate;
              return (
              <div
                key={v.id}
                onClick={() => handleSelectVehicle(v.license_plate)}
                className={`p-4 flex items-center gap-4 rounded-lg cursor-pointer transition-all ${
                  isSelected
                    ? "bg-blue-50 border-2 border-blue-500"
                    : "dark:bg-gray-800 bg-white border-2 dark:border-gray-700 border-slate-200 hover:border-blue-400"
                }`}
              >
                <div
                  className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0"
                >
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold dark:text-gray-100 text-slate-900 m-0">{v.license_plate}</p>
                  <p className="text-xs dark:text-gray-400 text-slate-600 mt-0.5">
                    {vehicleTypeLabels[v.type]} · {v.capacity_kg} kg
                  </p>
                </div>
                <div className="px-3 py-1 rounded-full bg-green-100 text-xs font-semibold text-emerald-600">
                  Disponible
                </div>
                {isSelected && (
                  <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Formulario de asignación */}
      {vehicle && (
        <div className="dark:bg-gray-800 bg-white border dark:border-gray-700 border-slate-200 rounded-xl overflow-hidden shadow-sm mb-6">
          <div className={`p-5 border-b dark:border-gray-700 border-slate-200 ${
            vehicle.status === "disponible" ? "bg-emerald-50" : "bg-amber-50"
          }`}>
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <p className="text-xs dark:text-gray-400 text-slate-600 m-0 uppercase">Vehículo seleccionado</p>
                <h2 className="text-2xl font-bold mt-1 dark:text-gray-100 text-slate-900">
                  {vehicle.license_plate}
                </h2>
              </div>
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${
                vehicle.status === "disponible" ? "bg-green-100" : "bg-amber-100"
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${
                  vehicle.status === "disponible" ? "bg-emerald-600" : "bg-amber-500"
                }`} />
                <span className={`text-sm font-semibold ${
                  vehicle.status === "disponible" ? "text-emerald-600" : "text-amber-800"
                }`}>
                  {vehicle.status_label}
                </span>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="grid gap-4 mb-6 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              <div>
                <p className="text-xs dark:text-gray-400 text-slate-600 m-0 mb-1 uppercase">Tipo</p>
                <p className="text-sm font-semibold dark:text-gray-100 text-slate-900 m-0">{vehicleTypeLabels[vehicle.type]}</p>
              </div>
              <div>
                <p className="text-xs dark:text-gray-400 text-slate-600 m-0 mb-1 uppercase">Capacidad</p>
                <p className="text-sm font-semibold dark:text-gray-100 text-slate-900 m-0">{vehicle.capacity_kg} kg</p>
              </div>
              <div>
                <p className="text-xs dark:text-gray-400 text-slate-600 m-0 mb-1 uppercase">ID interno</p>
                <p className="text-sm font-semibold dark:text-gray-100 text-slate-900 m-0">#{vehicle.id}</p>
              </div>
              {vehicle.assigned_shipments && vehicle.assigned_shipments.length > 0 && (
                <div>
                  <p className="text-xs dark:text-gray-400 text-slate-600 m-0 mb-1 uppercase">Envíos asignados</p>
                  <p className="text-sm font-semibold dark:text-gray-100 text-slate-900 m-0">{vehicle.assigned_shipments.join(", ")}</p>
                </div>
              )}
            </div>

            {/* Assignment form — only when available */}
            {vehicle.status === "disponible" && !(vehicle.assigned_shipments && vehicle.assigned_shipments.length > 0) && (
              <div className="dark:bg-gray-800/50 bg-slate-50 border dark:border-gray-700 border-slate-200 rounded-lg p-5">
                <h3 className="text-base font-semibold dark:text-gray-100 text-slate-900 m-0 mb-4">
                  Asignar a envío
                </h3>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block mb-1.5 font-medium text-sm">
                      ID de seguimiento del envío *
                    </label>
                    <input
                      type="text"
                      value={trackingId}
                      onChange={(e) => setTrackingId(e.target.value.toUpperCase())}
                      placeholder="Ej.: LT-AB123456"
                      className="w-full px-3.5 py-2.5 rounded-md border dark:border-gray-600 border-slate-300 text-sm uppercase"
                    />
                    <p className="text-xs dark:text-gray-400 text-slate-600 mt-1">
                      Formato: LT-XXXXXXXX (8 caracteres alfanuméricos)
                    </p>
                  </div>
                  <button
                    onClick={handleAssign}
                    disabled={assigning}
                    className={`px-5 py-2.5 rounded-md border-none font-semibold text-sm text-white h-[42px] bg-emerald-600 ${
                      assigning ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    {assigning ? "Asignando..." : "Asignar"}
                  </button>
                </div>
              </div>
            )}

            {/* Vehicle already assigned */}
            {alreadyAssigned && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                <div className="flex items-center gap-3 mb-3">
                  <svg
                    className="w-6 h-6 text-amber-800 shrink-0"
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
                  <h3 className="text-base font-semibold text-amber-800 m-0">
                    Vehículo ya asignado
                  </h3>
                </div>
                <p className="text-sm text-amber-800 m-0">
                  Este vehículo ya está asignado al envío{" "}
                  <strong className="dark:text-gray-100 text-slate-900">{alreadyAssigned.shipment}</strong>
                  {" "}y su estado actual es <strong>"{alreadyAssigned.status}"</strong>.
                </p>
                <p className="text-xs text-amber-800 mt-2">
                  Para asignar este vehículo a otro envío, el envío actual debe ser completado o reasignado primero.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-4 py-3 rounded-md mb-5 text-sm bg-rose-50 border border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      {/* Success message */}
      {success && (
        <div className="px-4 py-3 rounded-md mb-5 text-sm bg-emerald-50 border border-emerald-200 text-emerald-700">
          {success}
        </div>
      )}

      {/* Page footer */}
      <div className="mt-6 text-center">
        <button
          onClick={handleClear}
          className="bg-transparent border-none dark:text-gray-400 text-slate-600 cursor-pointer text-sm underline"
        >
          Limpiar selección
        </button>
      </div>
    </div>
  );
}