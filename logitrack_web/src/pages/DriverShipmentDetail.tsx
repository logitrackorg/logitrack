import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { shipmentApi, type Shipment } from "../api/shipments";
import { StatusBadge } from "../components/StatusBadge";

const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Envelope",
  box: "Box",
  pallet: "Pallet",
  fragile: "Fragile",
};

export function DriverShipmentDetail() {
  const { trackingId } = useParams<{ trackingId: string }>();
  const navigate = useNavigate();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!trackingId) return;
    shipmentApi
      .get(trackingId)
      .then(setShipment)
      .catch(() => setError("Shipment not found."))
      .finally(() => setLoading(false));
  }, [trackingId]);

  if (loading) return <div style={{ padding: 24 }}>Cargando...</div>;
  if (error || !shipment) return <div style={{ padding: 24, color: "#ef4444" }}>{error || "Not found."}</div>;

  const cor = shipment.corrections ?? {};
  const cv = (key: string, fallback: string) => cor[key] ?? fallback;

  const packageType = cv("package_type", shipment.package_type);
  const weightKg = cv("weight_kg", String(shipment.weight_kg));
  const specialInstructions = cv("special_instructions", shipment.special_instructions ?? "");
  const recipientName = cv("recipient_name", shipment.recipient_name);
  const recipientPhone = cv("recipient_phone", shipment.recipient_phone);
  const destAddress = [
    cor.destination_street ?? shipment.destination?.street,
    cor.destination_city ?? shipment.destination?.city,
    cor.destination_province ?? shipment.destination?.province,
    cor.destination_postal_code ?? shipment.destination?.postal_code,
  ].filter(Boolean).join(", ");

  return (
    <div style={{ padding: 24, maxWidth: 540 }}>
      <button
        onClick={() => navigate("/driver/route")}
        style={{ background: "none", border: "none", color: "#1e3a5f", cursor: "pointer", fontSize: 14, padding: 0, marginBottom: 20, fontWeight: 600 }}
      >
        ← Mi ruta
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <code style={{ fontSize: 13, color: "#6b7280" }}>{shipment.tracking_id}</code>
          <div style={{ marginTop: 4 }}>
            <StatusBadge status={shipment.status} />
          </div>
        </div>
      </div>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>Paquete</h2>
        <Row label="Tipo" value={PACKAGE_LABELS[packageType] ?? packageType} />
        <Row label="Peso" value={`${weightKg} kg`} />
        {specialInstructions && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 13, color: "#92400e" }}>
            {specialInstructions}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitle}>Destinatario</h2>
        <Row label="Nombre" value={recipientName} />
        <Row label="Teléfono" value={recipientPhone} />
        <Row label="Dirección" value={destAddress} />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 14 }}>
      <span style={{ color: "#6b7280", minWidth: 80 }}>{label}</span>
      <span style={{ color: "#111827", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};

const sectionTitle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 13,
  fontWeight: 700,
  color: "#374151",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};
