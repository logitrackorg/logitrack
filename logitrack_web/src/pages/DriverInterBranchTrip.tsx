import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Package,
  Play,
  QrCode,
  Truck,
  Weight,
  X,
} from "lucide-react";
import { interBranchTripsApi, type InterBranchTrip, type TripQRResponse } from "../api/interBranchTrips";
import { publicTrackingApi } from "../api/publicTracking";
import type { Branch } from "../api/branches";
import { Card } from "../components/ui/card";

// ---------------------------------------------------------------------------
// Haversine
// ---------------------------------------------------------------------------
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function cityAbbrev(city: string): string {
  const map: Record<string, string> = {
    "Ciudad de Buenos Aires": "CABA",
    "Buenos Aires": "CABA",
    Córdoba: "CBA",
    Mendoza: "MZA",
    Rosario: "ROS",
    Salta: "SAL",
    Posadas: "POS",
    Jujuy: "JUJ",
    Bariloche: "BRC",
    Tucumán: "TUC",
  };
  const key = Object.keys(map).find((k) => city.toLowerCase().includes(k.toLowerCase()));
  return key ? map[key] : city.slice(0, 3).toUpperCase();
}

function mapsUrl(lat: number, lng: number, label: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(label)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function DriverInterBranchTrip() {
  const navigate = useNavigate();
  const [trip, setTrip] = useState<InterBranchTrip | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [noTrip, setNoTrip] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [unavailablePickups, setUnavailablePickups] = useState<Set<string>>(new Set());

  // QR modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState<TripQRResponse | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const [confirmedBranchName, setConfirmedBranchName] = useState("");

  // Collapsible
  const [shipmentsExpanded, setShipmentsExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Mapa
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      // Branches usa el endpoint público — los choferes no tienen permiso en /branches.
      const [t, br] = await Promise.all([
        interBranchTripsApi.getMyTrip(),
        publicTrackingApi.getBranches(),
      ]);
      setTrip(t);
      setBranches(br);
      setNoTrip(false);

      // Verificar estado actual de pickups de paradas completadas.
      // Solo se muestran los que están loaded o in_transit (están físicamente en el camión).
      // Los que quedaron en at_hub (no subieron) o en estado terminal se ocultan.
      const ON_VEHICLE_STATUSES = new Set(["loaded", "in_transit"]);
      const curIdx = t.current_stop_index ?? 0;
      const completedPickupIds = (t.stops ?? [])
        .slice(0, curIdx)
        .flatMap((s) => s.pickup_shipment_ids ?? []);
      if (completedPickupIds.length > 0) {
        const statuses = await Promise.allSettled(
          completedPickupIds.map((tid) => publicTrackingApi.getShipment(tid))
        );
        const notOnVehicle = new Set<string>();
        statuses.forEach((result, i) => {
          if (result.status === "fulfilled" && !ON_VEHICLE_STATUSES.has(result.value.status)) {
            notOnVehicle.add(completedPickupIds[i]);
          }
        });
        setUnavailablePickups(notOnVehicle);
      }
    } catch {
      setNoTrip(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Polling cuando el modal QR está abierto
  useEffect(() => {
    if (!qrOpen || !trip) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }
    const prevStopIdx = trip.current_stop_index ?? 0;
    const prevStatus = trip.status;

    pollingRef.current = setInterval(async () => {
      try {
        const updated = await interBranchTripsApi.getMyTrip();
        const newIdx = updated.current_stop_index ?? 0;
        const advanced = newIdx > prevStopIdx || updated.status !== prevStatus;
        if (advanced) {
          // Mostrar overlay de éxito antes de cerrar modal
          const currentStop = trip.stops?.[prevStopIdx];
          const b = branches.find((br) => br.id === currentStop?.branch_id);
          setConfirmedBranchName(b?.address.city ?? currentStop?.branch_id ?? "");
          setStopConfirmed(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
          setTimeout(() => {
            setStopConfirmed(false);
            setQrOpen(false);
            setTrip(updated);
          }, 1800);
        }
      } catch { /* ignorar errores de red durante polling */ }
    }, 4000);

    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [qrOpen, trip, branches]);

  // Mapa Leaflet
  useEffect(() => {
    if (!trip || !mapRef.current || !branches.length) return;
    const origin = branches.find((b) => b.id === trip.origin_branch_id);
    if (!origin?.latitude) return;

    const stops =
      trip.stops && trip.stops.length > 0
        ? trip.stops
        : trip.destination_branch_id
          ? [{ branch_id: trip.destination_branch_id, shipment_ids: trip.shipment_ids, total_weight_kg: trip.total_weight_kg }]
          : [];

    const points: { lat: number; lng: number; branch?: Branch; label: string; completed: boolean; current: boolean }[] = [
      { lat: origin.latitude!, lng: origin.longitude!, branch: origin, label: "Origen", completed: false, current: false },
    ];
    const curIdx = trip.current_stop_index ?? 0;
    stops.forEach((s, idx) => {
      const b = branches.find((br) => br.id === s.branch_id);
      if (b?.latitude)
        points.push({
          lat: b.latitude,
          lng: b.longitude!,
          branch: b,
          label: idx === stops.length - 1 ? "Destino final" : `Parada ${idx + 1}`,
          completed: idx < curIdx,
          current: idx === curIdx && trip.status === "en_transito",
        });
    });
    if (points.length < 2) return;

    import("leaflet").then((L) => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove(): void }).remove();
        mapInstanceRef.current = null;
      }
      const map = L.map(mapRef.current!, { zoomControl: false, scrollWheelZoom: false });
      mapInstanceRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(map);

      const icon = (bg: string, content: string) =>
        L.divIcon({
          className: "",
          html: `<div style="background:${bg};color:#fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.3)">${content}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

      points.forEach((p, i) => {
        let bg = "#1e3a5f", content = "🏭";
        if (i > 0) {
          if (p.completed) { bg = "#059669"; content = "✓"; }
          else if (p.current) { bg = "#0284c7"; content = "📍"; }
          else { bg = "#64748b"; content = String(i); }
        }
        L.marker([p.lat, p.lng], { icon: icon(bg, content) })
          .addTo(map)
          .bindPopup(`<b>${p.label}</b><br>${p.branch?.name ?? ""}<br>${p.branch?.address.city ?? ""}`);
      });

      for (let i = 0; i < points.length - 1; i++) {
        L.polyline([[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]], {
          color: points[i + 1].completed ? "#059669" : "#1e3a5f",
          weight: 3,
          dashArray: points[i + 1].completed ? undefined : "8 6",
        }).addTo(map);
      }
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40] });
    }).catch(() => {});

    return () => {
      if (mapInstanceRef.current) { (mapInstanceRef.current as { remove(): void }).remove(); mapInstanceRef.current = null; }
    };
  }, [trip, branches]);

  const openQR = async () => {
    if (!trip) return;
    setQrOpen(true);
    if (!qrData) {
      setQrLoading(true);
      try {
        const data = await interBranchTripsApi.getQR(trip.id);
        setQrData(data);
      } catch { /* mostrar fallback */ }
      finally { setQrLoading(false); }
    }
  };

  const handleStart = async () => {
    if (!trip) return;
    setStarting(true);
    setError("");
    try {
      const updated = await interBranchTripsApi.startTrip(trip.id);
      setTrip(updated);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo iniciar el viaje.");
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <TripSkeleton />;
  if (noTrip) return <NoTripView />;
  if (!trip) return null;

  const stops =
    trip.stops && trip.stops.length > 0
      ? trip.stops
      : trip.destination_branch_id
        ? [{ branch_id: trip.destination_branch_id, shipment_ids: trip.shipment_ids, total_weight_kg: trip.total_weight_kg, pickup_shipment_ids: [], pickup_weight_kg: 0 }]
        : [];

  const curIdx = trip.current_stop_index ?? 0;
  const origin = branches.find((b) => b.id === trip.origin_branch_id);
  const currentStop = stops[curIdx];
  const currentStopBranch = branches.find((b) => b.id === currentStop?.branch_id);

  // Distancia restante = desde la última posición conocida (origen si no completó
  // paradas, o la última parada completada) hasta la próxima parada.
  const previousLocationBranch =
    curIdx === 0
      ? origin
      : branches.find((b) => b.id === stops[curIdx - 1]?.branch_id);
  let distRemainingKm: number | null = null;
  if (previousLocationBranch?.latitude && currentStopBranch?.latitude) {
    distRemainingKm = Math.round(
      haversineKm(
        { lat: previousLocationBranch.latitude!, lng: previousLocationBranch.longitude! },
        { lat: currentStopBranch.latitude!, lng: currentStopBranch.longitude! },
      ),
    );
  }
  const etaHours = distRemainingKm !== null ? distRemainingKm / 80 : null;

  const completedStops = stops.slice(0, curIdx);
  const upcomingStops = stops.slice(curIdx + 1);

  // Pickups cargados en paradas anteriores que viajan en el camión y se
  // descargan en esta parada (o en la siguiente, si hay más hops).
  // Se excluyen los que ya tienen estado terminal (cancelado, destruido, etc.).
  const pickupsInTransit = completedStops
    .flatMap((s) => s.pickup_shipment_ids ?? [])
    .filter((tid) => !unavailablePickups.has(tid));
  const pickupsInTransitWeightKg = completedStops.reduce((sum, s) => sum + (s.pickup_weight_kg ?? 0), 0);

  const totalShipments = trip.shipment_ids.length;

  const statusMap: Record<string, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800" },
    en_transito: { label: "En ruta", cls: "bg-blue-100 text-blue-800" },
    completado: { label: "Completado", cls: "bg-emerald-100 text-emerald-800" },
    cancelado: { label: "Cancelado", cls: "bg-slate-100 text-slate-600" },
  };
  const st = statusMap[trip.status] ?? statusMap.pendiente;

  // ---------- Estado completado ----------
  if (trip.status === "completado") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" />
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Viaje completado</h1>
        <p className="text-slate-500 text-sm mb-6">
          {stops.length} parada{stops.length !== 1 ? "s" : ""} · {totalShipments} envíos · {trip.license_plate}
        </p>
        {trip.completed_at && (
          <p className="text-xs text-slate-400 mb-8">
            {new Date(trip.completed_at).toLocaleString("es-AR")}
          </p>
        )}
        <button
          onClick={() => navigate("/driver/scan")}
          className="h-12 px-8 rounded-xl bg-[#1e3a5f] hover:bg-[#15294a] text-white font-bold text-sm transition-colors cursor-pointer"
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  return (
    <div className="pb-28">
      {/* ── HEADER STICKY ── */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="px-4 sm:px-6 max-w-2xl mx-auto pt-3 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f] flex items-center justify-center shrink-0">
                <Truck className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-slate-900 leading-tight">
                  Viaje · <span className="font-mono">{trip.license_plate}</span>
                </h1>
                <p className="text-[11px] text-slate-500 leading-tight">
                  {totalShipments} envío{totalShipments !== 1 ? "s" : ""} · {trip.total_weight_kg.toFixed(0)} kg · <span className="font-mono">{trip.id}</span>
                </p>
              </div>
            </div>
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0 ${st.cls}`}>
              {st.label}
            </span>
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6 max-w-2xl mx-auto pt-4 space-y-4">
        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="text-xs font-semibold cursor-pointer">Cerrar</button>
          </div>
        )}

        {/* ── STEPPER HORIZONTAL ── */}
        <StepperBar
          origin={origin}
          stops={stops}
          currentStopIdx={curIdx}
          branches={branches}
          tripStatus={trip.status}
        />

        {/* ── HERO: PRÓXIMA PARADA ── */}
        {trip.status === "en_transito" && currentStop && (
          <HeroNextStop
            stop={currentStop}
            stopNumber={curIdx + 1}
            totalStops={stops.length}
            branch={currentStopBranch}
            distKm={distRemainingKm}
            etaHours={etaHours}
            pickupsInTransit={pickupsInTransit}
            pickupsInTransitWeightKg={pickupsInTransitWeightKg}
            shipmentsExpanded={shipmentsExpanded}
            onToggleShipments={() => setShipmentsExpanded((v) => !v)}
          />
        )}

        {/* ── MAPA ── */}
        {(origin?.latitude || currentStopBranch?.latitude) && (
          <Card className="overflow-hidden p-0">
            <div ref={mapRef} className="h-44 w-full" />
          </Card>
        )}

        {/* ── PARADAS COMPLETADAS ── */}
        {completedStops.length > 0 && (
          <div>
            <button
              onClick={() => setCompletedExpanded((v) => !v)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 cursor-pointer"
            >
              {completedExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Paradas completadas ({completedStops.length})
            </button>
            {completedExpanded && (
              <div className="space-y-2">
                {completedStops.map((s, idx) => {
                  const b = branches.find((br) => br.id === s.branch_id);
                  return (
                    <Card key={idx} className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-900">{b?.name ?? s.branch_id}</p>
                          <p className="text-xs text-slate-500">{b?.address.city}</p>
                        </div>
                        {s.completed_at && (
                          <p className="text-[11px] text-slate-400 shrink-0">
                            {new Date(s.completed_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PRÓXIMAS PARADAS ── */}
        {upcomingStops.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Siguientes paradas</p>
            <div className="space-y-2">
              {upcomingStops.map((s, idx) => {
                const b = branches.find((br) => br.id === s.branch_id);
                const realIdx = curIdx + 1 + idx;
                // realIdx >= 1 siempre (curIdx >= 0, idx >= 0), así que el "anterior"
                // es stops[realIdx - 1] — nunca el origen.
                const prevBranch = branches.find((br) => br.id === stops[realIdx - 1]?.branch_id);
                let legKm: number | null = null;
                if (prevBranch?.latitude && b?.latitude) {
                  legKm = Math.round(haversineKm(
                    { lat: prevBranch.latitude!, lng: prevBranch.longitude! },
                    { lat: b.latitude!, lng: b.longitude! },
                  ));
                }
                return (
                  <Card key={idx} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-xs font-bold text-slate-500">
                        {realIdx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900">{b?.name ?? s.branch_id}</p>
                        <p className="text-xs text-slate-500">{b?.address.city}{b?.address.province ? `, ${b.address.province}` : ""}</p>
                      </div>
                      <div className="text-right shrink-0 text-xs text-slate-500 space-y-0.5">
                        {legKm !== null && <p>+{legKm} km</p>}
                        <p>{s.shipment_ids.length} env.</p>
                      </div>
                    </div>
                    {(s.pickup_shipment_ids?.length ?? 0) > 0 && (
                      <p className="text-[11px] text-amber-700 font-medium mt-1 ml-9">
                        ↑ Cargás {s.pickup_shipment_ids?.length} envío{s.pickup_shipment_ids!.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Timestamps */}
        {trip.started_at && (
          <p className="text-xs text-slate-400 text-center">
            Iniciado: {new Date(trip.started_at).toLocaleString("es-AR")}
          </p>
        )}
      </div>

      {/* ── CTA STICKY BOTTOM ── */}
      {trip.status === "en_transito" && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={openQR}
              className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[#1e3a5f] hover:bg-[#162d4a] active:bg-[#0f2135] text-white text-base font-bold cursor-pointer transition-colors shadow-sm"
            >
              <QrCode className="w-5 h-5" />
              Llegué — mostrar QR al operador
            </button>
          </div>
        </div>
      )}

      {/* Fallback para estado pendiente (no debería ocurrir con auto-start, pero defensivo) */}
      {trip.status === "pendiente" && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto space-y-2">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Al iniciar el viaje, los envíos pasan a estado <strong>en tránsito</strong>.</span>
            </div>
            <button
              onClick={handleStart}
              disabled={starting}
              className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[#1e3a5f] hover:bg-[#162d4a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-base font-bold cursor-pointer disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Play className="w-5 h-5" />
              {starting ? "Iniciando viaje…" : "Iniciar viaje"}
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL QR FULLSCREEN ── */}
      {qrOpen && (
        <QRModal
          trip={trip}
          currentStop={currentStop}
          currentStopBranch={currentStopBranch}
          pickupsInTransit={pickupsInTransit}
          qrData={qrData}
          qrLoading={qrLoading}
          stopConfirmed={stopConfirmed}
          confirmedBranchName={confirmedBranchName}
          onClose={() => { setQrOpen(false); if (pollingRef.current) clearInterval(pollingRef.current); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepperBar
// ---------------------------------------------------------------------------
type TripStopShape = {
  branch_id: string;
  shipment_ids: string[];
  total_weight_kg: number;
  pickup_shipment_ids?: string[];
  pickup_weight_kg?: number;
  completed_at?: string;
  completed_by_user_id?: string;
};

function StepperBar({
  origin,
  stops,
  currentStopIdx,
  branches,
  tripStatus,
}: {
  origin?: Branch;
  stops: TripStopShape[];
  currentStopIdx: number;
  branches: Branch[];
  tripStatus: string;
}) {
  const allPoints = [
    { id: origin?.id ?? "origin", city: origin?.address.city ?? "Origen", isOrigin: true },
    ...stops.map((s) => {
      const b = branches.find((br) => br.id === s.branch_id);
      return { id: s.branch_id, city: b?.address.city ?? s.branch_id, isOrigin: false };
    }),
  ];

  return (
    <Card className="p-4">
      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {allPoints.map((pt, idx) => {
          const isOriginPt = pt.isOrigin;
          const stopIdx = idx - 1;
          const isCompleted = !isOriginPt && stopIdx < currentStopIdx;
          const isCurrent =
            !isOriginPt && stopIdx === currentStopIdx && tripStatus === "en_transito";
          const isPending = !isOriginPt && stopIdx > currentStopIdx;
          const isLast = idx === allPoints.length - 1;

          let dotBg = "#64748b";
          let dotContent = <span className="text-[9px] font-bold text-white">{idx}</span>;
          if (isOriginPt) {
            dotBg = "#1e3a5f";
            dotContent = <Truck className="w-3 h-3 text-white" />;
          } else if (isCompleted) {
            dotBg = "#059669";
            dotContent = <span className="text-[9px] font-bold text-white">✓</span>;
          } else if (isCurrent) {
            dotBg = "#0284c7";
            dotContent = <MapPin className="w-3 h-3 text-white" />;
          }

          return (
            <div key={pt.id + idx} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center min-w-[48px]">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isCurrent ? "ring-4 ring-sky-200" : ""}`}
                  style={{ background: dotBg }}
                >
                  {dotContent}
                </div>
                <p className={`text-[10px] font-semibold mt-1 text-center ${isPending ? "text-slate-400" : isCompleted ? "text-emerald-600" : isCurrent ? "text-sky-700" : "text-slate-700"}`}>
                  {cityAbbrev(pt.city)}
                </p>
              </div>
              {!isLast && (
                <div
                  className="flex-1 h-0.5 mt-[13px] mx-1"
                  style={{ background: isCompleted || (isCurrent && stopIdx < currentStopIdx) ? "#059669" : "#e2e8f0" }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// HeroNextStop
// ---------------------------------------------------------------------------
function HeroNextStop({
  stop,
  stopNumber,
  totalStops,
  branch,
  distKm,
  etaHours,
  pickupsInTransit,
  pickupsInTransitWeightKg,
  shipmentsExpanded,
  onToggleShipments,
}: {
  stop: TripStopShape;
  stopNumber: number;
  totalStops: number;
  branch?: Branch;
  distKm: number | null;
  etaHours: number | null;
  pickupsInTransit: string[];
  pickupsInTransitWeightKg: number;
  shipmentsExpanded: boolean;
  onToggleShipments: () => void;
}) {
  const hasPickup = (stop.pickup_shipment_ids?.length ?? 0) > 0;
  const allDropoffs = [...stop.shipment_ids, ...pickupsInTransit];
  const mapsLink =
    branch?.latitude && branch?.longitude
      ? mapsUrl(branch.latitude, branch.longitude, branch.name)
      : null;

  return (
    <Card className="p-4 border-2 border-[#1e3a5f]/20 bg-gradient-to-br from-white to-slate-50/80">
      {/* Chip de parada */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#1e3a5f]/10 text-[#1e3a5f] uppercase tracking-wider">
          Parada {stopNumber} de {totalStops}
        </span>
        {distKm !== null && (
          <span className="text-[11px] text-slate-500 font-medium">{distKm} km aprox.</span>
        )}
      </div>

      {/* Sucursal */}
      <div className="mb-3">
        <p className="text-xl font-bold text-slate-900 leading-tight">{branch?.name ?? stop.branch_id}</p>
        {branch?.address && (
          <div className="flex items-center gap-1 mt-0.5 text-slate-500">
            <MapPin className="w-3 h-3 shrink-0" />
            <p className="text-xs">
              {branch.address.street && `${branch.address.street}, `}
              {branch.address.city}{branch.address.province ? `, ${branch.address.province}` : ""}
            </p>
          </div>
        )}
      </div>

      {/* ETA */}
      {etaHours !== null && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-slate-100 flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700">ETA estimada</span>
          <span className="ml-auto text-sm font-bold text-[#1e3a5f]">~{formatDuration(etaHours)}</span>
        </div>
      )}

      {/* Carga que baja / sube */}
      <div className="space-y-1 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Package className="w-4 h-4 text-slate-400" />
          <span className="text-slate-700">
            ↓ Bajan: <strong>{allDropoffs.length} envío{allDropoffs.length !== 1 ? "s" : ""}</strong>
          </span>
          <Weight className="w-3.5 h-3.5 text-slate-400 ml-auto" />
          <span className="text-slate-500 text-xs">{(stop.total_weight_kg + pickupsInTransitWeightKg).toFixed(1)} kg</span>
        </div>
        {pickupsInTransit.length > 0 && (
          <p className="text-[11px] text-sky-700 ml-6">
            Incluye {pickupsInTransit.length} envío{pickupsInTransit.length !== 1 ? "s" : ""} cargados en parada anterior
          </p>
        )}
        {hasPickup && (
          <div className="flex items-center gap-2 text-sm text-amber-700 font-medium">
            <Package className="w-4 h-4 text-amber-400" />
            ↑ Cargás: <strong>{stop.pickup_shipment_ids!.length} envío{stop.pickup_shipment_ids!.length !== 1 ? "s" : ""}</strong>
            <span className="ml-auto text-xs font-normal">{(stop.pickup_weight_kg ?? 0).toFixed(1)} kg</span>
          </div>
        )}
      </div>

      {/* Botones */}
      <div className="flex flex-col gap-2">
        {mapsLink && (
          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Abrir en Maps
          </a>
        )}
        <button
          onClick={onToggleShipments}
          className="flex items-center justify-center gap-2 h-10 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors cursor-pointer"
        >
          <Package className="w-4 h-4" />
          Ver lista de envíos
          {shipmentsExpanded ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
        </button>
        {shipmentsExpanded && allDropoffs.length > 0 && (
          <div className="mt-1 rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {stop.shipment_ids.map((tid) => (
              <div key={tid} className="px-3 py-2 flex items-center gap-2">
                <span className="text-xs font-mono text-slate-700">{tid}</span>
              </div>
            ))}
            {pickupsInTransit.length > 0 && (
              <>
                <div className="px-3 py-1.5 bg-sky-50">
                  <p className="text-[10px] font-bold text-sky-700 uppercase tracking-wider">↓ Cargados en parada anterior</p>
                </div>
                {pickupsInTransit.map((tid) => (
                  <div key={tid} className="px-3 py-2 flex items-center gap-2 bg-sky-50/40">
                    <span className="text-xs font-mono text-sky-800">{tid}</span>
                  </div>
                ))}
              </>
            )}
            {hasPickup && (
              <>
                <div className="px-3 py-1.5 bg-amber-50">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">↑ Para cargar</p>
                </div>
                {stop.pickup_shipment_ids!.map((tid) => (
                  <div key={tid} className="px-3 py-2 flex items-center gap-2 bg-amber-50/50">
                    <span className="text-xs font-mono text-amber-800">{tid}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// QRModal
// ---------------------------------------------------------------------------
function QRModal({
  trip,
  currentStop,
  currentStopBranch,
  pickupsInTransit,
  qrData,
  qrLoading,
  stopConfirmed,
  confirmedBranchName,
  onClose,
}: {
  trip: InterBranchTrip;
  currentStop?: TripStopShape;
  currentStopBranch?: Branch;
  pickupsInTransit: string[];
  qrData: TripQRResponse | null;
  qrLoading: boolean;
  stopConfirmed: boolean;
  confirmedBranchName: string;
  onClose: () => void;
}) {
  return (
    /* Backdrop — z-[9999] para quedar por encima de Leaflet (z ~400) y del nav */
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(15,27,52,0.72)" }}
      onClick={onClose}
    >
      {/* Card — click dentro no cierra */}
      <div
        className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle / Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <div>
            <p className="text-sm font-bold text-slate-900">
              Entregando en {currentStopBranch?.name ?? currentStop?.branch_id}
            </p>
            <p className="text-xs text-slate-500">{currentStopBranch?.address.city}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        {/* Cuerpo con scroll */}
        <div className="flex flex-col items-center px-6 py-5 gap-4 overflow-y-auto">
          {stopConfirmed ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2 className="w-16 h-16 text-emerald-500" />
              <p className="text-base font-bold text-slate-900">Recepción confirmada</p>
              <p className="text-sm text-slate-500">en {confirmedBranchName}</p>
            </div>
          ) : (
            <>
              {/* QR */}
              <div className="flex flex-col items-center gap-2 w-full">
                {qrLoading ? (
                  <div className="w-56 h-56 rounded-2xl bg-slate-100 animate-pulse" />
                ) : qrData ? (
                  <div className="p-3 bg-white rounded-2xl border-2 border-[#1e3a5f]/20 shadow-md">
                    <img
                      src={`data:image/png;base64,${qrData.qr_code_base64}`}
                      alt="QR del viaje"
                      className="w-56 h-56"
                    />
                  </div>
                ) : (
                  <div className="w-56 h-56 rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center">
                    <p className="text-sm text-slate-400 text-center px-4">No se pudo cargar el QR.</p>
                  </div>
                )}
                <p className="text-[11px] font-mono text-slate-400">{trip.id}</p>
              </div>

              {/* Indicador de espera */}
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
                Esperando que el operador escanee…
              </div>

              {/* Envíos que bajan — propios + pickups de paradas anteriores */}
              {currentStop && (currentStop.shipment_ids.length > 0 || pickupsInTransit.length > 0) && (() => {
                const allBajan = [...currentStop.shipment_ids, ...pickupsInTransit];
                return (
                  <div className="w-full">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      ↓ Bajan {allBajan.length} envío{allBajan.length !== 1 ? "s" : ""}
                    </p>
                    <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden max-h-36 overflow-y-auto">
                      {currentStop.shipment_ids.map((tid) => (
                        <div key={tid} className="px-3 py-1.5">
                          <span className="text-xs font-mono text-slate-700">{tid}</span>
                        </div>
                      ))}
                      {pickupsInTransit.length > 0 && (
                        <>
                          <div className="px-3 py-1 bg-sky-50">
                            <p className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Cargados en parada anterior</p>
                          </div>
                          {pickupsInTransit.map((tid) => (
                            <div key={tid} className="px-3 py-1.5 bg-sky-50/30">
                              <span className="text-xs font-mono text-sky-800">{tid}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / Loading views
// ---------------------------------------------------------------------------
function NoTripView() {
  const navigate = useNavigate();
  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="flex items-start gap-3 mb-6 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-[#1e3a5f]/8 text-[#1e3a5f] flex items-center justify-center shrink-0">
          <Truck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">Mi viaje</h1>
          <p className="mt-1 text-sm text-slate-500">No tenés ningún viaje asignado por el momento.</p>
        </div>
      </div>
      <Card className="p-8 text-center">
        <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500 mb-6">
          Si el operador ya asignó tu vehículo, escaneá el QR o ingresá la patente para tomar el viaje.
        </p>
        <button
          onClick={() => navigate("/driver/scan")}
          className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl bg-[#1e3a5f] hover:bg-[#15294a] text-white font-bold text-sm transition-colors cursor-pointer"
        >
          <QrCode className="w-4 h-4" />
          Escanear vehículo
        </button>
      </Card>
    </div>
  );
}

function TripSkeleton() {
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-start gap-3 pb-4 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-slate-100 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-40 rounded bg-slate-100 animate-pulse" />
          <div className="h-3 w-24 rounded bg-slate-100 animate-pulse" />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="h-4 w-24 rounded bg-slate-100 animate-pulse mb-3" />
          <div className="h-3 w-full rounded bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
