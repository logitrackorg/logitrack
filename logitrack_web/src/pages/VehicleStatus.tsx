import { useState, useEffect } from "react";
import { vehicleApi, type VehicleStatusResponse, type VehicleStatus, type VehicleType, type UpdateVehicleStatusRequest } from "../api/vehicles";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

const vehicleTypeLabels: Record<VehicleType, string> = {
  motocicleta: "Motorcycle",
  furgoneta: "Van",
  camion: "Truck",
  camion_grande: "Large Truck",
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
  { value: "disponible", label: "Available" },
  { value: "en_transito", label: "In Transit" },
  { value: "mantenimiento", label: "Under Repair" },
  { value: "inactivo", label: "Inactive" },
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
      setError("License plate is required");
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
        setError(e.response?.data?.error || "Search error");
      } else {
        setError("Error looking up vehicle");
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
        setSuccess(`Trip ended. Vehicle is now available.`);
        setShowStatusModal(false);
      } else {
        const data: UpdateVehicleStatusRequest = {
          status: newStatus,
          notes: notes || undefined,
          force: showForceConfirm,
        };

        const updated = await vehicleApi.updateStatus(vehicle.license_plate, data);
        setVehicle(updated);
        setSuccess(`Status updated to "${updated.status_label}"`);
        setShowStatusModal(false);
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; requires_force?: boolean } } };
      if (e.response?.status === 409) {
        const errorData = e.response?.data;
        setTransitionError(errorData?.error || "Invalid transition");
        if (errorData?.requires_force) {
          setShowForceConfirm(true);
        }
      } else if (e.response?.status === 400) {
        setTransitionError(e.response?.data?.error || "Invalid data");
      } else {
        setTransitionError(e.response?.data?.error || "Error updating status");
      }
    } finally {
      setChangingStatus(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 24, fontSize: 24 }}>Vehicle Status Lookup</h1>

      {/* Search form */}
      <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
              License Plate *
            </label>
            <input
              type="text"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="E.g.: AB123CD"
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: 16,
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              background: "#1e3a5f",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "10px 20px",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 14,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Looking up..." : "Look Up"}
          </button>
          <button
            type="button"
            onClick={handleClear}
            style={{
              background: "#e5e7eb",
              color: "#374151",
              border: "none",
              borderRadius: 6,
              padding: "10px 20px",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: 14,
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {/* Error message */}
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

      {/* Vehicle not found */}
      {notFound && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            color: "#92400e",
            padding: "16px 20px",
            borderRadius: 8,
            marginBottom: 20,
            textAlign: "center",
          }}
        >
          <svg
            style={{ width: 48, height: 48, margin: "0 auto 12px", display: "block" }}
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
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Vehicle not found</p>
          <p style={{ fontSize: 14, margin: "4px 0 0", opacity: 0.8 }}>
            No vehicle with license plate <strong>{plate.toUpperCase()}</strong> was found in the system.
          </p>
        </div>
      )}

      {/* Success message */}
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

      {/* Lookup result */}
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
          {/* Header with status */}
          <div
            style={{
              background: `${getStatusColor(vehicle.status)}15`,
              padding: 24,
              borderBottom: `2px solid ${getStatusColor(vehicle.status)}30`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, color: "#6b7280", margin: 0, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  License Plate
                </p>
                <h2 style={{ fontSize: 28, fontWeight: 700, margin: "4px 0 0", color: "#111827" }}>
                  {vehicle.license_plate}
                </h2>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    borderRadius: 9999,
                    background: `${getStatusColor(vehicle.status)}20`,
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      background: getStatusColor(vehicle.status),
                      animation: "pulse 2s infinite",
                    }}
                  />
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: getStatusColor(vehicle.status),
                    }}
                  >
                    {vehicle.status_label}
                  </span>
                </div>
                <button
                  onClick={openStatusModal}
                  style={{
                    background: "#1e3a5f",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    cursor: "pointer",
                    fontWeight: 500,
                    fontSize: 14,
                  }}
                >
                  Change Status
                </button>
              </div>
            </div>
          </div>

          {/* Vehicle information */}
          <div style={{ padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", margin: "0 0 16px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Vehicle Information
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 16,
              }}
            >
              <InfoCard
                label="Type"
                value={vehicleTypeLabels[vehicle.type] || vehicle.type}
                icon={
                  <svg style={{ width: 20, height: 20 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a1 1 0 100-2 1 1 0 000 2z" />
                  </svg>
                }
              />
              <InfoCard
                label="Capacity"
                value={`${vehicle.capacity_kg} kg`}
                icon={
                  <svg style={{ width: 20, height: 20 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                }
              />
              <InfoCard
                label="Last Update"
                value={formatDate(vehicle.updated_at)}
                icon={
                  <svg style={{ width: 20, height: 20 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              {vehicle.updated_by && (
                <InfoCard
                  label="Updated By"
                  value={vehicle.updated_by}
                  icon={
                    <svg style={{ width: 20, height: 20 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  }
                />
              )}
              <InfoCard
                label="Vehicle ID"
                value={`#${vehicle.id}`}
                icon={
                  <svg style={{ width: 20, height: 20 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                }
              />
              {vehicle.assigned_branch && (() => {
                const branch = branches.find(b => b.id === vehicle.assigned_branch);
                return (
                  <InfoCard
                    label="Assigned Branch"
                    value={branch ? `${branch.name} — ${branch.address.city}` : vehicle.assigned_branch}
                    icon={
                      <svg style={{ width: 20, height: 20 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                    label="Destination Branch"
                    value={branch ? `${branch.name} — ${branch.address.city}` : vehicle.destination_branch}
                    icon={
                      <svg style={{ width: 20, height: 20 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
              <div
                style={{
                  marginTop: 24,
                  padding: 16,
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                }}
              >
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#1e40af", margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                  <svg style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Assigned Shipments
                </h3>
                <p style={{ fontSize: 16, fontWeight: 600, color: "#1e3a5f", margin: 0 }}>
                  {vehicle.assigned_shipments.join(", ")}
                </p>
                <p style={{ fontSize: 13, color: "#6b7280", margin: "4px 0 0" }}>
                  This vehicle has active shipments loaded.
                </p>
              </div>
            )}

            {/* No assigned shipment */}
            {!(vehicle.assigned_shipments && vehicle.assigned_shipments.length > 0) && vehicle.status === "disponible" && (
              <div
                style={{
                  marginTop: 24,
                  padding: 16,
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                }}
              >
                <p style={{ fontSize: 14, color: "#16a34a", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <svg style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Vehicle available for assignment
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status change modal */}
      {showStatusModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => !changingStatus && setShowStatusModal(false)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              maxWidth: 450,
              width: "90%",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 20px", color: "#111827" }}>
              Change Vehicle Status
            </h2>

            {transitionError && (
              <div
                style={{
                  background: showForceConfirm ? "#fffbeb" : "#fef2f2",
                  border: `1px solid ${showForceConfirm ? "#fde68a" : "#fecaca"}`,
                  color: showForceConfirm ? "#92400e" : "#dc2626",
                  padding: "12px 16px",
                  borderRadius: 6,
                  marginBottom: 16,
                  fontSize: 14,
                }}
              >
                {transitionError}
                {showForceConfirm && (
                  <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                    Do you want to force the status change anyway?
                  </p>
                )}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                New Status *
              </label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as VehicleStatus)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for status change..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                disabled={changingStatus}
                style={{
                  background: "#e5e7eb",
                  color: "#374151",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 16px",
                  cursor: changingStatus ? "not-allowed" : "pointer",
                  fontWeight: 500,
                  opacity: changingStatus ? 0.7 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStatusChange}
                disabled={changingStatus}
                style={{
                  background: "#1e3a5f",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 20px",
                  cursor: changingStatus ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  opacity: changingStatus ? 0.7 : 1,
                }}
              >
                {changingStatus ? "Saving..." : (showForceConfirm ? "Force Change" : "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Initial instructions */}
      {!vehicle && !error && !notFound && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: "#6b7280",
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
          <p style={{ fontSize: 16, margin: 0 }}>
            Enter the vehicle license plate to look up its current status
          </p>
        </div>
      )}
    </div>
  );
}

function InfoCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div style={{ color: "#6b7280", flexShrink: 0 }}>{icon}</div>
      <div>
        <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {label}
        </p>
        <p style={{ fontSize: 16, fontWeight: 600, color: "#111827", margin: 0 }}>{value}</p>
      </div>
    </div>
  );
}