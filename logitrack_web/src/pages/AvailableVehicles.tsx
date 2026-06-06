import { useCallback, useEffect, useState } from "react";
import { vehicleApi, type Vehicle, type VehicleType } from "../api/vehicles";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";
import { Truck } from "lucide-react";

const vehicleTypeLabels: Record<VehicleType, string> = {
  auto: "Auto",
  furgoneta: "Furgoneta",
  camion: "Camión",
};

export function AvailableVehicles() {
  const { hasRole } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<VehicleType | "">("");
  const [filterCapacity, setFilterCapacity] = useState<string>("");

  const loadAvailableVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const filters: { type?: VehicleType; min_capacity?: number } = {};
      if (filterType) filters.type = filterType;
      if (filterCapacity && parseFloat(filterCapacity) > 0) {
        filters.min_capacity = parseFloat(filterCapacity);
      }
      const data = await vehicleApi.listAvailable(filters);
      setVehicles(data ?? []);
    } catch (err) {
      console.error("Failed to load available vehicles:", err);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterCapacity]);

  useEffect(() => {
    loadAvailableVehicles();
  }, [loadAvailableVehicles]);

  if (!hasRole("supervisor") && !hasRole("admin")) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleClearFilters = () => {
    setFilterType("");
    setFilterCapacity("");
  };

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      {/* Filtros */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">
          Filtrar Vehículos
        </h3>
        <div className="flex gap-4 flex-wrap items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="block mb-1.5 font-medium text-sm">
              Tipo de Vehículo
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as VehicleType | "")}
              className="w-full px-3 py-2 rounded-[6px] border border-slate-300 text-sm bg-white"
            >
              <option value="">Todos los tipos</option>
              {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[180px]">
            <label className="block mb-1.5 font-medium text-sm">
              Capacidad Mínima (kg)
            </label>
            <input
              type="number"
              value={filterCapacity}
              onChange={(e) => setFilterCapacity(e.target.value)}
              placeholder="Ej: 500"
              min="0"
              step="100"
              className="w-full px-3 py-2 rounded-[6px] border border-slate-300 text-sm"
            />
          </div>

          <button
            onClick={handleClearFilters}
            className="bg-slate-100 text-slate-900 border-0 rounded-[6px] px-4 py-2 cursor-pointer font-medium text-sm h-[38px]"
          >
            Limpiar Filtros
          </button>
        </div>
      </div>

      {/* Resultados */}
      {loading ? (
        <p className="text-center text-slate-500">Cargando...</p>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-[60px] px-5 bg-slate-50 border border-slate-200 rounded-xl">
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
          <p className="text-base font-semibold text-slate-900 m-0">
            No hay vehículos disponibles
          </p>
          <p className="text-sm text-slate-500 mt-1">
            No existen unidades en estado "Disponible" que coincidan con los filtros seleccionados.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">
            {vehicles.length} vehículo{vehicles.length !== 1 ? "s" : ""} disponible{vehicles.length !== 1 ? "s" : ""}
          </p>
          <div className="grid gap-4">
            {vehicles.map((v) => (
              <div
                key={v.id}
                className="bg-white border border-slate-200 rounded-lg p-5 flex items-center gap-5 cursor-pointer hover:shadow-md transition-shadow"
              >
                {/* Icono del vehículo */}
                <div className="w-14 h-14 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <Truck className="w-7 h-7 text-emerald-500" />
                </div>

                {/* Información del vehículo */}
                <div className="flex-1 flex flex-wrap gap-6 items-center">
                  <div>
                    <p className="text-[12px] text-slate-500 m-0 uppercase tracking-[0.5px] mb-0.5">
                      Patente
                    </p>
                    <p className="text-lg font-bold text-slate-800 m-0">
                      {v.license_plate}
                    </p>
                  </div>

                  <div>
                    <p className="text-[12px] text-slate-500 m-0 uppercase tracking-[0.5px] mb-0.5">
                      Tipo
                    </p>
                    <p className="text-sm font-semibold text-slate-900 m-0">
                      {vehicleTypeLabels[v.type]}
                    </p>
                  </div>

                  <div>
                    <p className="text-[12px] text-slate-500 m-0 uppercase tracking-[0.5px] mb-0.5">
                      Capacidad
                    </p>
                    <p className="text-sm font-semibold text-slate-900 m-0">
                      {v.capacity_kg} kg
                    </p>
                  </div>

                  <div>
                    <p className="text-[12px] text-slate-500 m-0 uppercase tracking-[0.5px] mb-0.5">
                      ID
                    </p>
                    <p className="text-sm font-semibold text-slate-900 m-0">
                      #{v.id}
                    </p>
                  </div>
                </div>

                {/* Estado */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/15 shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-sm font-semibold text-emerald-500">
                    Disponible
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
