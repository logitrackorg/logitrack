import { useState, useEffect, useRef, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, Plus, Trash2, Clock } from "lucide-react";
import type { InterBranchAssignment, AssignmentStop } from "../api/routing";
import type { Branch } from "../api/branches";
import { branchLabelById } from "../api/branches";
import type { Shipment } from "../api/shipments";
import { PriorityBadge } from "./PriorityBadge";
import { DISPATCH_RULE_LABELS } from "../api/routing";
import { fmtMinutesAsTime } from "../utils/date";

// Leaflet default icon fix (idempotent)
delete (L.Icon.Default.prototype as typeof L.Icon.Default.prototype & { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// ---------------------------------------------------------------------------
// InterBranchRouteMap — mapa Leaflet con origen y destinos de sucursal
// ---------------------------------------------------------------------------
function InterBranchRouteMap({
  originBranch,
  stops,
  branches,
}: {
  originBranch: Branch | undefined;
  stops: string[]; // branch IDs en orden: [destination, ...additionalStops]
  branches: Branch[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: L.LatLngExpression = originBranch?.latitude != null && originBranch?.longitude != null
      ? [originBranch.latitude, originBranch.longitude]
      : [-34.6037, -58.3816];
    const map = L.map(containerRef.current, { center, zoom: 5, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const points: [number, number][] = [];

    // Origen
    if (originBranch?.latitude != null && originBranch?.longitude != null) {
      const pt: [number, number] = [originBranch.latitude, originBranch.longitude];
      points.push(pt);
      L.marker(pt, {
        icon: L.divIcon({
          html: `<div style="width:28px;height:28px;background:var(--sidebar-bg);border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,.3)">🏭</div>`,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).bindPopup(`<b>Origen: ${originBranch.name}</b>`).addTo(layer);
    }

    // Destinos
    const originId = originBranch?.id ?? "";
    let stopNum = 1;
    stops.forEach((branchId, i) => {
      const b = branches.find((x) => x.id === branchId);
      if (!b || b.latitude == null || b.longitude == null) return;
      const pt: [number, number] = [b.latitude, b.longitude];
      points.push(pt);
      // Si la parada es el origen = retorno backhaul → ↩; sino número de parada.
      const isReturn = branchId === originId && i === stops.length - 1;
      const label = isReturn ? "↩" : String(stopNum++);
      const bg = isReturn ? "#059669" : "#0f766e";
      const popupText = isReturn ? `<b>Retorno: ${b.name}</b>` : `<b>Parada ${label}: ${b.name}</b>`;
      L.marker(pt, {
        icon: L.divIcon({
          html: `<div style="width:28px;height:28px;background:${bg};border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:${isReturn ? 14 : 11}px;color:white;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.3)">${label}</div>`,
          className: "",
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        }),
      }).bindPopup(popupText).addTo(layer);
    });

    if (points.length < 2) {
      if (points.length === 1) map.setView(points[0], 8);
      return;
    }

    try {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    } catch { /* bounds vacíos */ }

    // Trazar cada segmento individualmente para que en round-trips (A→B→A)
    // la ida y la vuelta sean visibles aunque compartan el mismo recorrido.
    // Segmento i = points[i] → points[i+1].
    const segmentColors = ["var(--sidebar-bg)", "#0f766e", "#b45309", "#7c3aed"];
    const fetchSegment = (i: number) => {
      if (!layerRef.current || i >= points.length - 1) return;
      const segPoints = [points[i], points[i + 1]];
      const color = segmentColors[i % segmentColors.length];
      const osrmCoords = segPoints.map(([lat, lng]) => `${lng},${lat}`).join(";");
      fetch(`https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson`)
        .then((r) => r.json())
        .then((data) => {
          if (!layerRef.current) return;
          if (data.code === "Ok" && data.routes?.[0]) {
            const coords: [number, number][] = data.routes[0].geometry.coordinates.map(
              (c: number[]) => [c[1], c[0]] as [number, number],
            );
            L.polyline(coords, { color, weight: 3, opacity: 0.80, dashArray: i === 0 ? undefined : "7,5" }).addTo(layerRef.current);
          } else {
            L.polyline(segPoints, { color, weight: 3, opacity: 0.65, dashArray: i === 0 ? undefined : "7,5" }).addTo(layerRef.current);
          }
          fetchSegment(i + 1);
        })
        .catch(() => {
          if (layerRef.current) {
            L.polyline(segPoints, { color, weight: 3, opacity: 0.65, dashArray: i === 0 ? undefined : "7,5" }).addTo(layerRef.current);
          }
          fetchSegment(i + 1);
        });
    };
    fetchSegment(0);
  }, [originBranch, stops, branches]);

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%", borderRadius: "0.5rem", zIndex: 0 }} />
  );
}

// ---------------------------------------------------------------------------
// ReviewInterBranchModal
// ---------------------------------------------------------------------------
export interface ReviewInterBranchModalProps {
  assignment: InterBranchAssignment;
  originBranchId: string;
  branches: Branch[];
  shipments: Map<string, Shipment>;
  applying?: boolean;
  onClose: () => void;
  onConfirm: (additionalStops: AssignmentStop[], departureMin: number, scheduledDate: string) => void;
}

const minToHHMM = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const hhmmToMin = (s: string) => {
  const [h, mm] = s.split(":").map(Number);
  return (h || 0) * 60 + (mm || 0);
};

export function ReviewInterBranchModal({
  assignment,
  originBranchId,
  branches,
  shipments,
  applying,
  onClose,
  onConfirm,
}: ReviewInterBranchModalProps) {
  const a = assignment;

  // Envíos que son cross-branch pickups: se levantan en paradas intermedias,
  // no salen desde el origen. No deben aparecer en el selector de paradas.
  const pickupSet = new Set<string>([
    ...(a.primary_pickup_shipments ?? []),
    ...(a.additional_stops ?? []).flatMap((s) => s.pickup_shipments ?? []),
  ]);

  // Envíos que salen desde el origen (excluye pickups)
  const originShipments = a.shipments.filter((tid) => !pickupSet.has(tid));

  const [additionalStops, setAdditionalStops] = useState<AssignmentStop[]>(
    () => (a.additional_stops ?? []).map((s) => ({ ...s })),
  );

  // Hora de salida editable. El default es el momento de aplicar + 30 min
  // (anclado al apply, como última milla). Cambiarla desplaza todo el itinerario
  // por el mismo delta: los tramos de viaje calculados por el plan no cambian,
  // solo se reanclan a la nueva salida. baseDepartureMin es ese ancla del plan.
  const baseDepartureMin = a.estimated_departure_min ?? 8 * 60;
  const hasArrivals = (a.estimated_arrival_min ?? 0) > 0 || (a.primary_estimated_arrival_min ?? 0) > 0;
  const defaultDepartureMin = useMemo(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes() + 30;
  }, []);
  const [departureMin, setDepartureMin] = useState<number>(defaultDepartureMin);
  const delta = departureMin - baseDepartureMin;
  const shift = (m?: number): number | undefined => (m && m > 0 ? m + delta : undefined);
  // Fecha de salida: por defecto hoy o la fecha ya persistida en el assignment.
  const todayISO = new Date().toISOString().slice(0, 10);
  const [scheduledDate, setScheduledDate] = useState<string>(a.scheduled_date ?? todayISO);
  const [addingStop, setAddingStop] = useState(false);
  const [newStopBranchId, setNewStopBranchId] = useState("");
  const [newStopShipments, setNewStopShipments] = useState<Set<string>>(new Set());

  // Cuando se elige una sucursal, auto-seleccionar los envíos de origen cuyo destino coincide.
  function handleNewStopBranchChange(branchId: string) {
    setNewStopBranchId(branchId);
    if (!branchId) {
      setNewStopShipments(new Set());
      return;
    }
    const alreadyInOtherStop = new Set(additionalStops.flatMap((s) => s.shipments));
    const autoSelected = new Set(
      originShipments.filter((tid) => {
        if (alreadyInOtherStop.has(tid)) return false;
        const sh = shipments.get(tid);
        const dest = sh?.is_returning ? sh.origin_branch_id : sh?.final_branch_id;
        return dest === branchId;
      }),
    );
    setNewStopShipments(autoSelected);
  }

  // Mapa tid → nombre de la sucursal donde se levanta (para pickups)
  const pickupBranchByTid = new Map<string, string>();
  (a.primary_pickup_shipments ?? []).forEach((tid) =>
    pickupBranchByTid.set(tid, branchLabelById(a.destination_branch, branches)),
  );
  (a.additional_stops ?? []).forEach((st) =>
    (st.pickup_shipments ?? []).forEach((tid) =>
      pickupBranchByTid.set(tid, branchLabelById(st.branch_id, branches)),
    ),
  );

  const pickupWeight = Array.from(pickupSet).reduce(
    (sum, tid) => sum + (shipments.get(tid)?.weight_kg ?? 0),
    0,
  );
  const originWeight = a.total_weight_kg - pickupWeight;
  const totalLoaded = originWeight + a.existing_weight_kg;
  const utilPct = a.capacity_kg > 0 ? Math.round((totalLoaded / a.capacity_kg) * 100) : 0;

  const originBranch = branches.find((b) => b.id === originBranchId);
  const mapStops = [a.destination_branch, ...additionalStops.map((s) => s.branch_id)];

  const usedBranchIds = new Set<string>([
    originBranchId,
    a.destination_branch,
    ...additionalStops.map((s) => s.branch_id),
  ]);
  const candidateBranches = branches.filter((b) => b.status === "activo" && !usedBranchIds.has(b.id));

  const canAddMore = additionalStops.length < 2;

  function openAddStop() {
    setNewStopBranchId("");
    setNewStopShipments(new Set());
    setAddingStop(true);
  }

  function closeAddStop() {
    setAddingStop(false);
  }

  function saveAddStop() {
    if (!newStopBranchId || newStopShipments.size === 0) return;
    const selected = Array.from(newStopShipments);
    const weight = selected.reduce((sum, tid) => sum + (shipments.get(tid)?.weight_kg ?? 0), 0);
    setAdditionalStops((prev) => [
      ...prev,
      { branch_id: newStopBranchId, shipments: selected, total_weight_kg: Math.round(weight * 10) / 10 },
    ]);
    setAddingStop(false);
  }

  function removeStop(idx: number) {
    setAdditionalStops((prev) => prev.filter((_, i) => i !== idx));
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const appliedSet = new Set(a.applied_shipments ?? []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-semibold text-slate-900">
              Revisar despacho · {a.license_plate}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {branchLabelById(originBranchId, branches)}
              {" → "}
              {branchLabelById(a.destination_branch, branches)}
              {additionalStops.map((st, i) => {
                // La última parada que coincide con el origen es el retorno backhaul.
                const isReturn = a.backhaul && i === additionalStops.length - 1 && st.branch_id === originBranchId;
                return (
                  <span key={i}>
                    {" › "}
                    {branchLabelById(st.branch_id, branches)}
                    {isReturn && <span className="text-emerald-600 ml-1">(retorno)</span>}
                  </span>
                );
              })}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: dos columnas */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Columna izquierda: mapa + KPIs */}
          <div className="w-[42%] shrink-0 flex flex-col border-r border-slate-200">
            <div className="flex-1 min-h-0 p-3 pb-2">
              <InterBranchRouteMap
                originBranch={originBranch}
                stops={mapStops}
                branches={branches}
              />
            </div>

            {/* KPIs */}
            <div className="shrink-0 px-4 py-3 border-t border-slate-100 space-y-2">
              {/* Badge de backhaul */}
              {a.backhaul && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
                  <span className="text-emerald-700 font-bold text-sm">↩</span>
                  <div>
                    <span className="text-xs font-semibold text-emerald-800">Backhaul (retorno al origen)</span>
                    <span className="text-xs text-emerald-600 ml-2">
                      {a.backhaul.shipments.length} envíos · {a.backhaul.total_weight_kg.toFixed(1)} kg · {a.backhaul.fill_rate_pct.toFixed(0)}% cap.
                    </span>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                <span className="font-medium">{originShipments.length} envíos de origen</span>
                {pickupSet.size > 0 && (
                  <span className="text-slate-400">+ {pickupSet.size} pickup{pickupSet.size > 1 ? "s" : ""} en ruta</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                <span>{totalLoaded.toFixed(1)} / {a.capacity_kg} kg ({utilPct}%)</span>
                {pickupWeight > 0 && (
                  <span className="text-slate-400 text-xs">+ {pickupWeight.toFixed(1)} kg pickups</span>
                )}
              </div>
              {/* Horarios estimados (fecha + salida editables) */}
              {(
                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-medium">Fecha y hora de salida</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <label className="flex items-center gap-1.5">
                        <span>Fecha</span>
                        <input
                          type="date"
                          value={scheduledDate}
                          min={todayISO}
                          onChange={(e) => setScheduledDate(e.target.value || todayISO)}
                          className="h-7 px-1.5 rounded border border-slate-300 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--sidebar-bg)]"
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        <span>Salir a</span>
                        <input
                          type="time"
                          value={minToHHMM(departureMin)}
                          onChange={(e) => setDepartureMin(hhmmToMin(e.target.value))}
                          className="h-7 px-1.5 rounded border border-slate-300 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--sidebar-bg)]"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-slate-500 pl-5">
                    <span className="text-slate-400">Salida</span>
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {fmtMinutesAsTime(departureMin)} · {branchLabelById(originBranchId, branches)}
                    </span>
                    {shift(a.primary_estimated_arrival_min) !== undefined && (
                      <>
                        <span className="text-slate-400">Llega</span>
                        <span className="font-semibold text-slate-700 tabular-nums">
                          {fmtMinutesAsTime(shift(a.primary_estimated_arrival_min)!)} · {branchLabelById(a.destination_branch, branches)}
                        </span>
                      </>
                    )}
                    {additionalStops.map((st, i) => {
                      const arr = shift(a.additional_stops?.[i]?.estimated_arrival_min);
                      if (arr === undefined) return null;
                      return (
                        <span key={i} className="contents">
                          <span className="text-slate-400">Llega</span>
                          <span className="font-semibold text-slate-700 tabular-nums">
                            {fmtMinutesAsTime(arr)} · {branchLabelById(st.branch_id, branches)}
                          </span>
                        </span>
                      );
                    })}
                    {shift(a.estimated_arrival_min) !== undefined &&
                      a.estimated_arrival_min !== a.primary_estimated_arrival_min && (
                      <>
                        <span className="text-slate-400 font-medium">Llegada final</span>
                        <span className="font-bold text-slate-800 tabular-nums">
                          {fmtMinutesAsTime(shift(a.estimated_arrival_min)!)}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-[10.5px] text-slate-400 pl-5">
                    {scheduledDate !== todayISO
                      ? `Salida programada para el ${scheduledDate.split("-").reverse().join("/")} · llegadas recalculadas.`
                      : departureMin === defaultDepartureMin
                      ? "Default: 30 min después de ahora. Editá la fecha u hora si querés otro horario."
                      : hasArrivals
                      ? "Salida ajustada · llegadas recalculadas."
                      : "Salida ajustada."}
                  </p>
                </div>
              )}

              <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${a.rule === "sla_forced" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>
                {DISPATCH_RULE_LABELS[a.rule]}
              </span>

              {/* Paradas adicionales */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Paradas adicionales</span>
                  {canAddMore && (
                    <button
                      onClick={openAddStop}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-dashed border-slate-300 text-slate-500 hover:border-[var(--sidebar-bg)] hover:text-[var(--sidebar-bg)] transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Agregar
                    </button>
                  )}
                </div>
                {additionalStops.length === 0 ? (
                  <p className="text-[11px] text-slate-400">Sin paradas adicionales.</p>
                ) : (
                  <div className="space-y-1">
                    {additionalStops.map((st, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-amber-900 truncate">{branchLabelById(st.branch_id, branches)}</p>
                          <p className="text-[11px] text-amber-700">{st.shipments.length} envíos · {st.total_weight_kg.toFixed(1)} kg</p>
                        </div>
                        <button
                          onClick={() => removeStop(i)}
                          className="shrink-0 p-1 rounded text-amber-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Quitar parada"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Columna derecha: lista de envíos (read-only) */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
            {a.shipments.map((tid, i) => {
              const sh = shipments.get(tid);
              const alreadyApplied = appliedSet.has(tid);
              const pickupBranch = pickupBranchByTid.get(tid);
              const isPickup = !!pickupBranch;
              return (
                <div
                  key={tid}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${
                    alreadyApplied
                      ? "border-emerald-200 bg-emerald-50/60"
                      : isPickup
                      ? "border-slate-200 bg-slate-50/50 opacity-70"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  {/* Número de secuencia */}
                  <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${isPickup ? "bg-slate-100 text-slate-400" : "bg-slate-200 text-slate-600"}`}>
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-mono text-xs font-semibold text-slate-700">{tid}</span>
                      {sh?.priority && <PriorityBadge priority={sh.priority} />}
                      {sh?.is_fragile && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">FRÁGIL</span>
                      )}
                      {sh?.shipment_type === "express" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">Express</span>
                      )}
                      {isPickup && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                          Se levanta en {pickupBranch}
                        </span>
                      )}
                      {alreadyApplied && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">Ya aplicado</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 truncate">
                      {sh?.recipient?.name}
                      {sh?.recipient?.address?.city && (
                        <span className="text-slate-400"> · {sh.recipient.address.city}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {sh?.weight_kg != null && `${sh.weight_kg.toFixed(1)} kg`}
                      {sh?.final_branch_id && (
                        <span className="ml-2">Destino final: {branchLabelById(sh.final_branch_id, branches)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            disabled={applying}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer text-slate-600 disabled:opacity-40 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(additionalStops, departureMin, scheduledDate)}
            disabled={applying}
            className="px-4 py-2 text-sm bg-[var(--sidebar-bg)] hover:bg-[#15294a] disabled:opacity-40 text-white rounded-lg font-semibold cursor-pointer transition-colors"
          >
            {applying ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </div>

      {/* Sub-panel: agregar parada */}
      {addingStop && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeAddStop(); }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[75vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Agregar parada</h3>
              <button onClick={closeAddStop} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sucursal de destino</label>
                <select
                  value={newStopBranchId}
                  onChange={(e) => handleNewStopBranchChange(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sidebar-bg)]"
                >
                  <option value="">— Elegí una sucursal —</option>
                  {candidateBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {candidateBranches.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">No hay sucursales disponibles para agregar.</p>
                )}
              </div>
              {newStopBranchId && (() => {
                const alreadyInOtherStop = new Set(additionalStops.flatMap((s) => s.shipments));
                const relevant = originShipments.filter((tid) => {
                  if (alreadyInOtherStop.has(tid)) return false;
                  const sh = shipments.get(tid);
                  const dest = sh?.is_returning ? sh.origin_branch_id : sh?.final_branch_id;
                  return dest === newStopBranchId;
                });
                if (relevant.length === 0) {
                  return (
                    <p className="text-[11px] text-amber-600">
                      No hay envíos en este despacho con destino a esa sucursal.
                    </p>
                  );
                }
                return (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Envíos que bajan en esta parada
                    </label>
                    <p className="text-[11px] text-slate-500 mb-2">
                      Pre-seleccionados según destino final. Podés deseleccionar si alguno continúa.
                    </p>
                    <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-md">
                      {relevant.map((tid) => {
                        const sh = shipments.get(tid);
                        const isApplied = appliedSet.has(tid);
                        return (
                          <label
                            key={tid}
                            className={`flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0 text-xs ${isApplied ? "opacity-50" : "hover:bg-slate-50 cursor-pointer"}`}
                          >
                            <input
                              type="checkbox"
                              checked={newStopShipments.has(tid)}
                              disabled={isApplied}
                              onChange={(e) => {
                                const next = new Set(newStopShipments);
                                if (e.target.checked) next.add(tid); else next.delete(tid);
                                setNewStopShipments(next);
                              }}
                            />
                            <span className="font-mono text-slate-700">{tid}</span>
                            {sh && <span className="ml-auto text-slate-400 tabular-nums">{sh.weight_kg.toFixed(1)} kg</span>}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={closeAddStop}
                className="h-9 px-3 rounded-md text-sm text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={saveAddStop}
                disabled={!newStopBranchId || newStopShipments.size === 0}
                className="h-9 px-4 rounded-md text-sm font-semibold bg-[var(--sidebar-bg)] hover:bg-[#15294a] disabled:opacity-40 text-white cursor-pointer"
              >
                Agregar parada
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
