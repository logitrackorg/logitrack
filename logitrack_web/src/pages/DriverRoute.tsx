import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { driverApi, type DriverRouteResponse } from "../api/driver";
import { shipmentApi } from "../api/shipments";
import { StatusBadge } from "../components/StatusBadge";

const ROUTE_STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  finalizada: "Finalizada",
};

const ROUTE_STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  pendiente: { bg: "#fef3c7", color: "#92400e" },
  en_curso: { bg: "#d1fae5", color: "#065f46" },
  finalizada: { bg: "#e0e7ff", color: "#3730a3" },
};

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
  const [startingRoute, setStartingRoute] = useState(false);
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");

  const load = () =>
    driverApi
      .getRoute()
      .then((d) => { setData(d); setNoRoute(false); })
      .catch(() => setNoRoute(true))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleStartRoute = async () => {
    setStartingRoute(true);
    setActionError("");
    try {
      await driverApi.startRoute();
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? "No se pudo iniciar la ruta.");
    } finally {
      setStartingRoute(false);
    }
  };

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
      setActionError(msg ?? "No se pudo registrar la entrega.");
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
      setActionError("No se pudo registrar el intento fallido.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 24 }}>Cargando…</div>;

  if (noRoute) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h1 style={{ margin: "0 0 8px" }}>Mi ruta</h1>
        <p style={{ color: "#6b7280", margin: 0 }}>No tenés ninguna ruta asignada para hoy.</p>
      </div>
    );
  }

  if (!data) return null;

  const routeStatus = data.route.status ?? "pendiente";
  const statusStyle = ROUTE_STATUS_COLOR[routeStatus] ?? ROUTE_STATUS_COLOR.pendiente;

  const [ry, rm, rd] = data.route.date.split("-");
  const today = `${rd}/${rm}/${ry}`;
  const pending = data.shipments.filter((s) => s.status === "out_for_delivery").length;
  const done = data.shipments.filter((s) => s.status === "delivered" || s.status === "delivery_failed").length;

  const filteredShipments = data.shipments.filter((s) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      s.tracking_id.toLowerCase().includes(q) ||
      s.recipient.name.toLowerCase().includes(q) ||
      (s.corrections?.recipient_name ?? "").toLowerCase().includes(q)
    );
  });

  if (routeStatus === "finalizada" && done > 0) {
    return (
      <div style={{ padding: 24, maxWidth: 600 }}>
        <h1 style={{ margin: "0 0 4px" }}>Mi ruta</h1>
        <p style={{ color: "#6b7280", margin: "0 0 16px", fontSize: 14 }}>{today}</p>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#15803d", marginBottom: 4 }}>Ruta finalizada</div>
          <div style={{ fontSize: 14, color: "#166534" }}>
            Completaste todos los envíos del día. {done} de {data.route.shipment_ids.length} procesados.
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {data.shipments.map((shipment) => {
            const cor = shipment.corrections ?? {};
            const recipientName = cor.recipient_name ?? shipment.recipient.name;
            return (
              <div
                key={shipment.tracking_id}
                onClick={() => navigate(`/shipments/${shipment.tracking_id}`)}
                style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <code style={{ fontSize: 11, color: "#9ca3af" }}>{shipment.tracking_id}</code>
                  <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{recipientName}</div>
                </div>
                <StatusBadge status={shipment.status} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Mi ruta</h1>
        <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: statusStyle.bg, color: statusStyle.color }}>
          {ROUTE_STATUS_LABEL[routeStatus]}
        </span>
      </div>
      <p style={{ color: "#6b7280", margin: "0 0 16px", fontSize: 14 }}>
        {today} · {data.shipments.length} envíos · {pending} pendientes · {done} completados
      </p>

      {routeStatus === "pendiente" && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>Ruta sin iniciar</div>
          <div style={{ fontSize: 13, color: "#78350f", marginBottom: 14 }}>
            Iniciá la ruta para habilitar las acciones de entrega. Una vez iniciada, no se pueden agregar nuevos envíos.
          </div>
          <button
            onClick={handleStartRoute}
            disabled={startingRoute}
            style={{
              background: startingRoute ? "#d1d5db" : "#f59e0b",
              color: startingRoute ? "#9ca3af" : "#fff",
              border: "none", borderRadius: 8, padding: "10px 24px",
              fontWeight: 700, fontSize: 15, cursor: startingRoute ? "default" : "pointer",
            }}
          >
            {startingRoute ? "Iniciando…" : "Iniciar ruta"}
          </button>
        </div>
      )}

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar por ID de seguimiento o destinatario..."
        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, boxSizing: "border-box", marginBottom: 16 }}
      />

      {actionError && (
        <p style={{ color: "#ef4444", margin: "0 0 16px", fontSize: 14 }}>{actionError}</p>
      )}

      {filteredShipments.length === 0 && (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No hay envíos que coincidan con la búsqueda.</p>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {filteredShipments.map((shipment) => {
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

            {routeStatus === "en_curso" && shipment.status === "out_for_delivery" && !failedShipmentId && !deliverShipmentId && (
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
                  Entregar
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
                  Intento fallido
                </button>
              </div>
            )}

            {routeStatus === "en_curso" && shipment.status === "out_for_delivery" && deliverShipmentId === shipment.tracking_id && (
              <div style={{ display: "grid", gap: 8, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                  DNI del destinatario
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
                    {submitting ? "Guardando…" : "Confirmar entrega"}
                  </button>
                  <button
                    onClick={() => setDeliverShipmentId(null)}
                    style={{
                      background: "#fff", color: "#374151", border: "1px solid #d1d5db",
                      borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 14,
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {routeStatus === "en_curso" && shipment.status === "out_for_delivery" && failedShipmentId === shipment.tracking_id && !deliverShipmentId && (
              <div style={{ display: "grid", gap: 8, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                <textarea
                  value={failedNotes}
                  onChange={(e) => setFailedNotes(e.target.value)}
                  placeholder="Motivo del intento fallido (obligatorio)"
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
                    {submitting ? "Guardando…" : "Confirmar"}
                  </button>
                  <button
                    onClick={() => setFailedShipmentId(null)}
                    style={{
                      background: "#fff", color: "#374151", border: "1px solid #d1d5db",
                      borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 14,
                    }}
                  >
                    Cancelar
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
