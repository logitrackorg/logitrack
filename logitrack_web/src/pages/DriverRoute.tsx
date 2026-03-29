import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { driverApi, type DriverRouteResponse } from "../api/driver";
import { shipmentApi } from "../api/shipments";
import { StatusBadge } from "../components/StatusBadge";
import { fmtDate } from "../utils/date";

export function DriverRoute() {
  const navigate = useNavigate();
  const [data, setData] = useState<DriverRouteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [noRoute, setNoRoute] = useState(false);
  const [failedShipmentId, setFailedShipmentId] = useState<string | null>(null);
  const [failedNotes, setFailedNotes] = useState("");
  const [deliverShipmentId, setDeliverShipmentId] = useState<string | null>(null);
  const [recipientDni, setRecipientDni] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = () =>
    driverApi
      .getRoute()
      .then((d) => { setData(d); setNoRoute(false); })
      .catch(() => setNoRoute(true))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleDeliver = async (trackingId: string) => {
    if (!recipientDni.trim()) return;
    setSubmitting(true);
    setActionError("");
    try {
      await shipmentApi.updateStatus(trackingId, {
        status: "delivered",
        location: "",
        recipient_dni: recipientDni.trim(),
      });
      setDeliverShipmentId(null);
      setRecipientDni("");
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "Error al registrar la entrega.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFailedAttempt = async (trackingId: string) => {
    if (!failedNotes.trim()) return;
    setSubmitting(true);
    setActionError("");
    try {
      await shipmentApi.updateStatus(trackingId, {
        status: "delivery_failed",
        location: "",
        notes: failedNotes.trim(),
      });
      setFailedShipmentId(null);
      setFailedNotes("");
      load();
    } catch {
      setActionError("Error al registrar el intento fallido.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;

  if (noRoute || !data) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h1 style={{ margin: "0 0 8px" }}>My route</h1>
        <p style={{ color: "#6b7280", margin: 0 }}>No route assigned for today.</p>
      </div>
    );
  }

  const today = fmtDate(data.route.date + "T00:00:00Z");
  const pending = data.shipments.filter((s) => s.status === "delivering").length;
  const done = data.shipments.filter((s) => s.status === "delivered" || s.status === "delivery_failed").length;

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h1 style={{ margin: "0 0 4px" }}>My route</h1>
      <p style={{ color: "#6b7280", margin: "0 0 6px", fontSize: 14 }}>
        {today} · {data.shipments.length} shipments · {pending} pending · {done} completed
      </p>

      {actionError && (
        <p style={{ color: "#ef4444", margin: "0 0 16px", fontSize: 14 }}>{actionError}</p>
      )}

      <div style={{ display: "grid", gap: 14, marginTop: 20 }}>
        {data.shipments.map((shipment) => {
          const cor = shipment.corrections ?? {};
          const recipientName = cor.recipient_name ?? shipment.recipient.name;
          const recipientPhone = cor.recipient_phone ?? shipment.recipient.phone;
          const destAddress = [
            cor.destination_street ?? shipment.recipient.address?.street,
            cor.destination_city ?? shipment.recipient.address?.city,
            cor.destination_province ?? shipment.recipient.address?.province,
          ].filter(Boolean).join(", ");
          const specialInstructions = cor.special_instructions ?? shipment.special_instructions;

          return (
          <div
            key={shipment.tracking_id}
            onClick={() => navigate(`/shipments/${shipment.tracking_id}`)}
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 16,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <code style={{ fontSize: 12, color: "#6b7280" }}>{shipment.tracking_id}</code>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{recipientName}</div>
                <div style={{ fontSize: 13, color: "#4b5563", marginTop: 2 }}>{recipientPhone}</div>
                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>{destAddress}</div>
              </div>
              <StatusBadge status={shipment.status} />
            </div>

            {specialInstructions && (
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "6px 10px" }}>
                {specialInstructions}
              </p>
            )}

            {shipment.status === "delivering" && !failedShipmentId && !deliverShipmentId && (
              <div style={{ display: "flex", gap: 8, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { setDeliverShipmentId(shipment.tracking_id); setRecipientDni(""); }}
                  disabled={submitting}
                  style={{
                    background: "#10b981", color: "#fff", border: "none",
                    borderRadius: 6, padding: "8px 20px", cursor: "pointer",
                    fontWeight: 700, fontSize: 14,
                  }}
                >
                  Deliver
                </button>
                <button
                  onClick={() => { setFailedShipmentId(shipment.tracking_id); setFailedNotes(""); }}
                  disabled={submitting}
                  style={{
                    background: "#fff", color: "#dc2626", border: "1px solid #dc2626",
                    borderRadius: 6, padding: "8px 16px", cursor: "pointer",
                    fontWeight: 600, fontSize: 14,
                  }}
                >
                  Failed attempt
                </button>
              </div>
            )}

            {shipment.status === "delivering" && deliverShipmentId === shipment.tracking_id && (
              <div style={{ display: "grid", gap: 8, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                  Recipient DNI
                </label>
                <input
                  value={recipientDni}
                  onChange={(e) => setRecipientDni(e.target.value)}
                  placeholder="Ej: 30123456"
                  style={{
                    padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db",
                    fontSize: 14, width: "100%", boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleDeliver(shipment.tracking_id)}
                    disabled={!recipientDni.trim() || submitting}
                    style={{
                      background: !recipientDni.trim() ? "#e5e7eb" : "#10b981",
                      color: !recipientDni.trim() ? "#9ca3af" : "#fff",
                      border: "none", borderRadius: 6, padding: "8px 16px",
                      cursor: !recipientDni.trim() ? "default" : "pointer",
                      fontWeight: 700, fontSize: 14,
                    }}
                  >
                    {submitting ? "Saving..." : "Confirm delivery"}
                  </button>
                  <button
                    onClick={() => setDeliverShipmentId(null)}
                    style={{
                      background: "#fff", color: "#374151", border: "1px solid #d1d5db",
                      borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 14,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {shipment.status === "delivering" && failedShipmentId === shipment.tracking_id && !deliverShipmentId && (
              <div style={{ display: "grid", gap: 8, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                <textarea
                  value={failedNotes}
                  onChange={(e) => setFailedNotes(e.target.value)}
                  placeholder="Reason for failed attempt (required)"
                  rows={2}
                  style={{
                    padding: "8px 12px", borderRadius: 6, border: "1px solid #fca5a5",
                    fontSize: 14, resize: "vertical", width: "100%", boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleFailedAttempt(shipment.tracking_id)}
                    disabled={!failedNotes.trim() || submitting}
                    style={{
                      background: !failedNotes.trim() ? "#e5e7eb" : "#dc2626",
                      color: !failedNotes.trim() ? "#9ca3af" : "#fff",
                      border: "none", borderRadius: 6, padding: "8px 16px",
                      cursor: !failedNotes.trim() ? "default" : "pointer",
                      fontWeight: 700, fontSize: 14,
                    }}
                  >
                    {submitting ? "Saving..." : "Confirm"}
                  </button>
                  <button
                    onClick={() => setFailedShipmentId(null)}
                    style={{
                      background: "#fff", color: "#374151", border: "1px solid #d1d5db",
                      borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 14,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );})}
      </div>
    </div>
  );
}
