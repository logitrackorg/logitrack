import type { RoutingConfig } from "../api/routing";
import type { Shipment } from "../api/shipments";

export interface StopEta {
  trackingId: string;
  arrivalTime: Date;
  distanceFromPrevKm: number;
  travelMinutes: number;
  outsideWindow: boolean;
  /** positivo = tarde, negativo = temprano (minutos) */
  windowDeviationMin: number;
}

export interface RouteEtaResult {
  stops: StopEta[];
  totalDistanceKm: number;
  totalDurationMin: number;
  returnTime: Date;
  stopsInWindow: number;
}

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

function checkWindow(
  arrivalTime: Date,
  timeWindow: string | undefined,
  config: RoutingConfig,
): { outside: boolean; deviationMin: number } {
  if (!timeWindow || timeWindow === "flexible") return { outside: false, deviationMin: 0 };
  const arrMin = arrivalTime.getHours() * 60 + arrivalTime.getMinutes();
  let startMin: number;
  let endMin: number;
  if (timeWindow === "morning") {
    startMin = config.morning_window_start_hour * 60;
    endMin = config.morning_window_end_hour * 60;
  } else {
    startMin = config.afternoon_window_start_hour * 60;
    endMin = config.afternoon_window_end_hour * 60;
  }
  if (arrMin < startMin) return { outside: true, deviationMin: arrMin - startMin };
  if (arrMin > endMin) return { outside: true, deviationMin: arrMin - endMin };
  return { outside: false, deviationMin: 0 };
}

export function recomputeETA(
  orderedTids: string[],
  shipmentMap: Map<string, Shipment>,
  branchCoords: { lat: number; lng: number } | null,
  departureTime: Date,
  config: RoutingConfig,
): RouteEtaResult {
  const stops: StopEta[] = [];
  let totalDistanceKm = 0;
  let stopsInWindow = 0;

  // `departureFromPrev` is when we leave the previous location heading to the next stop.
  let departureFromPrev = new Date(departureTime);
  let prevCoords: { lat: number; lng: number } | null = branchCoords;

  for (const tid of orderedTids) {
    const sh = shipmentMap.get(tid);
    const lat = sh?.recipient?.address?.latitude;
    const lng = sh?.recipient?.address?.longitude;
    const coords: { lat: number; lng: number } | null =
      lat != null && lng != null ? { lat, lng } : null;

    let distKm = 0;
    let travelMin = 0;
    if (prevCoords && coords) {
      distKm = haversineKm(prevCoords, coords);
      travelMin = (distKm / config.avg_speed_kmh) * 60;
    }

    // Arrival = departure from prev + travel time
    const arrivalTime = new Date(departureFromPrev.getTime() + travelMin * 60000);
    const { outside, deviationMin } = checkWindow(arrivalTime, sh?.time_window, config);
    if (!outside) stopsInWindow++;

    stops.push({
      trackingId: tid,
      arrivalTime,
      distanceFromPrevKm: distKm,
      travelMinutes: travelMin,
      outsideWindow: outside,
      windowDeviationMin: deviationMin,
    });

    totalDistanceKm += distKm;
    // Depart from this stop after service time
    departureFromPrev = new Date(arrivalTime.getTime() + config.service_time_minutes * 60000);
    if (coords) prevCoords = coords;
  }

  // Return to branch
  let returnDistKm = 0;
  if (branchCoords && prevCoords && prevCoords !== branchCoords) {
    returnDistKm = haversineKm(prevCoords, branchCoords);
    totalDistanceKm += returnDistKm;
  }
  const returnTravelMin = (returnDistKm / config.avg_speed_kmh) * 60;
  const returnTime = new Date(departureFromPrev.getTime() + returnTravelMin * 60000);

  const totalDurationMin = stops.reduce(
    (sum, s) => sum + s.travelMinutes + config.service_time_minutes,
    0,
  ) + returnTravelMin;

  return { stops, totalDistanceKm, totalDurationMin, returnTime, stopsInWindow };
}

export function fmtHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
