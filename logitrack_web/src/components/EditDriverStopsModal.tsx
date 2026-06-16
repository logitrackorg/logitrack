import { useState, useMemo, useEffect, useRef, useCallback } from "react";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, RotateCcw, X, AlertTriangle, Clock, Loader2, ShieldAlert, DollarSign, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LastMileAssignment, RoutingConfig, RouteMode, LatLng } from "../api/routing";
import { routingApi } from "../api/routing";
import type { Shipment } from "../api/shipments";
import { zoneApi, ZONE_COLOR, type Zone } from "../api/zones";
import { recomputeETA, fmtHHMM } from "../utils/routingEta";
import { PriorityBadge } from "./PriorityBadge";

// Leaflet default icon fix (idempotent)
delete (L.Icon.Default.prototype as typeof L.Icon.Default.prototype & { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

function windowLabel(tw: string | undefined): string {
  if (tw === "morning") return "Mañana";
  if (tw === "afternoon") return "Tarde";
  return "Flexible";
}

// ---------------------------------------------------------------------------
// SortableStop — una fila arrastrable de la lista de paradas
// ---------------------------------------------------------------------------
function SortableStop({
  id,
  index,
  shipment,
  eta,
}: {
  id: string;
  index: number;
  shipment: Shipment | undefined;
  eta: ReturnType<typeof recomputeETA>["stops"][number] | undefined;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  const outside = eta?.outsideWindow ?? false;
  const addressParts = shipment
    ? [shipment.recipient.address.street, shipment.recipient.address.city].filter(Boolean)
    : [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 p-3 rounded-lg border dark:bg-gray-800 bg-white ${outside ? "border-amber-300 bg-amber-50/40" : "dark:border-gray-700 border-slate-200"
        } ${isDragging ? "shadow-lg" : ""}`}
    >
      {/* Drag handle */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="cursor-grab active:cursor-grabbing mt-0.5 shrink-0 touch-none [&_svg]:dark:text-gray-500 text-slate-400 hover:[&_svg]:dark:text-gray-400 text-slate-600"
        {...attributes}
        {...listeners}
        tabIndex={-1}
      >
        <GripVertical className="w-4 h-4" />
      </Button>

      {/* Sequence badge */}
      <div className="w-6 h-6 rounded-full bg-[var(--sidebar-bg)] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {index + 1}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <span className="font-mono text-xs font-semibold dark:text-gray-300 text-slate-700">{id}</span>
          {shipment?.priority && <PriorityBadge priority={shipment.priority} />}
          {shipment?.is_fragile && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
              FRÁGIL
            </span>
          )}
        </div>
        <div className="text-xs dark:text-gray-400 text-slate-600 truncate">
          {shipment?.recipient.name}
          {addressParts.length > 0 && (
            <span className="dark:text-gray-500 text-slate-400"> · {addressParts.join(", ")}</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] dark:text-gray-400 text-slate-500 flex-wrap">
          <span>🕗 {windowLabel(shipment?.time_window)}</span>
          {eta && (
            <>
              <span>ETA {fmtHHMM(eta.arrivalTime)}</span>
              {eta.distanceFromPrevKm > 0 && (
                <span>{eta.distanceFromPrevKm.toFixed(1)} km</span>
              )}
            </>
          )}
          {outside && eta && (
            <span className="flex items-center gap-1 text-amber-700 font-medium">
              <AlertTriangle className="w-3 h-3" />
              {Math.abs(eta.windowDeviationMin).toFixed(0)} min{" "}
              {eta.windowDeviationMin > 0 ? "tarde" : "temprano"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoutePreviewMap — mapa Leaflet simple con polyline recta (sin OSRM)
// ---------------------------------------------------------------------------
function RoutePreviewMap({
  stops,
  shipmentMap,
  branchCoords,
  zones = [],
  safeMode = false,
  roadPolyline,
}: {
  stops: string[];
  shipmentMap: Map<string, Shipment>;
  branchCoords: { lat: number; lng: number } | null;
  zones?: Zone[];
  safeMode?: boolean;
  /** Geometría real del trayecto (vía calles) calculada por el backend con OSRM.
   *  Cuando está presente la usamos para la polyline; si está vacía caemos a
   *  líneas rectas entre paradas. */
  roadPolyline?: LatLng[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: L.LatLngExpression = branchCoords
      ? [branchCoords.lat, branchCoords.lng]
      : [-34.6037, -58.3816];
    const map = L.map(containerRef.current, { center, zoom: 12, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    zonesLayerRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Init solo una vez: branchCoords se usa como centro inicial; cambios
    // posteriores se manejan en el effect siguiente (fitBounds).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Renderizar zonas peligrosas
  useEffect(() => {
    const layer = zonesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    zones.filter((z) => z.active).forEach((z) => {
      const latLngs = z.polygon.map((p) => [p.lat, p.lng] as [number, number]);
      L.polygon(latLngs, {
        color: ZONE_COLOR.stroke,
        fillColor: ZONE_COLOR.stroke,
        fillOpacity: safeMode ? 0.35 : 0.18,
        weight: safeMode ? 2.5 : 1.5,
        opacity: safeMode ? 1.0 : 0.7,
      })
        .bindPopup(
          `<div style="font-family:system-ui;min-width:140px">
            <p style="font-weight:700;font-size:13px;margin:0 0 3px">⚠️ ${z.name}</p>
            ${z.description ? `<p style="font-size:11px;color:#64748b;margin:0">${z.description}</p>` : ""}
          </div>`,
        )
        .addTo(layer);
    });
  }, [zones, safeMode]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const points: [number, number][] = [];

    if (branchCoords) {
      points.push([branchCoords.lat, branchCoords.lng]);
      L.marker([branchCoords.lat, branchCoords.lng], {
        icon: L.divIcon({
          html: `<div style="width:26px;height:26px;background:var(--sidebar-bg);border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 1px 4px rgba(0,0,0,.3)">🏭</div>`,
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .bindPopup("<b>Sucursal (origen)</b>")
        .addTo(layer);
    }

    stops.forEach((tid, i) => {
      const sh = shipmentMap.get(tid);
      const lat = sh?.recipient?.address?.latitude;
      const lng = sh?.recipient?.address?.longitude;
      if (lat == null || lng == null) return;
      points.push([lat, lng]);
      const name = sh?.recipient?.name ?? tid;
      const addr = [sh?.recipient?.address?.street, sh?.recipient?.address?.city]
        .filter(Boolean)
        .join(", ");
      L.marker([lat, lng], {
        icon: L.divIcon({
          html: `<div style="width:26px;height:26px;background:var(--sidebar-bg);border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:11px;color:white;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,.3)">${i + 1}</div>`,
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 26],
        }),
      })
        .bindPopup(
          `<b>#${i + 1} · ${name}</b><br/><span style="font-size:12px;color:#64748b">${addr}</span>`,
        )
        .addTo(layer);
    });

    // Polyline: si tenemos geometría real del backend (OSRM) la usamos;
    // si no, caemos a líneas rectas entre paradas (incluyendo depósito).
    const linePoints: [number, number][] =
      roadPolyline && roadPolyline.length >= 2
        ? roadPolyline.map((p) => [p.lat, p.lng] as [number, number])
        : points;
    if (linePoints.length >= 2) {
      L.polyline(linePoints, { color: "var(--sidebar-bg)", weight: 3, opacity: 0.7 }).addTo(layer);
      try {
        map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
      } catch {
        // fitBounds falla con bounds vacíos
      }
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [stops, shipmentMap, branchCoords, roadPolyline]);

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", width: "100%", borderRadius: "0.5rem", zIndex: 0 }}
    />
  );
}

