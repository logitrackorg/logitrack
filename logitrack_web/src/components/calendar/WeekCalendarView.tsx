import { useRef, useEffect, useState, useCallback } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, DatesSetArg, EventInput } from "@fullcalendar/core";
import type { InterBranchTrip } from "../../api/interBranchTrips";
import { interBranchTripsApi } from "../../api/interBranchTrips";
import type { Branch } from "../../api/branches";
import type { UserProfile } from "../../api/users";
import { routingApi, type GlobalRoutingPlan, type InterBranchAssignment, type LastMileAssignment } from "../../api/routing";
import { tripToFCEvent, extractForecastEvents, minutesToISO } from "./tripEvents";

function localYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// splitEventByDay divide un evento que cruza medianoche en un segmento por día
// (clamp a [00:00, 24:00] de cada día). FullCalendar timeGrid no siempre dibuja
// la continuación del día siguiente para eventos timed multi-día; al partirlos
// en segmentos de un solo día garantizamos un bloque visible en cada columna.
function splitEventByDay(ev: EventInput): EventInput[] {
  if (!ev.start || !ev.end) return [ev];
  const start = new Date(ev.start as string);
  const end = new Date(ev.end as string);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return [ev];

  const segs: EventInput[] = [];
  let segStart = new Date(start);
  let idx = 0;
  while (segStart < end) {
    const nextMidnight = new Date(segStart.getFullYear(), segStart.getMonth(), segStart.getDate() + 1, 0, 0, 0);
    const segEnd = end < nextMidnight ? end : nextMidnight;
    segs.push({
      ...ev,
      id: idx === 0 ? ev.id : `${ev.id}__seg${idx}`,
      start: segStart.toISOString(),
      end: segEnd.toISOString(),
    });
    segStart = nextMidnight;
    idx++;
    if (idx > 7) break; // guarda contra loops
  }
  return segs;
}

interface Props {
  branches: Branch[];
  driverMap: Record<string, UserProfile>;
  branchId: string | undefined;
  kindFilter: "all" | "inter_branch" | "last_mile";
  onTripClick: (trip: InterBranchTrip, e: React.MouseEvent) => void;
  selectedTripId: string | null;
  horizonPlans?: GlobalRoutingPlan[];
}

