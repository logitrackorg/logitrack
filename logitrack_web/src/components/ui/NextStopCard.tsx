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
      <div className="px-4 pb-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm p-4 text-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mx-auto mb-2" />
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
    <div className="px-4 pb-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-3 py-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-[var(--sidebar-bg)] text-white text-base font-bold flex items-center justify-center">
              {String(nextStop.sequence).padStart(2, "0")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold leading-snug truncate dark:text-gray-100 text-slate-900">
                {nextStop.name}
              </p>
              <p className="mt-1 text-base leading-snug flex items-start gap-1.5 dark:text-gray-300 text-slate-600">
                <MapPin className="w-4 h-4 mt-0.5 dark:text-gray-500 text-slate-400 shrink-0" />
                <span className="break-words">{nextStop.address}</span>
              </p>
              {routeInfo && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400">
                    <Clock className="w-3 h-3" />
                    {Math.round(routeInfo.duration / 60)} min
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400">
                    <Navigation className="w-3 h-3" />
                    {(routeInfo.distance / 1000).toFixed(1)} km
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons row */}
          {canAct && (
            <div className="flex items-center gap-1.5 mt-3">
              <a
                href={singleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-9 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-semibold cursor-pointer border-none transition-colors flex items-center justify-center gap-1.5 no-underline"
              >
                <Navigation className="w-4 h-4" />
                Navegar
              </a>
              <button
                onClick={onDeliver}
                className="flex-1 h-9 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold cursor-pointer border-none transition-colors flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                Entregar
              </button>
              <button
                onClick={onFailed}
                className="h-9 w-9 bg-red-500 hover:bg-red-600 text-white rounded-xl cursor-pointer border-none transition-colors flex items-center justify-center shrink-0"
                title="No entregado"
              >
                <XCircle className="w-4 h-4" />
              </button>
              <button
                onClick={onRejected}
                className="h-9 w-9 bg-orange-500 hover:bg-orange-600 text-white rounded-xl cursor-pointer border-none transition-colors flex items-center justify-center shrink-0"
                title="Rechazado"
              >
                <Ban className="w-4 h-4" />
              </button>
            </div>
          )}

          {!canAct && (
            <a
              href={singleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 h-9 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold cursor-pointer border-none transition-colors flex items-center justify-center gap-1 no-underline"
            >
              <Navigation className="w-3.5 h-3.5" />
              Navegar
            </a>
          )}
        </div>

        {/* Footer: Google Maps link */}
        <a
          href={fullRouteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full text-center text-[var(--brand)] dark:text-[var(--info-text)] text-[11px] py-2 cursor-pointer hover:underline flex items-center justify-center gap-1 no-underline border-t border-[var(--border)] bg-[var(--bg-subtle)]"
        >
          <Map className="w-3 h-3 shrink-0" />
          Ruta completa en Google Maps
          {truncated && (
            <span className="text-[10px] text-gray-400 ml-1">(9 primeras)</span>
          )}
        </a>
      </div>
    </div>
  );
}
