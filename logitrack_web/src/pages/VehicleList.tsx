import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { vehicleApi, type Vehicle, type VehicleStatus, type VehicleStatusResponse, type VehicleType } from "../api/vehicles";
import { shipmentApi } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";

const vehicleTypeLabels: Record<VehicleType, string> = {
  motocicleta: "Motorcycle",
  furgoneta: "Van",
  camion: "Truck",
  camion_grande: "Large Truck",
};

const vehicleStatusLabels: Record<VehicleStatus, string> = {
  disponible: "Available",
  en_carga: "Loading",
  mantenimiento: "Maintenance",
  en_transito: "In Transit",
  inactivo: "Inactive",
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
  const { hasRole } = useAuth();

  const isAdmin = hasRole("admin");
  // Supervisors and admins can perform write actions; managers get read-only access
  const canWrite = hasRole("admin") || hasRole("supervisor");

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
      setError("License plate is required");
      return;
    }
    if (formData.capacity_kg <= 0) {
      setError("Capacity must be greater than 0");
      return;
    }

    try {
      await vehicleApi.create(formData);
      setSuccess("Vehicle registered successfully");
      setShowForm(false);
      setFormData({ license_plate: "", type: "furgoneta", capacity_kg: 0, branch_id: "" });
      loadVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 409) {
        setError("A vehicle with that license plate already exists");
      } else if (e.response?.data?.error) {
        setError(e.response.data.error);
      } else {
        setError("Error registering vehicle");
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
      setError("You must select a vehicle");
      return;
    }
    setStartTripDestBranch("");
    setShowStartTripModal(true);
  };

  const confirmStartTrip = async () => {
    if (!selectedForAssign || !startTripDestBranch) return;
    setStartingTrip(true);
    setError("");
    try {
      await vehicleApi.startTrip(selectedForAssign, { destination_branch: startTripDestBranch });
      setSuccess("Trip started. All shipments are now in transit.");
      setShowStartTripModal(false);
      setSelectedForAssign("");
      loadVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? "Error starting trip");
    } finally {
      setStartingTrip(false);
    }
  };

  const handleEndTrip = async () => {
    if (!selectedForAssign) {
      setError("You must select a vehicle");
      return;
    }

    setError("");
    try {
      // Call the end-trip endpoint to clear shipment, destination_branch and change status to available
      await vehicleApi.endTrip(selectedForAssign);
      setSuccess("Trip ended. Vehicle is now available.");
      setSelectedForAssign("");
      loadVehicles();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      if (e.response?.data?.error) {
        setError(e.response.data.error);
      } else {
        setError("Error ending trip");
      }
    }
  };

  // Check if the selected vehicle can start trip (status is "en_carga")
  const canStartTrip = () => {
    if (!selectedForAssign) return false;
    const vehicle = vehicles.find(v => v.license_plate === selectedForAssign);
    return vehicle?.status === "en_carga";
  };

  // Check if the selected vehicle can end trip (status is "en_transito")
  const canEndTrip = () => {
    if (!selectedForAssign) return false;
    const vehicle = vehicles.find(v => v.license_plate === selectedForAssign);
    return vehicle?.status === "en_transito";
  };

  // Filtrar vehículos
  const filteredVehicles = vehicles.filter((v) => {
    if (statusFilter && v.status !== statusFilter) return false;
    if (showOnlyAvailable && v.status !== "disponible") return false;
    if (plateSearch && !v.license_plate.toUpperCase().includes(plateSearch.toUpperCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Fleet Management</h1>
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
              + New Vehicle
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
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Register New Vehicle</h2>
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
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>License Plate *</label>
                <input
                  type="text"
                  value={formData.license_plate}
                  onChange={(e) => setFormData({ ...formData, license_plate: e.target.value.toUpperCase() })}
                  placeholder="E.g.: AB123CD"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, textTransform: "uppercase", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Type *</label>
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
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Capacity (kg) *</label>
                <input
                  type="number"
                  value={formData.capacity_kg || ""}
                  onChange={(e) => setFormData({ ...formData, capacity_kg: parseFloat(e.target.value) || 0 })}
                  placeholder="E.g.: 500"
                  min="1"
                  step="0.1"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box" }}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Home Branch *</label>
                <select
                  value={formData.branch_id}
                  onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                  required
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff", boxSizing: "border-box" }}
                >
                  <option value="">Select a branch...</option>
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={handleCancel} style={{ background: "#e5e7eb", color: "#374151", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 500 }}>
                  Cancel
                </button>
                <button type="submit" style={{ background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontWeight: 600 }}>
                  Register
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
          onChange={(e) => setPlateSearch(e.target.value.toUpperCase())}
          placeholder="Search by plate..."
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
          {showOnlyAvailable ? "✓ Available" : "Available"}
        </button>
        <span style={{ fontSize: 14, fontWeight: 500, color: "#374151" }}>Filter by status:</span>
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
          <option value="">All statuses</option>
          <option value="disponible">Available</option>
          <option value="en_carga">Loading</option>
          <option value="en_transito">In Transit</option>
          <option value="mantenimiento">Maintenance</option>
          <option value="inactivo">Inactive</option>
        </select>
        {(statusFilter || showOnlyAvailable || plateSearch) && (
          <button
            onClick={() => { setStatusFilter(""); setShowOnlyAvailable(false); setPlateSearch(""); }}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 14,
              textDecoration: "underline",
            }}
          >
            Clear filters
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
        <p>Loading...</p>
      ) : filteredVehicles.length === 0 ? (
        <p style={{ color: "#6b7280" }}>No vehicles match the selected filters.</p>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
              {filteredVehicles.length} vehicle{filteredVehicles.length !== 1 ? "s" : ""} {showOnlyAvailable ? "available" : "in the fleet"}
            </p>
          </div>
          {canWrite && (
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
                  Start Trip
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
                  End Trip
                </button>
              </div>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 500 }}>
              <thead>
                <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                  {canWrite && <th style={thStyle}>Select</th>}
                  <th style={thStyle}>License Plate</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Current Branch</th>
                  <th style={thStyle}>Destination Branch</th>
                  <th style={thStyle}>Capacity (kg)</th>
                  <th style={thStyle}>Available Cap. (kg)</th>
                  <th style={thStyle}>Status</th>
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
                    {canWrite && (
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
                        return <span style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>No branch</span>;
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
        />
      )}

      {/* Start Trip modal — asks for destination branch */}
      {showStartTripModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowStartTripModal(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Start Trip</h2>
              <button onClick={() => setShowStartTripModal(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#6b7280" }}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>
              Vehicle <strong>{selectedForAssign}</strong> will start a trip. All loaded shipments will move to In Transit.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14 }}>Destination branch *</label>
              <select
                value={startTripDestBranch}
                onChange={(e) => setStartTripDestBranch(e.target.value)}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, background: "#fff" }}
              >
                <option value="">Select destination branch...</option>
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
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowStartTripModal(false)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 500 }}>
                Cancel
              </button>
              <button
                onClick={confirmStartTrip}
                disabled={!startTripDestBranch || startingTrip}
                style={{
                  padding: "8px 20px", borderRadius: 6, border: "none", fontWeight: 600,
                  background: !startTripDestBranch || startingTrip ? "#9ca3af" : "#3b82f6",
                  color: "#fff", cursor: !startTripDestBranch || startingTrip ? "not-allowed" : "pointer",
                  opacity: startingTrip ? 0.7 : 1,
                }}
              >
                {startingTrip ? "Starting..." : "Start Trip"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Vehicle Detail Modal Component
export function VehicleDetailModal({ vehicle, onClose, onRefresh, readOnly }: { vehicle: VehicleStatusResponse; onClose: () => void; onRefresh?: () => void; readOnly?: boolean }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [assigningBranch, setAssigningBranch] = useState(false);
  const [branchError, setBranchError] = useState("");
  const [branchSuccess, setBranchSuccess] = useState("");
  const [unassigning, setUnassigning] = useState<string | null>(null);
  const [unassignError, setUnassignError] = useState("");
  const [currentShipments, setCurrentShipments] = useState<string[]>(vehicle.assigned_shipments ?? []);

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
      setBranchError("Please select a branch");
      return;
    }
    setAssigningBranch(true);
    setBranchError("");
    setBranchSuccess("");
    try {
      await vehicleApi.assignBranch(vehicle.license_plate, { branch_id: selectedBranch });
      setBranchSuccess("Branch assigned successfully");
      setSelectedBranch("");
      onRefresh?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBranchError(e.response?.data?.error || "Error assigning branch");
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
      setUnassignError(e.response?.data?.error || "Error unassigning shipment");
    } finally {
      setUnassigning(null);
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
            <p style={{ fontSize: 13, color: "#6b7280", margin: 0, textTransform: "uppercase" }}>Vehicle Detail</p>
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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" }}>Vehicle Information</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Type</p>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicleTypeLabels[vehicle.type]}</p>
            </div>
            <div>
              <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Capacity</p>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: 0 }}>{vehicle.capacity_kg} kg</p>
            </div>
            {vehicle.updated_at && (
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Last Update</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#374151", margin: 0 }}>
                  {new Date(vehicle.updated_at).toLocaleString()}
                </p>
              </div>
            )}
            {vehicle.updated_by && (
              <div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 2px" }}>Updated By</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: "#374151", margin: 0 }}>{vehicle.updated_by}</p>
              </div>
            )}
          </div>
        </div>

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
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" }}>Current Branch</h3>
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
            <p style={{ fontSize: 13, color: "#6b7280", margin: hasShipments ? 0 : "0 0 12px" }}>No branch assigned</p>
          )}

          {!hasShipments && !readOnly && (
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
                <option value="">Change branch...</option>
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
                {assigningBranch ? "Assigning..." : "Assign Branch"}
              </button>
            </>
          )}
        </div>

        {/* Envíos asignados */}
        <div
          style={{
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 12px" }}>Assigned Shipments</h3>
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
                      Shipment tracking ID
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
                      View
                    </Link>
                    {!readOnly && (
                      <button
                        onClick={() => handleUnassign(trackingId)}
                        disabled={unassigning === trackingId}
                        title="Unassign shipment"
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
              <p style={{ fontSize: 14, margin: 0 }}>No assigned shipments</p>
              <p style={{ fontSize: 12, margin: "4px 0 0" }}>This vehicle has no shipments loaded</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, color: "#374151" };
const tdStyle: React.CSSProperties = { padding: "10px 14px" };