// ---------------------------------------------------------------------------
// EditDriverStopsModal — modal principal
// ---------------------------------------------------------------------------
export interface EditDriverStopsModalProps {
  assignment: LastMileAssignment;
  shipmentMap: Map<string, Shipment>;
  branchCoords: { lat: number; lng: number } | null;
  config: RoutingConfig;
  /** Fecha del plan en formato YYYY-MM-DD. Si es futura, se muestra junto a la hora de salida. */
  planDate?: string;
  /** Fechas disponibles del horizonte para cambiar el contexto de optimización. */
  availableDates?: { date: string; label: string }[];
  onClose: () => void;
  /** Recibe los tracking IDs en el orden elegido por el operador y el modo de ruta activo. */
  onApply: (orderedTids: string[], mode: RouteMode) => Promise<void>;
}

const ROUTE_MODES: { mode: RouteMode; label: string; tooltip: string; icon: React.ReactNode }[] = [
  {
    mode: "ventanas",
    label: "Ventanas",
    tooltip: "Maximiza entregas dentro de su franja horaria (mañana/tarde). El VRP elige el orden y la hora de salida óptimos.",
    icon: <CalendarClock className="w-3.5 h-3.5" />,
  },
  {
    mode: "segura",
    label: "Segura",
    tooltip: "Igual que Ventanas pero evita rutas que atraviesen zonas peligrosas. Si la entrega está dentro de la zona, se incluye igual.",
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
  },
  {
    mode: "costo",
    label: "Costo",
    tooltip: "Minimiza la distancia total. El orden no cambia por ventanas, pero la hora de salida se ajusta para cumplir la mayor cantidad posible. Las paradas fuera de ventana se marcan en amarillo.",
    icon: <DollarSign className="w-3.5 h-3.5" />,
  },
];

