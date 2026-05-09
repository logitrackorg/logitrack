import { Navigation, CheckCircle2, XCircle, MapPin, Clock, Map } from "lucide-react";
import { googleMapsSingleStop, googleMapsRoute } from "../../utils/googleMaps";
import type { GeoPoint } from "../../utils/googleMaps";

export interface NextStop {
  sequence: number;
  tracking_id: string;
  latitude: number;
  longitude: number;
  name: string;
  address: string;
}

interface NextStopCardProps {
  nextStop: NextStop | null;
  allPendingStops: NextStop[];
  userLocation?: GeoPoint;
  routeInfo: { distance: number; duration: number } | null;
  canAct: boolean;
  onDeliver: () => void;
  onFailed: () => void;
}

export function NextStopCard({
  nextStop,
  allPendingStops,
  userLocation,
  routeInfo,
  canAct,
  onDeliver,
  onFailed,
}: NextStopCardProps) {
  const truncated = allPendingStops.length > 9;

  if (!nextStop) {
    return (
      <div className="nsc-root nsc-done">
        <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
        <div>
          <p className="text-sm font-bold text-slate-900">¡Ruta completada!</p>
          <p className="text-xs text-slate-500 mt-0.5">Todas las paradas registradas.</p>
        </div>
      </div>
    );
  }

  const singleUrl = googleMapsSingleStop({ lat: nextStop.latitude, lng: nextStop.longitude });
  const fullRouteUrl = googleMapsRoute({
    origin: userLocation,
    stops: allPendingStops.map((s) => ({ lat: s.latitude, lng: s.longitude })),
  });

  return (
    <div className="nsc-root">
      {/* Handle visual */}
      <div className="nsc-handle" />

      {/* Encabezado: nro de parada + info */}
      <div className="nsc-header">
        <div className="nsc-seq">{String(nextStop.sequence).padStart(2, "0")}</div>
        <div className="nsc-info">
          <p className="nsc-name">{nextStop.name}</p>
          <p className="nsc-address">
            <MapPin className="inline w-3 h-3 mr-0.5 opacity-50" />
            {nextStop.address}
          </p>
          {routeInfo && (
            <p className="nsc-eta">
              <Clock className="inline w-3 h-3 mr-0.5 opacity-50" />
              {Math.round(routeInfo.duration / 60)} min · {(routeInfo.distance / 1000).toFixed(1)} km
            </p>
          )}
        </div>
      </div>

      {/* Acciones principales */}
      <div className="nsc-actions">
        <a
          href={singleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="nsc-btn nsc-navigate"
        >
          <Navigation className="w-4 h-4" />
          Navegar
        </a>
        {canAct && (
          <>
            <button onClick={onDeliver} className="nsc-btn nsc-deliver">
              <CheckCircle2 className="w-4 h-4" />
              Entregar
            </button>
            <button onClick={onFailed} className="nsc-btn nsc-failed">
              <XCircle className="w-4 h-4" />
              No entregado
            </button>
          </>
        )}
      </div>

      {/* Ruta completa */}
      {allPendingStops.length > 1 && (
        <a
          href={fullRouteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="nsc-full-route"
        >
          <Map className="w-3.5 h-3.5 shrink-0" />
          Abrir ruta completa en Google Maps
          {truncated && (
            <span className="text-[10px] text-slate-400 ml-1">(primeras 9 paradas)</span>
          )}
        </a>
      )}
    </div>
  );
}
