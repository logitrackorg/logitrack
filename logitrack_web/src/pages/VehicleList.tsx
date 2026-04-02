import { useEffect, useState } from "react";
import { vehicleApi, type Vehicle, type VehicleStatus, type VehicleType } from "../api/vehicles";
import { useAuth } from "../context/AuthContext";

const vehicleTypeLabels: Record<VehicleType, string> = {
  motocicleta: "Motocicleta",
  furgoneta: "Furgoneta",
  camion: "Camión",
  camion_grande: "Camión Grande",
};

const vehicleStatusLabels: Record<VehicleStatus, string> = {
  disponible: "Disponible",
  mantenimiento: "Mantenimiento",
  en_transito: "En Tránsito",
  inactivo: "Inactivo",
};

const getStatusColor = (status: VehicleStatus): string => {
  switch (status) {
    case "disponible":
      return "#10b981";
    case "mantenimiento":
      return "#f59e0b";
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
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const { hasRole } = useAuth();

  const isAdmin = hasRole("admin");

  const [formData, setFormData] = useState({
    license_plate: "",
    type: "furgoneta" as VehicleType,
    capacity_kg: 0,
  });

  const loadVehicles = async () => {
    setLoading(true);
    try {
      const data = await vehicleApi.list();
      setVehicles(data ?? []);
    } catch (err) {
      console.error("Failed to load vehicles:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadVehicles(); }, []);

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
      setSuccess("Vehículo registrado exitosamente");
      setShowForm(false);
      setFormData({ license_plate: "", type: "furgoneta", capacity_kg: 0 });
      loadVehicles();
    } catch (err: any) {
      if (err.response?.status === 409) {
        setError("Ya existe un vehículo con la misma patente");
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError("Error al registrar el vehículo");
      }
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setFormData({ license_plate: "", type: "furgoneta", capacity_kg: 0 });
    setError("");
    setSuccess("");
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Gestión de Flota</h1>
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
            {showForm ? "Cancelar" : "+ Nuevo Vehículo"}
          </button>
        )}
      </div>

      {/* Formulario de alta */}
      {showForm && isAdmin && (
        <div style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 20,
          marginBottom: 20,
          maxWidth: 500,
        }}>
          <h2 style={{ margin: "0 0 16px 0", fontSize: 18 }}>Registrar Nuevo Vehículo</h2>

          {error && (
            <div style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#dc2626",
              padding: "8px 12px",
              borderRadius: 6,
              marginBottom: 12,
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
              padding: "8px 12px",
              borderRadius: 6,
              marginBottom: 12,
              fontSize: 14,
            }}>
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                Patente *
              </label>
              <input
                type="text"
                value={formData.license_plate}
                onChange={(e) => setFormData({ ...formData, license_plate: e.target.value.toUpperCase() })}
                placeholder="Ej: AB123CD"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                  textTransform: "uppercase",
                }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                Tipo *
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as VehicleType })}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                Capacidad (kg) *
              </label>
              <input
                type="number"
                value={formData.capacity_kg || ""}
                onChange={(e) => setFormData({ ...formData, capacity_kg: parseFloat(e.target.value) || 0 })}
                placeholder="Ej: 500"
                min="1"
                step="0.1"
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  background: "#e5e7eb",
                  color: "#374151",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                style={{
                  background: "#1e3a5f",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Registrar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de vehículos */}
      {loading ? (
        <p>Cargando...</p>
      ) : vehicles.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No hay vehículos registrados en la flota.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
            {vehicles.length} vehículo{vehicles.length !== 1 ? "s" : ""} en la flota
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 500 }}>
              <thead>
                <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                  <th style={th}>Patente</th>
                  <th style={th}>Tipo</th>
                  <th style={th}>Capacidad (kg)</th>
                  <th style={th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr
                    key={v.id}
                    style={{ borderBottom: "1px solid #e5e7eb" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td style={td}>
                      <code style={{ fontWeight: 600, fontSize: 15 }}>{v.license_plate}</code>
                    </td>
                    <td style={td}>{vehicleTypeLabels[v.type]}</td>
                    <td style={td}>{v.capacity_kg} kg</td>
                    <td style={td}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, color: "#374151" };
const td: React.CSSProperties = { padding: "10px 14px" };