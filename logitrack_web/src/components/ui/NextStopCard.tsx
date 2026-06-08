import { Navigation, CheckCircle2, XCircle, MapPin, Clock, Map, Ban } from "lucide-react";
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
  onRejected: () => void;
}

export function NextStopCard({
  nextStop,
  allPendingStops,
  userLocation,
  routeInfo,
  canAct,
  onDeliver,
  onFailed,
  onRejected,
}: NextStopCardProps) {
  const truncated = allPendingStops.length > 9;

  if (!nextStop) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 text-center py-6">
        <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mx-auto mb-2" />
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">¡Ruta completada!</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Todas las paradas registradas.</p>
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
    <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-4">
      {/* Handle visual */}
      <div className="w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-3" />

      {/* Encabezado: nro de parada + info */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-[var(--sidebar-bg)] text-white font-bold text-sm flex items-center justify-center shrink-0">
          {String(nextStop.sequence).padStart(2, "0")}
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{nextStop.name}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            <MapPin className="inline w-3 h-3 mr-0.5 opacity-50" />
            {nextStop.address}
          </p>
          {routeInfo && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              <Clock className="inline w-3 h-3 mr-0.5 opacity-50" />
              {Math.round(routeInfo.duration / 60)} min · {(routeInfo.distance / 1000).toFixed(1)} km
            </p>
          )}
        </div>
      </div>

      {/* Acciones principales */}
      <div className="flex gap-2 mt-4">
        <a
          href={singleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg py-2.5 px-4 text-sm font-semibold cursor-pointer border-none transition-colors flex items-center justify-center gap-2 no-underline"
        >
          <Navigation className="w-4 h-4" />
          Navegar
        </a>
        {canAct && (
          <>
            <button onClick={onDeliver} className="flex-1 bg-green-500 hover:bg-green-600 text-white rounded-lg py-2.5 px-4 text-sm font-semibold cursor-pointer border-none transition-colors flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Entregar
            </button>
            <button onClick={onFailed} className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2.5 px-4 text-sm font-semibold cursor-pointer border-none transition-colors flex items-center justify-center gap-2">
              <XCircle className="w-4 h-4" />
              No entregado
            </button>
          </>
        )}
      </div>

      {/* Acción secundaria: rechazo activo del destinatario */}
      {canAct && (
        <div className="flex gap-2 mt-2">
          <button onClick={onRejected} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg py-2 px-3 text-xs font-semibold cursor-pointer border-none transition-colors flex items-center justify-center gap-2">
            <Ban className="w-4 h-4" />
            Rechazado por destinatario
          </button>
        </div>
      )}

      {/* Ruta completa en Google Maps */}
      <a
        href={fullRouteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full text-center text-blue-600 dark:text-blue-400 text-xs py-2 cursor-pointer hover:underline flex items-center justify-center gap-1.5 mt-2 no-underline"
      >
        <Map className="w-3.5 h-3.5 shrink-0" />
        Abrir ruta completa en Google Maps
        {truncated && (
          <span className="text-[10px] text-gray-400 ml-1">(primeras 9 paradas)</span>
        )}
      </a>
    </div>
  );
}
