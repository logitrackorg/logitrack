import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import "./MapView.css";
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
  // Geometría completa de la ruta (origin → todas las paradas) para split local
  const fullRouteGeomRef = useRef<[number, number][]>([]);

  // Para debounce del reroute por GPS (solo GPS real)
  const lastFetchRef = useRef<{
    waypointsKey: string;
    position: { lat: number; lng: number } | null;
    time: number;
  }>({ waypointsKey: "", position: null, time: 0 });
  // Refs para leer valores actuales dentro de fetchRoute (evita stale closures)
  const userLocationRef = useRef(userLocation);
  const simulationModeRef = useRef(simulationMode);
  useEffect(() => { userLocationRef.current = userLocation; }, [userLocation]);
  useEffect(() => { simulationModeRef.current = simulationMode; }, [simulationMode]);

  const [loading, setLoading] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);

  // Inicializar mapa
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

  // Renderizar zonas peligrosas como polígonos coloreados
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
          <p style="font-weight:700;font-size:13px;margin:0 0 3px">⚠️ ${z.name}</p>
          ${z.description ? `<p style="font-size:11px;color:#64748b;margin:0">${z.description}</p>` : ""}
        </div>
      `);
      poly.addTo(layer!);
    });
  }, [zones]);

  // Actualizar marcadores de entrega cuando cambian los waypoints
  useEffect(() => {
    if (!mapInstance.current || !markersLayer.current || waypoints.length === 0) return;

    markersLayer.current.clearLayers();
    if (doneRouteLayer.current) { doneRouteLayer.current.remove(); doneRouteLayer.current = null; }
    if (pendingRouteLayer.current) { pendingRouteLayer.current.remove(); pendingRouteLayer.current = null; }

    // Sucursal
    if (origin) {
      const depotIcon = L.divIcon({
        html: `<div class="depot-marker"><div class="depot-icon">🏭</div></div>`,
        className: "",
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      });
      const dm = L.marker([origin.latitude, origin.longitude], { icon: depotIcon });
      dm.bindPopup(`
        <div class="marker-popup">
          <div class="popup-header"><strong class="popup-sequence">Sucursal</strong></div>
          <h4 class="popup-name">${origin.name}</h4>
          <p class="popup-address" style="color:#6b7280;font-size:12px">Punto de partida</p>
        </div>
      `);
      dm.addTo(markersLayer.current!);
    }

    // Paradas
    waypoints.forEach((wp) => createMarker(wp).addTo(markersLayer.current!));

    // Ajustar vista
    const allPoints: [number, number][] = waypoints.map((wp) => [wp.latitude, wp.longitude]);
    if (origin) allPoints.push([origin.latitude, origin.longitude]);
    if (userLocation) allPoints.push([userLocation.lat, userLocation.lng]);
    mapInstance.current.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50] });

    // Fetch inmediato cuando cambian waypoints (entrega confirmada, etc.)
    const waypointsKey = waypoints.map((w) => `${w.tracking_id}:${w.status}`).join(",");
    lastFetchRef.current = { waypointsKey, position: userLocation ?? null, time: Date.now() };
    fetchRoute();
  }, [waypoints, origin]);

  // Actualizar marcador GPS del chofer (debounced reroute)
  useEffect(() => {
    if (!mapInstance.current || !userMarkerLayer.current) return;

    userMarkerLayer.current.clearLayers();

    if (!userLocation) return;

    const icon = L.divIcon({
      html: `<div class="user-marker"><div class="user-dot"></div><div class="user-ring"></div></div>`,
      className: "",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    L.marker([userLocation.lat, userLocation.lng], { icon }).addTo(userMarkerLayer.current!);

    // En simulación: split local sin llamar a OSRM
    if (simulationMode === "simulate") {
      splitRouteAtGps(userLocation);
      return;
    }

    // GPS real: reroute OSRM con debounce (100m o 30s)
    const now = Date.now();
    const last = lastFetchRef.current;
    const distMoved = last.position ? haversineKm(userLocation, last.position) > 0.1 : true;
    const timePassed = now - last.time > 30000;

    if (distMoved || timePassed) {
      lastFetchRef.current = { ...last, position: userLocation, time: now };
      fetchRoute();
    }
  }, [userLocation]);

  // Al cambiar de modo (entrar/salir simulación), resetear el dibujo de la ruta
  useEffect(() => {
    if (!mapInstance.current) return;

    // Borrar ruta vieja siempre que cambia el modo
    if (doneRouteLayer.current) { doneRouteLayer.current.remove(); doneRouteLayer.current = null; }
    if (pendingRouteLayer.current) { pendingRouteLayer.current.remove(); pendingRouteLayer.current = null; }

    // Disparar fetchRoute para redibujar correctamente según el nuevo modo
    fetchRoute();
  }, [simulationMode]);

  const createMarker = (wp: Waypoint) => {
    const isCompleted = wp.status === "delivered" || wp.status === "delivery_failed";
    const isFailed = wp.status === "delivery_failed";
    const isDelivered = wp.status === "delivered";

    const icon = L.divIcon({
      html: `<div class="custom-marker ${isCompleted ? "completed" : ""} ${isFailed ? "failed" : ""} ${isDelivered ? "delivered" : ""}">
        <div class="marker-number">${wp.sequence}</div>
      </div>`,
      className: "",
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });

    const marker = L.marker([wp.latitude, wp.longitude], { icon });

    const badge = isDelivered
      ? '<span class="status-badge delivered">✓ Entregado</span>'
      : isFailed
      ? '<span class="status-badge failed">✗ No entregado</span>'
      : '<span class="status-badge pending">Pendiente</span>';

    marker.bindPopup(`
      <div class="marker-popup">
        <div class="popup-header">
          <strong class="popup-sequence">#${wp.sequence}</strong>
          ${badge}
        </div>
        <h4 class="popup-name">${wp.name}</h4>
        <p class="popup-address">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          ${wp.address}
        </p>
        <button class="popup-button" onclick="window.dispatchEvent(new CustomEvent('waypoint-click',{detail:'${wp.tracking_id}'}))">
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

  // Corta la polilínea almacenada en el punto más cercano al GPS — sin llamar a OSRM
  const splitRouteAtGps = (gps: { lat: number; lng: number }) => {
    if (!mapInstance.current) return;

    // Limpiar siempre, independientemente de si tenemos geometría
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

      // Ruta completa: origin solo en simulación (driver parte de la sucursal);
      // en modo normal el polyline conecta solo las paradas de entrega.
      const fullPoints: string[] = [];
      if (originCoord && simulationModeRef.current === "simulate") fullPoints.push(originCoord);
      sorted.forEach((wp) => fullPoints.push(toCoord(wp)));

      // Leer userLocation actual (no de closure, sino del ref)
      const currentLocation = userLocationRef.current;

      // Tramo pendiente: GPS > última completada > sucursal → paradas pendientes (para ETA)
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

      // Geometría completa (para dibujar) + segmento pendiente (para ETA)
      // Si los puntos son iguales, una sola llamada; si no, secuenciales para respetar rate limit
      const samePoints = fullPoints.join(";") === pendingPoints.join(";");
      const fullResult = await fetchOsrm(fullPoints);
      const pendingResult = samePoints ? fullResult : await fetchOsrm(pendingPoints);

      // Guardar geometría completa para split local (solo usada en simulación)
      if (fullResult) fullRouteGeomRef.current = fullResult.coords;

      // En simulación: solo dibujar si ya tenemos posición simulada;
      // si no, dejar vacío y esperar al primer tick (el efecto [userLocation] dibujará)
      if (simulationModeRef.current === "simulate") {
        if (userLocationRef.current) {
          splitRouteAtGps(userLocationRef.current);
        }
      } else {
        // GPS real o sin GPS: dibujar gris (debajo) + naranja (encima)
        if (completed.length > 0) {
          const donePoints: string[] = [];
          // Fuera de simulación: el tramo completado conecta solo las paradas (sin sucursal de origen)
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

  // Event listener para clicks en popups
  useEffect(() => {
    const handle = (e: Event) => onWaypointClick((e as CustomEvent).detail);
    window.addEventListener("waypoint-click", handle);
    return () => window.removeEventListener("waypoint-click", handle);
  }, [onWaypointClick]);

  if (waypoints.length === 0) {
    return (
      <div className="map-empty">
        <MapPin className="w-12 h-12 text-slate-300 mb-3" />
        <p className="text-sm font-semibold text-slate-900">No hay entregas para mostrar</p>
        <p className="text-xs text-slate-500 mt-1">
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
    <div className="map-view-container">
      <div ref={mapRef} className="map-canvas" />

      {/* Banner de simulación */}
      {isSimulating && (
        <div className="sim-banner">
          <span className="sim-badge">🎬 Modo simulación</span>
          {simulationMode === "simulate" && simulationControls && (
            <div className="sim-controls">
              <button
                onClick={simulationControls.isPaused ? simulationControls.play : simulationControls.pause}
                className="sim-btn"
              >
                {simulationControls.isPaused ? (
                  <><Play className="w-3 h-3" /> Reanudar</>
                ) : (
                  <><Pause className="w-3 h-3" /> Pausar</>
                )}
              </button>
              <button onClick={simulationControls.reset} className="sim-btn">
                <RotateCcw className="w-3 h-3" /> Reiniciar
              </button>
              {simulationControls.onExit && (
                <button onClick={simulationControls.onExit} className="sim-btn sim-btn-exit">
                  ✕ Salir
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Botón centrar en mi posición */}
      {userLocation && (
        <button
          className="recenter-btn"
          onClick={() => mapInstance.current?.flyTo([userLocation.lat, userLocation.lng], 16)}
          title="Centrar en mi posición"
        >
          <Crosshair className="w-4 h-4" />
        </button>
      )}

      {/* Info panel */}
      <div className="map-info-panel">
        <div className="info-card">
          <Package className="w-4 h-4 text-slate-600" />
          <div className="info-content">
            <p className="info-label">Paradas</p>
            <p className="info-value">{waypoints.length}</p>
          </div>
        </div>

        {routeInfo && (
          <>
            <div className="info-card">
              <Navigation className="w-4 h-4 text-slate-600" />
              <div className="info-content">
                <p className="info-label">Distancia</p>
                <p className="info-value">{(routeInfo.distance / 1000).toFixed(1)} km</p>
              </div>
            </div>
            <div className="info-card">
              <Clock className="w-4 h-4 text-slate-600" />
              <div className="info-content">
                <p className="info-label">Tiempo est.</p>
                <p className="info-value">{Math.round(routeInfo.duration / 60)} min</p>
              </div>
            </div>
          </>
        )}

        <div className="info-card">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <div className="info-content">
            <p className="info-label">Completadas</p>
            <p className="info-value">{completedCount}</p>
          </div>
        </div>

        <div className="info-card">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <div className="info-content">
            <p className="info-label">Pendientes</p>
            <p className="info-value">{pendingCount}</p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="map-loading">
          <div className="loading-spinner" />
          <p className="text-xs text-slate-600 mt-2">Calculando ruta...</p>
        </div>
      )}
    </div>
  );
}
