import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, Search, AlertCircle, CheckCircle2, XCircle, Phone, MapPin, AlertTriangle, Play, Calendar } from "lucide-react";
import { driverApi, type DriverRouteResponse } from "../api/driver";
import { shipmentApi } from "../api/shipments";
import { StatusBadge } from "../components/StatusBadge";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { Card } from "../components/ui/card";
import { GradientCard, GradientCardIcon, GradientCardLabel } from "../components/ui/gradient-card";

const ROUTE_STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  finalizada: "Finalizada",
};

const ROUTE_STATUS_COLOR: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  en_curso: "bg-emerald-100 text-emerald-800",
  finalizada: "bg-indigo-100 text-indigo-800",
};

const inputClass =
  "h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

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

  if (loading) return <div className="p-6 text-sm text-slate-500">Cargando…</div>;

  if (noRoute) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="flex items-start gap-3 mb-6 pb-4 border-b border-slate-200">
          <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">Mi ruta</h1>
            <p className="mt-1 text-sm text-slate-500">No tenés ninguna ruta asignada para hoy.</p>
          </div>
        </div>
        <Card className="p-8 text-center">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Cuando un supervisor te asigne envíos, los vas a ver acá.</p>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const routeStatus = data.route.status ?? "pendiente";

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
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-start gap-3 mb-5 pb-4 border-b border-slate-200">
          <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">Mi ruta</h1>
            <p className="mt-1 text-sm text-slate-500">{today}</p>
          </div>
        </div>

        <GradientCard tone="emerald" className="mb-5">
          <div className="flex items-start gap-3">
            <GradientCardIcon><CheckCircle2 className="w-5 h-5" /></GradientCardIcon>
            <div>
              <GradientCardLabel>Ruta finalizada</GradientCardLabel>
              <p className="mt-1 text-base font-semibold">
                Completaste todos los envíos del día. {done} de {data.route.shipment_ids.length} procesados.
              </p>
            </div>
          </div>
        </GradientCard>

        <div className="grid gap-2">
          {data.shipments.map((shipment) => {
            const cor = shipment.corrections ?? {};
            const recipientName = cor.recipient_name ?? shipment.recipient.name;
            return (
              <Card
                key={shipment.tracking_id}
                onClick={() => navigate(`/shipments/${shipment.tracking_id}`)}
                className="px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <code className="text-[11px] font-mono text-slate-400">{shipment.tracking_id}</code>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">{recipientName}</p>
                </div>
                <StatusBadge status={shipment.status} label={shipmentStatusLabelOverride(shipment)} />
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-2 pb-4 border-b border-slate-200">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">Mi ruta</h1>
            <p className="mt-1 text-xs text-slate-500">
              {today} · {data.shipments.length} envíos · {pending} pendientes · {done} completados
            </p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ROUTE_STATUS_COLOR[routeStatus] ?? ROUTE_STATUS_COLOR.pendiente}`}>
          {ROUTE_STATUS_LABEL[routeStatus]}
        </span>
      </div>

      {routeStatus === "pendiente" && (
        <Card className="p-5 mt-5 mb-5 border-amber-200 bg-amber-50/50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900">Ruta sin iniciar</p>
              <p className="mt-1 text-xs text-amber-800">
                Iniciá la ruta para habilitar las acciones de entrega. Una vez iniciada, no se pueden agregar nuevos envíos.
              </p>
              <button
                onClick={handleStartRoute}
                disabled={startingRoute}
                className="mt-3 inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-sm font-bold cursor-pointer transition-colors"
              >
                <Play className="w-4 h-4" />
                {startingRoute ? "Iniciando…" : "Iniciar ruta"}
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="relative mt-5 mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por ID o destinatario…"
          className={`${inputClass} w-full pl-9`}
        />
      </div>

      {actionError && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {actionError}
        </div>
      )}

      {filteredShipments.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-slate-500">No hay envíos que coincidan con la búsqueda.</p>
        </Card>
      )}

      <div className="grid gap-3">
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
            <Card
              key={shipment.tracking_id}
              onClick={() => navigate(`/shipments/${shipment.tracking_id}`)}
              className="p-4 cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <code className="text-xs font-mono text-slate-500">{shipment.tracking_id}</code>
                  <p className="text-base font-bold text-slate-900 mt-0.5 truncate">{recipientName}</p>
                  <p className="text-sm text-slate-600 mt-1 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{recipientPhone}</span>
                  </p>
                  <p className="text-sm text-slate-500 mt-1 flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>{destAddress}</span>
                  </p>
                </div>
                <StatusBadge status={shipment.status} label={shipmentStatusLabelOverride(shipment)} />
              </div>

              {specialInstructions && (
                <div className="mb-3 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span>{specialInstructions}</span>
                </div>
              )}

              {routeStatus === "en_curso" && shipment.status === "out_for_delivery" && !failedShipmentId && !deliverShipmentId && (
                <div className="flex gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { setDeliverShipmentId(shipment.tracking_id); setRecipientDni(""); }}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold cursor-pointer transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Entregar
                  </button>
                  <button
                    onClick={() => { setFailedShipmentId(shipment.tracking_id); setFailedNotes(""); }}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-sm font-semibold cursor-pointer transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    Intento fallido
                  </button>
                </div>
              )}

              {routeStatus === "en_curso" && shipment.status === "out_for_delivery" && deliverShipmentId === shipment.tracking_id && (
                <div className="grid gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                  <label className="text-xs font-semibold text-slate-700">DNI del destinatario</label>
                  <input
                    value={recipientDni}
                    onChange={(e) => setRecipientDni(e.target.value)}
                    placeholder="Ej: 30123456"
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDeliver(shipment.tracking_id)}
                      disabled={!recipientDni.trim() || submitting}
                      className="h-10 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
                    >
                      {submitting ? "Guardando…" : "Confirmar entrega"}
                    </button>
                    <button
                      onClick={() => setDeliverShipmentId(null)}
                      className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {routeStatus === "en_curso" && shipment.status === "out_for_delivery" && failedShipmentId === shipment.tracking_id && !deliverShipmentId && (
                <div className="grid gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    value={failedNotes}
                    onChange={(e) => setFailedNotes(e.target.value)}
                    placeholder="Motivo del intento fallido (obligatorio)"
                    rows={2}
                    className="px-3 py-2 rounded-lg border border-rose-300 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-rose-200 focus:border-rose-500 resize-y"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleFailedAttempt(shipment.tracking_id)}
                      disabled={!failedNotes.trim() || submitting}
                      className="h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
                    >
                      {submitting ? "Guardando…" : "Confirmar"}
                    </button>
                    <button
                      onClick={() => setFailedShipmentId(null)}
                      className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
