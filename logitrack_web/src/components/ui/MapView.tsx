import { useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  MapPin,
  Navigation,
  Clock,
  CheckCircle2,
  Package,
  AlertTriangle,
  Pause,
  Play,
  RotateCcw,
  Crosshair,
  Film,
  Zap,
  X,
} from "lucide-react";
import type { GeoMode } from "../../hooks/useGeolocation";
import type { Zone } from "../../api/zones";
import { ZONE_COLOR } from "../../api/zones";

delete (L.Icon.Default.prototype as typeof L.Icon.Default.prototype & { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

export interface Waypoint {
  sequence: number;
  tracking_id: string;
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  status: string;
}

interface Origin {
  latitude: number;
  longitude: number;
  name: string;
}

interface MapViewProps {
  waypoints: Waypoint[];
  origin?: Origin;
  userLocation?: { lat: number; lng: number };
  simulationMode?: GeoMode;
  simulationControls?: {
    isPaused: boolean;
    pause: () => void;
    play: () => void;
    reset: () => void;
    onExit?: () => void;
    speedMultiplier?: number;
    onCycleSpeed?: () => void;
    onFastForwardTime?: () => void;
  };
  zones?: Zone[];
  onRouteInfoChange?: (info: { distance: number; duration: number } | null) => void;
  onWaypointClick: (trackingId: string) => void;
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
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

// Raw SVG icons for Leaflet HTML strings (can't use React components there)
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M20 6 9 17l-5-5"/></svg>`;
const X_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const FACTORY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>`;
const ALERT_TRIANGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const MAP_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

export function MapView({
  waypoints,
  origin,
  userLocation,
  simulationMode,
  simulationControls,
  zones = [],
  onRouteInfoChange,
  onWaypointClick,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const userMarkerLayer = useRef<L.LayerGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const doneRouteLayer = useRef<L.Polyline | null>(null);
  const pendingRouteLayer = useRef<L.Polyline | null>(null);
  const fullRouteGeomRef = useRef<[number, number][]>([]);

  const lastFetchRef = useRef<{
    waypointsKey: string;
    position: { lat: number; lng: number } | null;
    time: number;
  }>({ waypointsKey: "", position: null, time: 0 });
  const userLocationRef = useRef(userLocation);
  const simulationModeRef = useRef(simulationMode);
  const fetchRouteRef = useRef<(silent?: boolean) => Promise<void>>(async () => {});
  useEffect(() => { userLocationRef.current = userLocation; }, [userLocation]);
  useEffect(() => { simulationModeRef.current = simulationMode; }, [simulationMode]);

  const [loading, setLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const followModeRef = useRef(false);
  const programmaticPanRef = useRef(false);

  useEffect(() => { followModeRef.current = followMode; }, [followMode]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [-34.6037, -58.3816],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    map.on("dragstart", () => {
      if (!programmaticPanRef.current) {
        setFollowMode(false);
      }
    });

    mapInstance.current = map;
    zonesLayerRef.current = L.layerGroup().addTo(map);
    markersLayer.current = L.layerGroup().addTo(map);
    userMarkerLayer.current = L.layerGroup().addTo(map);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Render danger zones as colored polygons
  useEffect(() => {
    const layer = zonesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    zones.filter((z) => z.active).forEach((z) => {
      const latLngs = z.polygon.map((p) => [p.lat, p.lng] as [number, number]);
      const poly = L.polygon(latLngs, {
        color: ZONE_COLOR.stroke,
        fillColor: ZONE_COLOR.stroke,
        fillOpacity: 0.18,
        weight: 1.5,
        opacity: 0.7,
      });
      poly.bindPopup(`
        <div style="font-family:system-ui;min-width:140px">
          <p style="font-weight:700;font-size:13px;margin:0 0 3px">${ALERT_TRIANGLE_SVG} ${z.name}</p>
          ${z.description ? `<p style="font-size:11px;color:#64748b;margin:0">${z.description}</p>` : ""}
        </div>
      `);
      poly.addTo(layer!);
    });
  }, [zones]);

  // Update delivery markers when waypoints change
  useEffect(() => {
    if (!mapInstance.current || !markersLayer.current || waypoints.length === 0) return;

    markersLayer.current.clearLayers();
    if (doneRouteLayer.current) { doneRouteLayer.current.remove(); doneRouteLayer.current = null; }
    if (pendingRouteLayer.current) { pendingRouteLayer.current.remove(); pendingRouteLayer.current = null; }

    // Origin branch marker
    if (origin) {
      const depotIcon = L.divIcon({
        html: `<div class="w-10 h-10 rounded-full bg-[#1e3a5f] border-[3px] border-white shadow-[0_2px_10px_rgba(0,0,0,0.3)] flex items-center justify-center cursor-pointer"><div class="text-lg leading-none">${FACTORY_SVG}</div></div>`,
        className: "",
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      });
      const dm = L.marker([origin.latitude, origin.longitude], { icon: depotIcon });
      dm.bindPopup(`
        <div class="font-[system-ui,-apple-system,sans-serif] min-w-[200px]">
          <div class="flex items-center justify-between mb-2 gap-2">
            <strong class="text-[var(--text-heading)] text-[13px]">Sucursal</strong>
          </div>
          <h4 class="text-[15px] font-bold text-[var(--text-primary)] m-0 mb-1.5">${origin.name}</h4>
          <p class="text-xs text-[#6b7280] m-0">Punto de partida</p>
        </div>
      `);
      dm.addTo(markersLayer.current!);
    }

    // Stops
    waypoints.forEach((wp) => createMarker(wp).addTo(markersLayer.current!));

    // Fit view
    const allPoints: [number, number][] = waypoints.map((wp) => [wp.latitude, wp.longitude]);
    if (origin) allPoints.push([origin.latitude, origin.longitude]);
    const curLoc = userLocationRef.current;
    if (curLoc) allPoints.push([curLoc.lat, curLoc.lng]);
    mapInstance.current.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });

    const waypointsKey = waypoints.map((w) => `${w.tracking_id}:${w.status}`).join(",");
    lastFetchRef.current = { waypointsKey, position: userLocationRef.current ?? null, time: Date.now() };
    fetchRouteRef.current();
  }, [waypoints, origin]);

  // Update GPS marker
  useEffect(() => {
    if (!mapInstance.current || !userMarkerLayer.current) return;

    userMarkerLayer.current.clearLayers();

    if (!userLocation) return;

    const icon = L.divIcon({
      html: `<div class="relative w-8 h-8"><div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[var(--brand)] border-[3px] border-white shadow-[0_2px_8px_rgba(37,99,235,0.5)] z-[2]"></div><div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[rgba(37,99,235,0.2)] animate-[pulse-ring_2s_ease-out_infinite]"></div></div>`,
      className: "",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    L.marker([userLocation.lat, userLocation.lng], { icon }).addTo(userMarkerLayer.current!);

    if (followModeRef.current) {
      programmaticPanRef.current = true;
      mapInstance.current.panTo([userLocation.lat, userLocation.lng], { animate: true, duration: 0.5 });
      setTimeout(() => { programmaticPanRef.current = false; }, 600);
    }

    if (simulationModeRef.current === "simulate") {
      splitRouteAtGps(userLocation);
      return;
    }

    const now = Date.now();
    const last = lastFetchRef.current;
    const distMoved = last.position ? haversineKm(userLocation, last.position) > 0.1 : true;
    const timePassed = now - last.time > 30000;

    if (distMoved || timePassed) {
      lastFetchRef.current = { ...last, position: userLocation, time: now };
      fetchRouteRef.current();
    }
  }, [userLocation]);

  useEffect(() => {
    if (!mapInstance.current) return;

    if (doneRouteLayer.current) { doneRouteLayer.current.remove(); doneRouteLayer.current = null; }
    if (pendingRouteLayer.current) { pendingRouteLayer.current.remove(); pendingRouteLayer.current = null; }

    fetchRouteRef.current();
  }, [simulationMode]);

  const createMarker = (wp: Waypoint) => {
    const isCompleted = wp.status === "delivered" || wp.status === "delivery_failed";
    const isFailed = wp.status === "delivery_failed";
    const isDelivered = wp.status === "delivered";

    const markerColor = isDelivered
      ? "bg-[var(--ok)]"
      : isFailed
      ? "bg-[var(--danger-c)]"
      : "bg-[var(--warn)]";

    const opacityClass = isCompleted ? "opacity-80" : "";

    const icon = L.divIcon({
      html: `<div class="w-9 h-9 rounded-[50%_50%_50%_0] ${markerColor} border-[3px] border-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] -rotate-45 flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)]"><div class="rotate-45 text-white font-bold text-sm">${wp.sequence}</div></div>`,
      className: opacityClass,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });

    const marker = L.marker([wp.latitude, wp.longitude], { icon });

    const badge = isDelivered
      ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--ok-bg)] text-[var(--ok-text)]">${CHECK_SVG} Entregado</span>`
      : isFailed
      ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--danger-bg)] text-[var(--danger-text)]">${X_SVG} No entregado</span>`
      : `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--warn-bg)] text-[var(--warn-text)]">Pendiente</span>`;

    marker.bindPopup(`
      <div class="font-[system-ui,-apple-system,sans-serif] min-w-[200px]">
        <div class="flex items-center justify-between mb-2 gap-2">
          <strong class="text-[var(--text-heading)] text-[13px]">#${wp.sequence}</strong>
          ${badge}
        </div>
        <h4 class="text-[15px] font-bold text-[var(--text-primary)] m-0 mb-1.5">${wp.name}</h4>
        <p class="text-xs text-[var(--text-secondary)] m-0 mb-3 flex items-start gap-1.5 leading-[1.4]">
          ${MAP_PIN_SVG}
          ${wp.address}
        </p>
        <button class="w-full px-3 py-2 bg-[#1e3a5f] text-white border-none rounded-lg text-xs font-semibold cursor-pointer transition-colors duration-200 hover:bg-[#2d5a8f]" onclick="window.dispatchEvent(new CustomEvent('waypoint-click',{detail:'${wp.tracking_id}'}))">
          Ver detalle →
        </button>
      </div>
    `);

    return marker;
  };

  const fetchOsrm = async (
    points: string[]
  ): Promise<{ coords: [number, number][]; distance: number; duration: number } | null> => {
    if (points.length < 2) return null;
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${points.join(";")}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes?.[0]) return null;
      const route = data.routes[0];
      return {
        coords: route.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]),
        distance: route.distance,
        duration: route.duration,
      };
    } catch {
      return null;
    }
  };

  const splitRouteAtGps = (gps: { lat: number; lng: number }) => {
    if (!mapInstance.current) return;

    if (doneRouteLayer.current) { doneRouteLayer.current.remove(); doneRouteLayer.current = null; }
    if (pendingRouteLayer.current) { pendingRouteLayer.current.remove(); pendingRouteLayer.current = null; }

    const full = fullRouteGeomRef.current;
    if (full.length < 2) return;

    let splitIdx = 0;
    let minDist = Infinity;
    full.forEach(([lat, lng], i) => {
      const d = haversineKm(gps, { lat, lng });
      if (d < minDist) { minDist = d; splitIdx = i; }
    });

    if (splitIdx > 0) {
      doneRouteLayer.current = L.polyline(full.slice(0, splitIdx + 1), {
        color: "#94a3b8", weight: 4, opacity: 0.6, dashArray: "8, 6",
      }).addTo(mapInstance.current!);
    }
    if (splitIdx < full.length - 1) {
      pendingRouteLayer.current = L.polyline(full.slice(splitIdx), {
        color: "#f97316", weight: 4, opacity: 0.8,
      }).addTo(mapInstance.current!);
    }
  };

  const fetchRoute = async (silent = false) => {
    if (!mapInstance.current) return;
    if (!silent) setLoading(true);
    try {
      const sorted = [...waypoints].sort((a, b) => a.sequence - b.sequence);
      const isCompleted = (wp: Waypoint) =>
        wp.status === "delivered" || wp.status === "delivery_failed";

      const completed = sorted.filter(isCompleted);
      const pending = sorted.filter((wp) => !isCompleted(wp));

      const toCoord = (wp: Waypoint) => `${wp.longitude},${wp.latitude}`;
      const originCoord = origin ? `${origin.longitude},${origin.latitude}` : null;

      const fullPoints: string[] = [];
      if (originCoord && simulationModeRef.current === "simulate") fullPoints.push(originCoord);
      sorted.forEach((wp) => fullPoints.push(toCoord(wp)));

      const currentLocation = userLocationRef.current;

      const gpsCoord = currentLocation ? `${currentLocation.lng},${currentLocation.lat}` : null;
      const pendingAnchor =
        gpsCoord ??
        (completed.length > 0
          ? toCoord(completed[completed.length - 1])
          : simulationModeRef.current === "simulate" ? originCoord : null);
      const pendingPoints: string[] = [];
      if (pendingAnchor) pendingPoints.push(pendingAnchor);
      pending.forEach((wp) => pendingPoints.push(toCoord(wp)));

      if (doneRouteLayer.current) { doneRouteLayer.current.remove(); doneRouteLayer.current = null; }
      if (pendingRouteLayer.current) { pendingRouteLayer.current.remove(); pendingRouteLayer.current = null; }

      const samePoints = fullPoints.join(";") === pendingPoints.join(";");
      const fullResult = await fetchOsrm(fullPoints);
      const pendingResult = samePoints ? fullResult : await fetchOsrm(pendingPoints);

      if (fullResult) fullRouteGeomRef.current = fullResult.coords;

      if (simulationModeRef.current === "simulate") {
        if (userLocationRef.current) {
          splitRouteAtGps(userLocationRef.current);
        }
      } else {
        if (completed.length > 0) {
          const donePoints: string[] = [];
          completed.forEach((wp) => donePoints.push(toCoord(wp)));
          const doneResult = await fetchOsrm(donePoints);
          if (doneResult) {
            doneRouteLayer.current = L.polyline(doneResult.coords, {
              color: "#94a3b8", weight: 4, opacity: 0.6, dashArray: "8, 6",
            }).addTo(mapInstance.current!);
          }
        }
        if (pendingResult) {
          pendingRouteLayer.current = L.polyline(pendingResult.coords, {
            color: "#f97316", weight: 4, opacity: 0.8,
          }).addTo(mapInstance.current!);
        } else if (fullResult) {
          pendingRouteLayer.current = L.polyline(fullResult.coords, {
            color: "#f97316", weight: 4, opacity: 0.8,
          }).addTo(mapInstance.current!);
        }
      }

      const info = pendingResult
        ? { distance: pendingResult.distance, duration: pendingResult.duration }
        : null;

      setRouteInfo(info);
      onRouteInfoChange?.(info);
    } catch (error) {
      console.error("Error obteniendo ruta OSRM:", error);
    } finally {
      setLoading(false);
    }
  };
  useLayoutEffect(() => { fetchRouteRef.current = fetchRoute; });

  // Event listener for popup clicks
  useEffect(() => {
    const handle = (e: Event) => onWaypointClick((e as CustomEvent).detail);
    window.addEventListener("waypoint-click", handle);
    return () => window.removeEventListener("waypoint-click", handle);
  }, [onWaypointClick]);

  if (waypoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-200px)] bg-[var(--bg-page)] rounded-xl border-2 border-dashed border-[var(--border)]">
        <MapPin className="w-12 h-12 text-slate-300 mb-3" />
        <p className="text-sm font-semibold text-slate-900 dark:text-[var(--text-primary)]">No hay entregas para mostrar</p>
        <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)] mt-1">
          Las paradas aparecerán aquí cuando inicies la ruta.
        </p>
      </div>
    );
  }

  const pendingCount = waypoints.filter((w) => w.status === "out_for_delivery").length;
  const completedCount = waypoints.filter(
    (w) => w.status === "delivered" || w.status === "delivery_failed"
  ).length;

  const isSimulating = simulationMode && simulationMode !== "real";

  return (
    <div className="relative h-[calc(100vh-200px)] w-full rounded-xl overflow-hidden">
      <div ref={mapRef} className="h-full w-full" />

      {/* Simulation controls */}
      {isSimulating && (
        <div className="absolute top-3 left-3 right-3 z-[1100] bg-[var(--bg-card)] rounded-xl px-3 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.12)] border border-amber-200 dark:border-amber-500/20">
          {/* Header: label + speed */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Film className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold text-amber-800 dark:text-amber-300">Simulación</span>
            </div>
            <div className="flex items-center gap-1.5">
              {simulationControls?.onExit && (
                <button
                  onClick={simulationControls.onExit}
                  className="h-7 px-2 rounded-lg cursor-pointer border transition-colors flex items-center gap-1 text-[11px] font-semibold bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20"
                >
                  <X className="w-3 h-3" /> Salir
                </button>
              )}
            </div>
          </div>

          {/* Controls row */}
          {simulationControls && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={simulationControls.isPaused ? simulationControls.play : simulationControls.pause}
                className="h-7 px-2 rounded-lg text-[11px] font-semibold cursor-pointer border transition-colors flex items-center gap-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-slate-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                {simulationControls.isPaused ? (
                  <><Play className="w-3 h-3" /><span className="hidden sm:inline">Reanudar</span></>
                ) : (
                  <><Pause className="w-3 h-3" /><span className="hidden sm:inline">Pausar</span></>
                )}
              </button>
              <button
                onClick={simulationControls.reset}
                className="h-7 px-2 rounded-lg text-[11px] font-semibold cursor-pointer border transition-colors flex items-center gap-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-slate-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                <RotateCcw className="w-3 h-3" /><span className="hidden sm:inline">Reiniciar</span>
              </button>
              {simulationControls.onCycleSpeed && (
                <button
                  onClick={simulationControls.onCycleSpeed}
                  className="h-7 px-2 rounded-lg text-[11px] font-semibold cursor-pointer border transition-colors flex items-center gap-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-slate-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  <Zap className="w-3 h-3" /> x{simulationControls.speedMultiplier ?? 1}
                </button>
              )}
              {simulationControls.onFastForwardTime && (
                <button
                  onClick={simulationControls.onFastForwardTime}
                  className="h-7 px-2 rounded-lg text-[11px] font-semibold cursor-pointer border transition-colors flex items-center gap-1 bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-slate-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  <Clock className="w-3 h-3" /> +2h
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recenter / follow button */}
      {userLocation && (
        <button
          className={`absolute right-3 bottom-28 z-[1000] w-9 h-9 rounded-full border-none flex items-center justify-center cursor-pointer transition-colors duration-150 ${
            followMode
              ? "bg-[var(--brand)] text-white shadow-[0_2px_12px_rgba(37,99,235,0.4)] hover:bg-[var(--brand)]"
              : "bg-[var(--bg-card)] text-[var(--text-heading)] shadow-[0_2px_12px_rgba(0,0,0,0.15)] hover:bg-[var(--bg-inset)]"
          }`}
          onClick={() => {
            const next = !followMode;
            setFollowMode(next);
            if (next) {
              programmaticPanRef.current = true;
              mapInstance.current?.panTo([userLocation.lat, userLocation.lng], { animate: true, duration: 0.5 });
              setTimeout(() => { programmaticPanRef.current = false; }, 600);
            }
          }}
          title={followMode ? "Desactivar seguimiento" : "Seguir mi posición"}
        >
          {followMode ? <Navigation className="w-4 h-4" /> : <Crosshair className="w-4 h-4" />}
        </button>
      )}

      {/* Info panel — compacto */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-[1000]">
        <div className="flex items-center gap-2 bg-[var(--bg-card)] px-2.5 py-1.5 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
          <Package className="w-3.5 h-3.5 text-slate-500 dark:text-[var(--text-secondary)] shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.5px] leading-none">Paradas</p>
            <p className="text-sm font-bold text-[var(--text-primary)] leading-tight">{waypoints.length}</p>
          </div>
        </div>

        {routeInfo && (
          <>
            <div className="flex items-center gap-2 bg-[var(--bg-card)] px-2.5 py-1.5 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
              <Navigation className="w-3.5 h-3.5 text-slate-500 dark:text-[var(--text-secondary)] shrink-0" />
              <div className="min-w-0">
                <p className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.5px] leading-none">Distancia</p>
                <p className="text-sm font-bold text-[var(--text-primary)] leading-tight">{(routeInfo.distance / 1000).toFixed(1)} km</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-[var(--bg-card)] px-2.5 py-1.5 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
              <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-[var(--text-secondary)] shrink-0" />
              <div className="min-w-0">
                <p className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.5px] leading-none">Tiempo</p>
                <p className="text-sm font-bold text-[var(--text-primary)] leading-tight">{Math.round(routeInfo.duration / 60)} min</p>
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-2 bg-[var(--bg-card)] px-2.5 py-1.5 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.5px] leading-none">Listas</p>
            <p className="text-sm font-bold text-[var(--text-primary)] leading-tight">{completedCount}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-[var(--bg-card)] px-2.5 py-1.5 rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-[9px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.5px] leading-none">Pend.</p>
            <p className="text-sm font-bold text-[var(--text-primary)] leading-tight">{pendingCount}</p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--bg-card)] px-8 py-5 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] flex flex-col items-center z-[2000]">
          <div className="w-6 h-6 border-[3px] border-[var(--border)] border-t-[var(--warn)] rounded-full animate-spin" />
          <p className="text-xs text-slate-600 dark:text-[var(--text-secondary)] mt-2">Calculando ruta...</p>
        </div>
      )}
    </div>
  );
}
