import type { Shipment, ShipmentStatus } from "../api/shipments";
import type { InterBranchTrip } from "../api/interBranchTrips";

export type TripGroupSummary = {
  total: number;
  delivered: number;
  inProgress: number;
  problems: number;
  byStatus: Partial<Record<ShipmentStatus, number>>;
};

export type TripGroup = {
  trip: InterBranchTrip;
  shipments: Shipment[];
  summary: TripGroupSummary;
};

const TERMINAL_SUCCESS: ShipmentStatus[] = ["delivered", "returned"];
const PROBLEM_STATUSES: ShipmentStatus[] = [
  "delivery_failed",
  "rechazado",
  "no_entregado",
  "lost",
  "destroyed",
];
const IN_PROGRESS: ShipmentStatus[] = [
  "loaded",
  "in_transit",
  "out_for_delivery",
  "at_hub",
  "at_origin_hub",
  "ready_for_pickup",
];

/** All tracking IDs associated with a trip (root list + stop dropoffs/pickups). */
export function collectTripShipmentIds(trip: InterBranchTrip): string[] {
  const ids = new Set<string>();
  for (const tid of trip.shipment_ids ?? []) ids.add(tid);
  for (const stop of trip.stops ?? []) {
    for (const tid of stop.shipment_ids ?? []) ids.add(tid);
    for (const tid of stop.pickup_shipment_ids ?? []) ids.add(tid);
  }
  return [...ids];
}

/** Inverted index: tracking_id → trip (last write wins if duplicated). */
export function buildShipmentToTripMap(trips: InterBranchTrip[]): Map<string, InterBranchTrip> {
  const map = new Map<string, InterBranchTrip>();
  for (const trip of trips) {
    for (const tid of collectTripShipmentIds(trip)) {
      map.set(tid, trip);
    }
  }
  return map;
}

function summarizeShipments(shipments: Shipment[]): TripGroupSummary {
  const byStatus: Partial<Record<ShipmentStatus, number>> = {};
  let delivered = 0;
  let inProgress = 0;
  let problems = 0;
  for (const s of shipments) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    if (TERMINAL_SUCCESS.includes(s.status)) delivered++;
    else if (PROBLEM_STATUSES.includes(s.status)) problems++;
    else if (IN_PROGRESS.includes(s.status)) inProgress++;
  }
  return { total: shipments.length, delivered, inProgress, problems, byStatus };
}

/** Groups filtered shipments by active trip; unmatched go to `ungrouped`. */
export function groupShipmentsByTrip(
  shipments: Shipment[],
  trips: InterBranchTrip[],
): { groups: TripGroup[]; ungrouped: Shipment[] } {
  const tripByTid = buildShipmentToTripMap(trips);
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const byTripId = new Map<string, { trip: InterBranchTrip; shipments: Shipment[] }>();
  const ungrouped: Shipment[] = [];

  for (const s of shipments) {
    let trip = tripByTid.get(s.tracking_id);
    if (!trip && s.reserved_for_trip_id) {
      trip = tripById.get(s.reserved_for_trip_id);
    }
    if (trip) {
      let bucket = byTripId.get(trip.id);
      if (!bucket) {
        bucket = { trip, shipments: [] };
        byTripId.set(trip.id, bucket);
      }
      bucket.shipments.push(s);
    } else {
      ungrouped.push(s);
    }
  }

  const statusOrder: Record<string, number> = { en_transito: 0, pendiente: 1 };
  const groups: TripGroup[] = [...byTripId.values()]
    .map(({ trip, shipments: groupShipments }) => ({
      trip,
      shipments: groupShipments,
      summary: summarizeShipments(groupShipments),
    }))
    .sort((a, b) => {
      const sa = statusOrder[a.trip.status] ?? 2;
      const sb = statusOrder[b.trip.status] ?? 2;
      if (sa !== sb) return sa - sb;
      return a.trip.license_plate.localeCompare(b.trip.license_plate);
    });

  return { groups, ungrouped };
}

export function filterActiveTrips(trips: InterBranchTrip[]): InterBranchTrip[] {
  return trips.filter((t) => t.status === "pendiente" || t.status === "en_transito");
}
