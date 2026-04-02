import { useState, useEffect } from "react";
import { vehicleApi, type Vehicle, type VehicleStatusResponse } from "../api/vehicles";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

const vehicleTypeLabels: Record<string, string> = {
  motocicleta: "Motocicleta",
  furgoneta: "Furgoneta",
  camion: "Camión",
  camion_grande: "Camión Grande",
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

  if (!hasRole("supervisor") && !hasRole("manager") && !hasRole("admin")) {
    return <Navigate to="/dashboard" replace />;
  }

  // Load available vehicles on mount
  useEffect(() => {
    loadAvailableVehicles();
  }, []);

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

      if (data.assigned_shipment) {
        setAlreadyAssigned({
          shipment: data.assigned_shipment,
          status: data.status_label,
        });
      }
    } catch (err: any) {
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
      setError("Debe seleccionar un vehículo");
      return;
    }

    if (!trackingId.trim()) {
      setError("El tracking ID del envío es obligatorio");
      return;
    }

    if (!validateTrackingId(trackingId.trim())) {
      setError("El tracking ID debe tener el formato LT-XXXXXXXX (ej: LT-AB123456)");
      return;
    }

    setAssigning(true);
    setError("");
    setSuccess("");

    try {
      const result = await vehicleApi.assignToShipment(vehicle.license_plate, { tracking_id: trackingId.trim() });
      setVehicle(result);
      setSuccess(result.message || "Vehículo asignado exitosamente");
      setTrackingId("");
      setSelectedPlate("");
      setAlreadyAssigned(null);
      // Reload available vehicles
      loadAvailableVehicles();
    } catch (err: any) {
      if (err.response?.status === 409) {
        const errorData = err.response?.data;
        if (errorData.assigned_shipment) {
          setAlreadyAssigned({
            shipment: errorData.assigned_shipment,
            status: errorData.current_status,
          });
          setError(`El vehículo ya está asignado al envío ${errorData.assigned_shipment}`);
        } else {
          setError(errorData.error || "No se puede asignar el vehículo");
        }
      } else if (err.response?.status === 404) {
        setError("El envío con ese tracking ID no existe");
      } else if (err.response?.status === 400) {
        setError(err.response?.data?.error || "Error en los datos");
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
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 24, fontSize: 24 }}>Asignar Vehículo a Envío</h1>

      {/* Lista de vehículos disponibles */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: "#111827" }}>
          Vehículos Disponibles
        </h2>

        {loading && availableVehicles.length === 0 ? (
          <p style={{ color: "#6b7280" }}>Cargando vehículos...</p>
        ) : availableVehicles.length === 0 ? (
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 24,
              textAlign: "center",
              color: "#6b7280",
            }}
          >
            No hay vehículos disponibles para asignar
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {availableVehicles.map((v) => (
              <div
                key={v.id}
                onClick={() => handleSelectVehicle(v.license_plate)}
                style={{
                  background: selectedPlate === v.license_plate ? "#eff6ff" : "#fff",
                  border: `2px solid ${selectedPlate === v.license_plate ? "#2563eb" : "#e5e7eb"}`,
                  borderRadius: 8,
                  padding: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (selectedPlate !== v.license_plate) {
                    e.currentTarget.style.borderColor = "#93c5fd";
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedPlate !== v.license_plate) {
                    e.currentTarget.style.borderColor = "#e5e7eb";
                  }
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: "#10b98120",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg style={{ width: 24, height: 24, color: "#10b981" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>{v.license_plate}</p>
                  <p style={{ fontSize: 13, color: "#6b7280", margin: "2px 0 0" }}>
                    {vehicleTypeLabels[v.type]} · {v.capacity_kg} kg
                  </p>
                </div>
                <div
                  style={{
                    padding: "4px 12px",
                    borderRadius: 9999,
                    background: "#10b98120",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#10b981",
                  }}
                >
                  Disponible
                </div>
                {selectedPlate === v.license_plate && (
                  <svg style={{ width: 24, height: 24, color: "#2563eb" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Formulario de asignación */}
      {vehicle && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
          }}
        >
          <div
            style={{
              background: vehicle.status === "disponible" ? "#dcfce7" : "#fef3c7",
              padding: 20,
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, color: "#6b7280", margin: 0, textTransform: "uppercase" }}>Vehículo Seleccionado</p>
                <h2 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0", color: "#111827" }}>
                  {vehicle.license_plate}
                </h2>
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 9999,
                  background: vehicle.status === "disponible" ? "#10b98120" : "#f59e0b20",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: vehicle.status === "disponible" ? "#10b981" : "#f59e0b",
                  }}
                />
                <span style={{ fontSize: 14, fontWeight: 600, color: vehicle.status === "disponible" ? "#10b981" : "#b45309" }}>
                  {vehicle.status_label}
                </span>
              </div>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 24 }}>
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>Tipo</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicleTypeLabels[vehicle.type]}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>Capacidad</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicle.capacity_kg} kg</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>ID</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>#{vehicle.id}</p>
              </div>
              {vehicle.assigned_shipment && (
                <div>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>Envío Asignado</p>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#1e3a5f", margin: 0 }}>{vehicle.assigned_shipment}</p>
                </div>
              )}
            </div>

            {/* Formulario de asignación - solo si está disponible */}
            {vehicle.status === "disponible" && !vehicle.assigned_shipment && (
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 20,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>
                  Asignar a Envío
                </h3>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                      Tracking ID del Envío *
                    </label>
                    <input
                      type="text"
                      value={trackingId}
                      onChange={(e) => setTrackingId(e.target.value.toUpperCase())}
                      placeholder="Ej: LT-AB123456"
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        fontSize: 14,
                        textTransform: "uppercase",
                      }}
                    />
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>
                      Formato: LT-XXXXXXXX (8 caracteres alfanuméricos)
                    </p>
                  </div>
                  <button
                    onClick={handleAssign}
                    disabled={assigning}
                    style={{
                      background: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 20px",
                      cursor: assigning ? "not-allowed" : "pointer",
                      fontWeight: 600,
                      fontSize: 14,
                      opacity: assigning ? 0.7 : 1,
                      height: 42,
                    }}
                  >
                    {assigning ? "Asignando..." : "Asignar"}
                  </button>
                </div>
              </div>
            )}

            {/* Vehículo ya asignado */}
            {alreadyAssigned && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 8,
                  padding: 20,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <svg
                    style={{ width: 24, height: 24, color: "#b45309", flexShrink: 0 }}
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
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "#92400e", margin: 0 }}>
                    Vehículo Ya Asignado
                  </h3>
                </div>
                <p style={{ fontSize: 14, color: "#78350f", margin: 0 }}>
                  Este vehículo ya está asignado al envío{" "}
                  <strong style={{ color: "#1e3a5f" }}>{alreadyAssigned.shipment}</strong>
                  {" "}y su estado actual es <strong>"{alreadyAssigned.status}"</strong>.
                </p>
                <p style={{ fontSize: 13, color: "#92400e", margin: "8px 0 0" }}>
                  Para asignar este vehículo a otro envío, primero debe finalizar o reasignar el envío actual.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mensaje de error */}
      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#dc2626",
            padding: "12px 16px",
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Mensaje de éxito */}
      {success && (
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            color: "#16a34a",
            padding: "12px 16px",
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 14,
          }}
        >
          {success}
        </div>
      )}

      {/* Información del vehículo */}
      {vehicle && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              background: vehicle.status === "disponible" ? "#dcfce7" : "#fef3c7",
              padding: 20,
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, color: "#6b7280", margin: 0, textTransform: "uppercase" }}>Patente</p>
                <h2 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0", color: "#111827" }}>
                  {vehicle.license_plate}
                </h2>
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 9999,
                  background: vehicle.status === "disponible" ? "#10b98120" : "#f59e0b20",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: vehicle.status === "disponible" ? "#10b981" : "#f59e0b",
                  }}
                />
                <span style={{ fontSize: 14, fontWeight: 600, color: vehicle.status === "disponible" ? "#10b981" : "#b45309" }}>
                  {vehicle.status_label}
                </span>
              </div>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 24 }}>
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>Tipo</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicleTypeLabels[vehicle.type]}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>Capacidad</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicle.capacity_kg} kg</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>ID</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>#{vehicle.id}</p>
              </div>
              {vehicle.assigned_shipment && (
                <div>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase" }}>Envío Asignado</p>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#1e3a5f", margin: 0 }}>{vehicle.assigned_shipment}</p>
                </div>
              )}
            </div>

            {/* Formulario de asignación - solo si está disponible */}
            {vehicle.status === "disponible" && !vehicle.assigned_shipment && (
              <div
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 20,
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: "0 0 16px" }}>
                  Asignar a Envío
                </h3>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                      Tracking ID del Envío *
                    </label>
                    <input
                      type="text"
                      value={trackingId}
                      onChange={(e) => setTrackingId(e.target.value.toUpperCase())}
                      placeholder="Ej: LT-XXXXXXXX"
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        fontSize: 14,
                        textTransform: "uppercase",
                      }}
                    />
                  </div>
                  <button
                    onClick={handleAssign}
                    disabled={assigning}
                    style={{
                      background: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "10px 20px",
                      cursor: assigning ? "not-allowed" : "pointer",
                      fontWeight: 600,
                      fontSize: 14,
                      opacity: assigning ? 0.7 : 1,
                      height: 42,
                    }}
                  >
                    {assigning ? "Asignando..." : "Asignar"}
                  </button>
                </div>
              </div>
            )}

            {/* Vehículo ya asignado */}
            {alreadyAssigned && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 8,
                  padding: 20,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <svg
                    style={{ width: 24, height: 24, color: "#b45309", flexShrink: 0 }}
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
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "#92400e", margin: 0 }}>
                    Vehículo Ya Asignado
                  </h3>
                </div>
                <p style={{ fontSize: 14, color: "#78350f", margin: 0 }}>
                  Este vehículo ya está asignado al envío{" "}
                  <strong style={{ color: "#1e3a5f" }}>{alreadyAssigned.shipment}</strong>
                  {" "}y su estado actual es <strong>"{alreadyAssigned.status}"</strong>.
                </p>
                <p style={{ fontSize: 13, color: "#92400e", margin: "8px 0 0" }}>
                  Para asignar este vehículo a otro envío, primero debe finalizar o reasignar el envío actual.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pie de página */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <button
          onClick={handleClear}
          style={{
            background: "none",
            border: "none",
            color: "#6b7280",
            cursor: "pointer",
            fontSize: 14,
            textDecoration: "underline",
          }}
        >
          Limpiar selección
        </button>
      </div>
    </div>
  );
}