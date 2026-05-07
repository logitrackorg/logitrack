import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Box, User, AlertTriangle } from "lucide-react";
import { shipmentApi, type Shipment } from "../api/shipments";
import { StatusBadge } from "../components/StatusBadge";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { Card, CardContent, CardHeader } from "../components/ui/card";

const PACKAGE_LABELS: Record<string, string> = {
  envelope: "Sobre",
  box: "Caja",
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
      .catch(() => setError("Envío no encontrado."))
      .finally(() => setLoading(false));
  }, [trackingId]);

  if (loading) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;
  if (error || !shipment) return <div className="p-6 text-sm text-rose-600">{error || "No encontrado."}</div>;

  const cor = shipment.corrections ?? {};
  const cv = (key: string, fallback: string) => cor[key] ?? fallback;

  const packageType = cv("package_type", shipment.package_type);
  const weightKg = cv("weight_kg", String(shipment.weight_kg));
  const specialInstructions = cv("special_instructions", shipment.special_instructions ?? "");
  const recipientName = cv("recipient_name", shipment.recipient.name);
  const recipientPhone = cv("recipient_phone", shipment.recipient.phone);
  const destAddress = [
    cor.destination_street ?? shipment.recipient.address?.street,
    cor.destination_city ?? shipment.recipient.address?.city,
    cor.destination_province ?? shipment.recipient.address?.province,
    cor.destination_postal_code ?? shipment.recipient.address?.postal_code,
  ].filter(Boolean).join(", ");

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate("/driver/route")}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1e3a5f] hover:text-[#15294a] mb-5 cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" />
        Mi ruta
      </button>

      <div className="flex justify-between items-start mb-5 pb-4 border-b border-slate-200">
        <div>
          <code className="text-sm font-mono text-slate-500">{shipment.tracking_id}</code>
          <div className="mt-2">
            <StatusBadge status={shipment.status} label={shipmentStatusLabelOverride(shipment)} />
          </div>
        </div>
      </div>

      <Card className="mb-3">
        <CardHeader className="flex items-center gap-2 border-b border-slate-100">
          <Box className="w-4 h-4 text-slate-500" />
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Paquete</h2>
        </CardHeader>
        <CardContent className="grid gap-2 pt-3 text-sm">
          <Row label="Tipo" value={PACKAGE_LABELS[packageType] ?? packageType} />
          {shipment.is_fragile && (
            <Row label="Frágil" value="⚠️ Sí" highlight />
          )}
          <Row label="Peso" value={`${weightKg} kg`} />
          <Row
            label="Entrega"
            value={(shipment.delivery_method ?? "ultima_milla") === "retiro_sucursal" ? "Retiro en sucursal" : "Última milla"}
          />
          {specialInstructions && (
            <div className="mt-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span>{specialInstructions}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2 border-b border-slate-100">
          <User className="w-4 h-4 text-slate-500" />
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Destinatario</h2>
        </CardHeader>
        <CardContent className="grid gap-2 pt-3 text-sm">
          <Row label="Nombre" value={recipientName} />
          <Row label="Teléfono" value={recipientPhone} />
          <Row label="Dirección" value={destAddress} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="text-slate-500 min-w-[80px]">{label}</span>
      <span className={highlight ? "font-semibold text-amber-700" : "font-medium text-slate-900"}>{value}</span>
    </div>
  );
}