export default function WeekCalendarView({
  branches,
  branchId,
  kindFilter,
  onTripClick,
  selectedTripId,
  horizonPlans = [],
}: Props) {
  const calRef = useRef<FullCalendar>(null);
  const [trips, setTrips] = useState<InterBranchTrip[]>([]);
  const [todayPlan, setTodayPlan] = useState<GlobalRoutingPlan | null>(null);
  const [loading, setLoading] = useState(false);

  // Plan de hoy para overlay de planificados.
  useEffect(() => {
    routingApi.getTodayPlan().then(setTodayPlan).catch(() => setTodayPlan(null));
  }, []);

  const fetchTrips = useCallback((from: string, to: string) => {
    setLoading(true);
    interBranchTripsApi.calendar(from, to, branchId)
      .then(setTrips)
      .catch(() => setTrips([]))
      .finally(() => setLoading(false));
  }, [branchId]);

  const handleDatesSet = (arg: DatesSetArg) => {
    fetchTrips(localYMD(arg.start), localYMD(arg.end));
  };

  // Eventos aplicados.
  const appliedEvents: EventInput[] = trips
    .filter((t) => kindFilter === "all" || t.kind === kindFilter)
    .map((t) => ({
      ...(tripToFCEvent(t, branches) as EventInput),
      extendedProps: { trip: t },
    }));

  // Planificados sin aplicar (solo hoy).
  const todayISO = localYMD(new Date());
  const plannedEvents: EventInput[] = [];
  if (todayPlan) {
    for (const bp of todayPlan.branch_plans ?? []) {
      for (const a of bp.plan?.inter_branch ?? []) {
        const ia = a as InterBranchAssignment;
        if (ia.applied) continue;
        if (kindFilter !== "all" && kindFilter !== "inter_branch") continue;
        if (!ia.estimated_departure_min) continue;
        const depH = Math.floor(ia.estimated_departure_min / 60);
        const depM = ia.estimated_departure_min % 60;
        const start = `${todayISO}T${String(depH).padStart(2,"0")}:${String(depM).padStart(2,"0")}:00`;
        const arrMin = ia.estimated_arrival_min ?? ia.estimated_departure_min + 30;
        const arrH = Math.floor(arrMin / 60) % 24;
        const arrM = arrMin % 60;
        const end = `${localYMD(new Date(new Date(start).getTime() + (arrMin - ia.estimated_departure_min) * 60_000))}T${String(arrH).padStart(2,"0")}:${String(arrM).padStart(2,"0")}:00`;
        plannedEvents.push({
          id: `planned-ib-${ia.vehicle_id}`,
          title: `${ia.license_plate} (sin aplicar)`,
          start,
          end,
          backgroundColor: "var(--warn,#f59e0b)",
          borderColor: "var(--warn,#f59e0b)",
          textColor: "#fff",
          classNames: ["fc-planned"],
          extendedProps: {},
        });
      }
      for (const a of bp.plan?.last_mile ?? []) {
        const la = a as LastMileAssignment;
        if (la.applied) continue;
        if (kindFilter !== "all" && kindFilter !== "last_mile") continue;
        if (!la.suggested_departure_min) continue;
        const depH = Math.floor(la.suggested_departure_min / 60);
        const depM = la.suggested_departure_min % 60;
        const start = `${todayISO}T${String(depH).padStart(2,"0")}:${String(depM).padStart(2,"0")}:00`;
        const lastStop = (la.ordered_stops ?? []).at(-1);
        const durMin = lastStop && lastStop.arrival_min >= 0 ? lastStop.arrival_min + 30 : 30;
        const end = new Date(new Date(start).getTime() + durMin * 60_000).toISOString();
        plannedEvents.push({
          id: `planned-lm-${la.vehicle_id}`,
          title: `${la.license_plate} (sin aplicar)`,
          start,
          end,
          backgroundColor: "var(--warn,#f59e0b)",
          borderColor: "var(--warn,#f59e0b)",
          textColor: "#fff",
          classNames: ["fc-planned"],
          extendedProps: {},
        });
      }
    }
  }

  // Eventos de pronóstico (D+1, D+2) — from horizonPlans.
  const forecastFC: EventInput[] = extractForecastEvents(horizonPlans, branches, kindFilter)
    .map((ev) => {
      const start = minutesToISO(ev.planDate, ev.departureMin);
      const end = minutesToISO(ev.planDate, ev.arrivalMin);
      if (!start || !end) return null; // fecha inválida → descartar el evento
      return {
        id: ev.key,
        title: `${ev.licensePlate} · ${ev.routeLabel}`,
        start,
        end,
        backgroundColor: ev.kind === "last_mile" ? "rgba(16,185,129,0.25)" : "rgba(37,99,235,0.2)",
        borderColor: ev.kind === "last_mile" ? "#10b981" : "var(--sidebar-bg)",
        textColor: ev.kind === "last_mile" ? "#065f46" : "var(--sidebar-bg)",
        classNames: ["fc-forecast"],
        extendedProps: { forecastEvent: ev },
      } as EventInput;
    })
    .filter((e): e is EventInput => e !== null);

  const handleEventClick = (arg: EventClickArg) => {
    const trip = arg.event.extendedProps?.trip as InterBranchTrip | undefined;
    if (!trip) return;
    const rect = arg.el.getBoundingClientRect();
    const syntheticEvent = { currentTarget: { getBoundingClientRect: () => rect } } as unknown as React.MouseEvent;
    onTripClick(trip, syntheticEvent);
  };

  return (
    <div className="fc-wrapper" style={{ position: "relative" }}>
      {loading && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "var(--brand-800)", zIndex: 20, animation: "pulse 1s ease-in-out infinite" }} />
      )}
      <FullCalendar
        ref={calRef}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        firstDay={1}
        locale="es"
        nowIndicator
        scrollTime="06:00:00"
        allDaySlot={false}
        headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
        buttonText={{ today: "Hoy" }}
        height="calc(100vh - 220px)"
        events={[...appliedEvents, ...plannedEvents, ...forecastFC].flatMap(splitEventByDay)}
        eventClick={handleEventClick}
        datesSet={handleDatesSet}
        eventDidMount={(info: { event: { id: string; borderColor: string }; el: HTMLElement }) => {
          if (info.event.id === selectedTripId) {
            info.el.style.outline = `2px solid ${info.event.borderColor}`;
            info.el.style.outlineOffset = "1px";
          }
        }}
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
      />
    </div>
  );
}