function depMinToString(depMin: number | undefined, fallbackHour: number): string {
  if (depMin != null && depMin > 0) {
    const h = Math.floor(depMin / 60);
    const m = depMin % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return `${String(fallbackHour).padStart(2, "0")}:00`;
}

export function EditDriverStopsModal({
  assignment,
  shipmentMap,
  branchCoords,
  config,
  planDate,
  availableDates,
  onClose,
  onApply,
}: EditDriverStopsModalProps) {
  const originalOrder = useMemo(() => [...assignment.shipments], [assignment.shipments]);
  const [stops, setStops] = useState<string[]>([...originalOrder]);
  const [departure, setDeparture] = useState<string>(() =>
    depMinToString(assignment.suggested_departure_min, config.morning_window_start_hour),
  );
  const [mode, setMode] = useState<RouteMode>(assignment.route_mode ?? "ventanas");
  const [selectedDate, setSelectedDate] = useState<string>(planDate ?? "");
  const [recomputing, setRecomputing] = useState(false);
  const [manuallyReordered, setManuallyReordered] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  // Geometría real del trayecto (OSRM, vía calles). Se setea con cada recompute
  // del backend. Al reordenar manual con drag, queda stale → la invalidamos
  // para que el mapa caiga a líneas rectas hasta el próximo recompute/apply.
  const [roadPolyline, setRoadPolyline] = useState<LatLng[] | undefined>(
    assignment.polyline_coords,
  );

  useEffect(() => {
    zoneApi.list().then(setZones).catch(() => { });
  }, []);

  const recomputeForModeRef = useRef(async (_targetMode: RouteMode, _shipmentIds: string[], _overrideDate?: string) => {});

  recomputeForModeRef.current = async (targetMode: RouteMode, shipmentIds: string[], overrideDate?: string) => {
    setRecomputing(true);
    setError("");
    const dateToUse = overrideDate ?? (selectedDate || planDate);
    try {
      const updated = await routingApi.recomputeLastMile({
        vehicle_id: assignment.vehicle_id,
        shipment_ids: shipmentIds,
        mode: targetMode,
        ...(dateToUse ? { plan_date: dateToUse } : {}),
      });
      if (updated.ordered_stops && updated.ordered_stops.length > 0) {
        setStops(updated.ordered_stops.map((s) => s.tracking_id));
      }
      setDeparture(depMinToString(updated.suggested_departure_min, config.morning_window_start_hour));
      setRoadPolyline(updated.polyline_coords);
      setManuallyReordered(false);
    } catch {
      setError("No se pudo recalcular la ruta. Intentá de nuevo.");
    } finally {
      setRecomputing(false);
    }
  };

  const recomputeForMode = useCallback(
    (targetMode: RouteMode, shipmentIds: string[], overrideDate?: string) => {
      return recomputeForModeRef.current(targetMode, shipmentIds, overrideDate);
    },
    [],
  );

  const handleModeChange = useCallback(
    (newMode: RouteMode) => {
      if (newMode === mode) return;
      setMode(newMode);
      void recomputeForMode(newMode, stops);
    },
    [mode, stops, recomputeForMode],
  );

  const handleDateChange = useCallback(
    (newDate: string) => {
      if (newDate === selectedDate) return;
      setSelectedDate(newDate);
      void recomputeForMode(mode, stops, newDate);
    },
    [selectedDate, mode, stops, recomputeForMode],
  );

  // Apply está habilitado solo cuando se edita el plan del día base (hoy).
  // Los planes de pronóstico no se pueden aplicar desde el backend.
  const canApplyDate = !planDate || selectedDate === planDate;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const parsedDeparture = useMemo(() => {
    const [h, m] = departure.split(":").map(Number);
    const d = new Date();
    d.setHours(h ?? 8, m ?? 0, 0, 0);
    return d;
  }, [departure]);

  const eta = useMemo(
    () => recomputeETA(stops, shipmentMap, branchCoords, parsedDeparture, config),
    [stops, shipmentMap, branchCoords, parsedDeparture, config],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setManuallyReordered(true);
      // El reorder manual deja la polyline OSRM stale → cae a líneas rectas
      // hasta que el operador apply o cambie de modo (que dispara un recompute).
      setRoadPolyline(undefined);
      setStops((prev) => {
        const oldIdx = prev.indexOf(active.id as string);
        const newIdx = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIdx, newIdx);
      });
    },
    [],
  );

  const handleApply = async () => {
    setApplying(true);
    setError("");
    try {
      await onApply(stops, mode);
    } catch {
      setError("No se pudo aplicar la ruta. Intentá de nuevo.");
      setApplying(false);
    }
  };

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const driverLabel = assignment.driver_name
    ? `${assignment.driver_name} · ${assignment.license_plate}`
    : assignment.license_plate;

  // Etiqueta de fecha cuando el plan es de un día futuro.
  const planDateLabel = (() => {
    if (!planDate) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (planDate === today) return null;
    const [y, m, d] = planDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  })();

  const violations = eta.stops.filter((s) => s.outsideWindow).length;
  const totalKm = eta.totalDistanceKm.toFixed(1);
  const totalMin = Math.round(eta.totalDurationMin);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dark:bg-gray-800 bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[85vh] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b dark:border-gray-700 border-slate-200 shrink-0 gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold dark:text-gray-100 text-slate-900">Editar paradas · {driverLabel}</h2>
            <p className="text-xs dark:text-gray-400 text-slate-500 mt-0.5">
              {stops.length} paradas · Arrastrá para reordenar
              {manuallyReordered && (
                <span className="ml-2 text-amber-600 font-medium">· Orden manual</span>
              )}
            </p>
            {/* Mode selector */}
            <div className="flex items-center gap-1.5 mt-2.5">
              {ROUTE_MODES.map(({ mode: m, label, tooltip, icon }) => (
                <Button
                  key={m}
                  title={tooltip}
                  disabled={recomputing}
                  variant={mode === m ? "default" : "outline"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => void handleModeChange(m)}
                >
                  {mode === m && recomputing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    icon
                  )}
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Body: dos columnas */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* Columna izquierda: mapa fijo + KPIs */}
          <div className="w-[42%] shrink-0 flex flex-col border-r dark:border-gray-700 border-slate-200">
            {/* Mapa — ocupa todo el espacio disponible */}
            <div className="flex-1 min-h-0 p-3 pb-2">
              <RoutePreviewMap stops={stops} shipmentMap={shipmentMap} branchCoords={branchCoords} zones={zones} safeMode={mode === "segura"} roadPolyline={roadPolyline} />
            </div>

            {/* KPIs + hora de salida */}
            <div className="shrink-0 px-4 py-3 border-t dark:border-gray-700 border-slate-100 space-y-2.5">
              {/* Selector de día del horizonte */}
              {availableDates && availableDates.length > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  {availableDates.map(({ date, label }) => (
                    <Button
                      key={date}
                      disabled={recomputing}
                      variant={selectedDate === date ? "default" : "outline"}
                      size="sm"
                      className="rounded-full"
                      onClick={() => handleDateChange(date)}
                    >
                      <CalendarClock className="w-3 h-3" />
                      {label}
                    </Button>
                  ))}
                </div>
              )}
              {planDateLabel && selectedDate === planDate && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                  <CalendarClock className="w-3.5 h-3.5 shrink-0" />
                  Programado para {planDateLabel}
                </div>
              )}
              <div className="flex items-center gap-2 text-sm dark:text-gray-400 text-slate-600">
                <Clock className="w-4 h-4 shrink-0 dark:text-gray-500 text-slate-400" />
                <span className="shrink-0 dark:text-gray-400 text-slate-500">Salida</span>
                <input
                  type="time"
                  value={departure}
                  onChange={(e) => setDeparture(e.target.value)}
                  className="border dark:border-gray-700 border-slate-200 rounded px-1.5 py-0.5 text-sm font-mono dark:text-gray-300 text-slate-800 focus:outline-none focus:ring-1 focus:ring-[var(--sidebar-bg)]"
                />
                {planDateLabel && (
                  <span className="text-xs dark:text-gray-500 text-slate-400">del {planDate?.slice(8, 10)}/{planDate?.slice(5, 7)}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm dark:text-gray-400 text-slate-500">
                <span>{totalKm} km</span>
                <span>{durationStr}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className={`font-medium ${violations === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                  {eta.stops.length - violations}/{eta.stops.length} en ventana
                </span>
                <span className="dark:text-gray-400 text-slate-500">Regresa {fmtHHMM(eta.returnTime)}</span>
              </div>
            </div>
          </div>

          {/* Columna derecha: lista scrollable */}
          <div className="flex-1 overflow-y-auto p-4">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={stops} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2">
                  {stops.map((tid, i) => (
                    <SortableStop
                      key={tid}
                      id={tid}
                      index={i}
                      shipment={shipmentMap.get(tid)}
                      eta={eta.stops[i]}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t dark:border-gray-700 border-slate-200 shrink-0 gap-3">
          <Button
            variant="ghost"
            disabled={recomputing}
            onClick={() => void recomputeForMode(mode, originalOrder)}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurar óptimo
          </Button>
          <div className="flex items-center gap-3">
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Button
              variant="outline"
              onClick={onClose}
              disabled={applying}
            >
              Cancelar
            </Button>
            <Button
              variant="default"
              onClick={handleApply}
              disabled={applying || !canApplyDate}
              title={!canApplyDate ? "Los planes de pronóstico no se pueden aplicar. Volvé a este día cuando corresponda." : undefined}
            >
              {applying
                ? "Aplicando…"
                : !canApplyDate
                  ? `Solo visualización (${selectedDate.slice(8, 10)}/${selectedDate.slice(5, 7)})`
                  : planDateLabel
                    ? `Programar para el ${planDate?.slice(8, 10)}/${planDate?.slice(5, 7)}`
                    : "Aplicar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
