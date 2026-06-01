import type { InterBranchTrip } from "../../api/interBranchTrips";
import { branchLabelById, type Branch } from "../../api/branches";
import type { GlobalRoutingPlan, InterBranchAssignment, LastMileAssignment } from "../../api/routing";

export const KIND_COLOR: Record<string, string> = {
  inter_branch: "var(--brand-800,#1e3a5f)",
  last_mile:    "var(--ok,#10b981)",
};

export const KIND_TINT: Record<string, string> = {
  inter_branch: "rgba(37,99,235,0.14)",
  last_mile:    "rgba(16,185,129,0.14)",
};

export const TRIP_STATUS_LABEL: Record<string, string> = {
  pendiente:   "Pendiente",
  en_transito: "En tránsito",
  completado:  "Completado",
  cancelado:   "Cancelado",
};

// Ruta legible: origen → paradas → destino
export function routeLabel(trip: InterBranchTrip, branches: Branch[]): string {
  const r = [branchLabelById(trip.origin_branch_id, branches)];
  if (trip.stops && trip.stops.length > 0) {
    trip.stops.forEach((s) => r.push(branchLabelById(s.branch_id, branches)));
  } else if (trip.destination_branch_id) {
    r.push(branchLabelById(trip.destination_branch_id, branches));
  }
  return r.join(" → ");
}

// Minutos desde medianoche (local) de un ISO timestamp, usando diferencia real
// entre timestamps para manejar viajes multi-día correctamente.
export function minsFromMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

// Duración en minutos entre dos ISO timestamps.
export function tripDurationMin(trip: InterBranchTrip): number {
  const dep = trip.scheduled_departure_at ?? trip.created_at;
  const arr = trip.estimated_arrival_at;
  if (!arr) return 30;
  const ms = new Date(arr).getTime() - new Date(dep).getTime();
  return ms > 0 ? ms / 60_000 : 30;
}

// ── Forecast events ───────────────────────────────────────────────────────────

export interface ForecastEvent {
  key: string;
  planDate: string;        // YYYY-MM-DD
  kind: "inter_branch" | "last_mile";
  licensePlate: string;
  vehicleId: string;
  departureMin: number;    // minutos desde medianoche
  arrivalMin: number;      // minutos desde medianoche (puede ser > 1440 si cruza medianoche)
  routeLabel: string;
  shipmentCount: number;
  horizonOffset: number;   // 1=mañana, 2=pasado
}

/** Convierte un minuto-desde-medianoche + planDate a ISO timestamp.
 * Devuelve "" si la fecha o los minutos son inválidos (el caller debe descartar). */
export function minutesToISO(planDate: string, mins: number): string {
  // Normalizar: plan_date puede venir como "YYYY-MM-DD" o como timestamp completo
  // ("YYYY-MM-DDT00:00:00Z" según el driver de DB). Tomar solo la parte de fecha.
  const datePart = (planDate ?? "").slice(0, 10);
  const [y, mo, d] = datePart.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) || !Number.isFinite(mins)) {
    return "";
  }
  const extraDays = Math.floor(mins / 1440);
  const remMins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(remMins / 60);
  const m = remMins % 60;
  const base = new Date(y, mo - 1, d + extraDays, h, m, 0);
  if (isNaN(base.getTime())) return "";
  return base.toISOString();
}

/** Extrae los ForecastEvent de todos los planes del horizonte (solo D>0). */
export function extractForecastEvents(
  horizonPlans: GlobalRoutingPlan[],
  branches: Branch[],
  kindFilter: "all" | "inter_branch" | "last_mile",
): ForecastEvent[] {
  const events: ForecastEvent[] = [];
  for (const plan of horizonPlans) {
    if (!plan.is_forecast || !plan.plan_date) continue;
    for (const bp of plan.branch_plans ?? []) {
      for (const a of bp.plan?.inter_branch ?? []) {
        const ia = a as InterBranchAssignment;
        if (kindFilter !== "all" && kindFilter !== "inter_branch") continue;
        if (!ia.estimated_departure_min) continue;
        const dests = [bp.branch_id, ia.destination_branch];
        (ia.additional_stops ?? []).forEach((s) => dests.push(s.branch_id));
        events.push({
          key: `fc-ib-${plan.plan_date}-${ia.vehicle_id}`,
          planDate: plan.plan_date,
          kind: "inter_branch",
          licensePlate: ia.license_plate,
          vehicleId: ia.vehicle_id,
          departureMin: ia.estimated_departure_min,
          arrivalMin: ia.estimated_arrival_min ?? ia.estimated_departure_min + 30,
          routeLabel: dests.filter(Boolean).map((b) => branchLabelById(b, branches)).join(" → "),
          shipmentCount: ia.shipments.length,
          horizonOffset: plan.horizon_offset ?? 1,
        });
      }
      for (const a of bp.plan?.last_mile ?? []) {
        const la = a as LastMileAssignment;
        if (kindFilter !== "all" && kindFilter !== "last_mile") continue;
        if (!la.suggested_departure_min) continue;
        const lastStop = (la.ordered_stops ?? []).at(-1);
        const arrMin = lastStop && lastStop.arrival_min >= 0
          ? la.suggested_departure_min + lastStop.arrival_min
          : la.suggested_departure_min + 30;
        events.push({
          key: `fc-lm-${plan.plan_date}-${la.vehicle_id}`,
          planDate: plan.plan_date,
          kind: "last_mile",
          licensePlate: la.license_plate,
          vehicleId: la.vehicle_id,
          departureMin: la.suggested_departure_min,
          arrivalMin: arrMin,
          routeLabel: branchLabelById(bp.branch_id, branches),
          shipmentCount: la.shipments.length,
          horizonOffset: plan.horizon_offset ?? 1,
        });
      }
    }
  }
  return events;
}

// Objeto normalizado para FullCalendar (EventInput).
export function tripToFCEvent(trip: InterBranchTrip, branches: Branch[]): object {
  const dep = trip.scheduled_departure_at ?? trip.created_at;
  const arr = trip.estimated_arrival_at
    ?? new Date(new Date(dep).getTime() + 30 * 60_000).toISOString();
  const color = trip.kind === "last_mile" ? "#10b981" : "#1e3a5f";
  const label = routeLabel(trip, branches);
  return {
    id: trip.id,
    title: `${trip.license_plate}  ${label}`,
    start: dep,
    end: arr,
    backgroundColor: color,
    borderColor: color,
    textColor: "#ffffff",
    extendedProps: { trip, routeLabel: label },
  };
}
