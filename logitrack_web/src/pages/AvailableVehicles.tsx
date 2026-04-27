import { useCallback, useEffect, useState } from "react";
import { vehicleApi, type Vehicle, type VehicleType } from "../api/vehicles";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

const vehicleTypeLabels: Record<VehicleType, string> = {
  motocicleta: "Motocicleta",
  auto: "Auto",
  furgoneta: "Furgoneta",
  camion: "Camión",
};

const statusColor = "#10b981";

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
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 24, fontSize: 24 }}>Vehículos Disponibles</h1>

      {/* Filtros */}
      <div
        style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 16px" }}>
          Filtrar Vehículos
        </h3>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
              Tipo de Vehículo
            </label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as VehicleType | "")}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: 14,
                background: "#fff",
              }}
            >
              <option value="">Todos los tipos</option>
              {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
              Capacidad Mínima (kg)
            </label>
            <input
              type="number"
              value={filterCapacity}
              onChange={(e) => setFilterCapacity(e.target.value)}
              placeholder="Ej: 500"
              min="0"
              step="100"
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />
          </div>

          <button
            onClick={handleClearFilters}
            style={{
              background: "#e5e7eb",
              color: "#374151",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: 14,
              height: 38,
            }}
          >
            Limpiar Filtros
          </button>
        </div>
      </div>

      {/* Resultados */}
      {loading ? (
        <p style={{ textAlign: "center", color: "#6b7280" }}>Cargando...</p>
      ) : vehicles.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
          }}
        >
          <svg
            style={{ width: 64, height: 64, margin: "0 auto 16px", opacity: 0.5 }}
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
          <p style={{ fontSize: 16, fontWeight: 600, color: "#374151", margin: 0 }}>
            No hay vehículos disponibles
          </p>
          <p style={{ fontSize: 14, color: "#6b7280", margin: "4px 0 0" }}>
            No existen unidades en estado "Disponible" que coincidan con los filtros seleccionados.
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
            {vehicles.length} vehículo{vehicles.length !== 1 ? "s" : ""} disponible{vehicles.length !== 1 ? "s" : ""}
          </p>
          <div style={{ display: "grid", gap: 16 }}>
            {vehicles.map((v) => (
              <div
                key={v.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 20,
                  display: "flex",
                  alignItems: "center",
                  gap: 20,
                  transition: "box-shadow 0.2s",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0,0,0,0.1)")}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
              >
                {/* Icono del vehículo */}
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    background: `${statusColor}15`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg
                    style={{ width: 28, height: 28, color: statusColor }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z"
                    />
                  </svg>
                </div>

                {/* Información del vehículo */}
                <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Patente
                    </p>
                    <p style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: 0 }}>
                      {v.license_plate}
                    </p>
                  </div>

                  <div>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Tipo
                    </p>
                    <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: 0 }}>
                      {vehicleTypeLabels[v.type]}
                    </p>
                  </div>

                  <div>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Capacidad
                    </p>
                    <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: 0 }}>
                      {v.capacity_kg} kg
                    </p>
                  </div>

                  <div>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      ID
                    </p>
                    <p style={{ fontSize: 15, fontWeight: 600, color: "#374151", margin: 0 }}>
                      #{v.id}
                    </p>
                  </div>
                </div>

                {/* Estado */}
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    borderRadius: 9999,
                    background: `${statusColor}20`,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: statusColor,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: statusColor,
                    }}
                  >
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