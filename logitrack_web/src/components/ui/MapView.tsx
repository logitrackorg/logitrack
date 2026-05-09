import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { 
  MapPin, 
  Navigation, 
  Clock, 
  CheckCircle2, 
  Package,
  AlertTriangle 
} from "lucide-react";
import "./MapView.css";

// Fix para los iconos de Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface Waypoint {
  sequence: number;
  tracking_id: string;
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  status: string;
}

interface MapViewProps {
  waypoints: Waypoint[];
  onWaypointClick: (trackingId: string) => void;
}

export function MapView({ waypoints, onWaypointClick }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const routeLayer = useRef<L.Polyline | null>(null);
  
  const [routeInfo, setRouteInfo] = useState<{
    distance: number;
    duration: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // Inicializar mapa
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center: [-34.6037, -58.3816], // Buenos Aires
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstance.current = map;
    markersLayer.current = L.layerGroup().addTo(map);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Actualizar marcadores y ruta cuando cambien los waypoints
  useEffect(() => {
    if (!mapInstance.current || !markersLayer.current || waypoints.length === 0) return;

    // Limpiar capas anteriores
    markersLayer.current.clearLayers();
    if (routeLayer.current) {
      routeLayer.current.remove();
      routeLayer.current = null;
    }

    // Agregar marcadores
    waypoints.forEach((wp) => {
      const marker = createMarker(wp);
      marker.addTo(markersLayer.current!);
    });

    // Ajustar vista a todos los marcadores
    const bounds = L.latLngBounds(
      waypoints.map((wp) => [wp.latitude, wp.longitude])
    );
    mapInstance.current.fitBounds(bounds, { padding: [50, 50] });

    // Obtener ruta de OSRM
    if (waypoints.length >= 2) {
      fetchRoute();
    }
  }, [waypoints]);

  const createMarker = (wp: Waypoint) => {
    const isCompleted = wp.status === "delivered" || wp.status === "delivery_failed";
    const isFailed = wp.status === "delivery_failed";
    const isDelivered = wp.status === "delivered";

    const icon = L.divIcon({
      html: `
        <div class="custom-marker ${isCompleted ? 'completed' : ''} ${isFailed ? 'failed' : ''} ${isDelivered ? 'delivered' : ''}">
          <div class="marker-number">${wp.sequence}</div>
        </div>
      `,
      className: "",
      iconSize: [36, 36],
      iconAnchor: [18, 36],
    });

    const marker = L.marker([wp.latitude, wp.longitude], { icon });

    const statusBadge = isDelivered 
      ? '<span class="status-badge delivered">✓ Entregado</span>'
      : isFailed
      ? '<span class="status-badge failed">✗ No entregado</span>'
      : '<span class="status-badge pending">Pendiente</span>';

    marker.bindPopup(`
      <div class="marker-popup">
        <div class="popup-header">
          <strong class="popup-sequence">#${wp.sequence}</strong>
          ${statusBadge}
        </div>
        <h4 class="popup-name">${wp.name}</h4>
        <p class="popup-address">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
          </svg>
          ${wp.address}
        </p>
        <button class="popup-button" onclick="window.dispatchEvent(new CustomEvent('waypoint-click', { detail: '${wp.tracking_id}' }))">
          Ver detalle →
        </button>
      </div>
    `);

    return marker;
  };

  const fetchRoute = async () => {
    setLoading(true);
    try {
      // Ordenar waypoints por sequence
      const sorted = [...waypoints].sort((a, b) => a.sequence - b.sequence);
      
      // Construir coordenadas para OSRM
      const coordinates = sorted
        .map((wp) => `${wp.longitude},${wp.latitude}`)
        .join(";");

      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`
      );

      const data = await response.json();

      if (data.code === "Ok" && data.routes && data.routes[0]) {
        const route = data.routes[0];
        
        // Dibujar la ruta
        const routeCoordinates = route.geometry.coordinates.map(
          (coord: number[]) => [coord[1], coord[0]] as [number, number]
        );

        if (routeLayer.current) {
          routeLayer.current.remove();
        }

        routeLayer.current = L.polyline(routeCoordinates, {
          color: "#f97316",
          weight: 4,
          opacity: 0.7,
        }).addTo(mapInstance.current!);

        // Guardar info de la ruta
        setRouteInfo({
          distance: route.distance,
          duration: route.duration,
        });
      }
    } catch (error) {
      console.error("Error obteniendo ruta OSRM:", error);
    } finally {
      setLoading(false);
    }
  };

  // Event listener para clicks en los popups
  useEffect(() => {
    const handleWaypointClick = (e: Event) => {
      const trackingId = (e as CustomEvent).detail;
      onWaypointClick(trackingId);
    };

    window.addEventListener("waypoint-click", handleWaypointClick);
    return () => window.removeEventListener("waypoint-click", handleWaypointClick);
  }, [onWaypointClick]);

  if (waypoints.length === 0) {
    return (
      <div className="map-empty">
        <MapPin className="w-12 h-12 text-slate-300 mb-3" />
        <p className="text-sm font-semibold text-slate-900">No hay entregas para mostrar</p>
        <p className="text-xs text-slate-500 mt-1">Las paradas aparecerán aquí cuando inicies la ruta.</p>
      </div>
    );
  }

  const pending = waypoints.filter(w => w.status === "out_for_delivery").length;
  const completed = waypoints.filter(w => w.status === "delivered" || w.status === "delivery_failed").length;

  return (
    <div className="map-view-container">
      <div ref={mapRef} className="map-canvas" />
      
      {/* Info cards flotantes */}
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
                <p className="info-value">
                  {(routeInfo.distance / 1000).toFixed(1)} km
                </p>
              </div>
            </div>

            <div className="info-card">
              <Clock className="w-4 h-4 text-slate-600" />
              <div className="info-content">
                <p className="info-label">Tiempo est.</p>
                <p className="info-value">
                  {Math.round(routeInfo.duration / 60)} min
                </p>
              </div>
            </div>
          </>
        )}

        <div className="info-card">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <div className="info-content">
            <p className="info-label">Completadas</p>
            <p className="info-value">{completed}</p>
          </div>
        </div>

        <div className="info-card">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <div className="info-content">
            <p className="info-label">Pendientes</p>
            <p className="info-value">{pending}</p>
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