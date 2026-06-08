import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InterBranchTrip } from "../../api/interBranchTrips";
import { interBranchTripsApi } from "../../api/interBranchTrips";
import { vehicleApi, type Vehicle } from "../../api/vehicles";
import type { Branch } from "../../api/branches";
import type { UserProfile } from "../../api/users";
import { vehicleStatusLabel, vehicleStatusColor } from "../../utils/vehicleStatus";
import { routeLabel, KIND_COLOR, KIND_TINT, TRIP_STATUS_LABEL, minsFromMidnight, tripDurationMin, extractForecastEvents, type ForecastEvent } from "./tripEvents";
import { fmtMinutesAsTime } from "../../utils/date";

// ── constantes ───────────────────────────────────────────────────────────────
const ROW_H = 52;         // px por fila de vehículo
const SECTION_H = 30;     // px por encabezado de sección (inter-sucursal / última milla)
const LABEL_W = 148;      // px del panel izquierdo (patente + estado)
const HOUR_W = 56;        // px por hora en el eje

function localYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}

function isToday(d: Date) {
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

const MONTHS_SHORT = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// ── helpers de posición ───────────────────────────────────────────────────────
// Posición % en el eje de 24 horas para un número de minutos dado.
// Acepta minutos > 1440 (multi-día) y los clampea a [0, 1440].
function pct(min: number) { return `${Math.max(0, Math.min(100, (min / 1440) * 100)).toFixed(3)}%`; }
function pctWidth(startMin: number, durMin: number) {
  const s = Math.max(0, startMin);
  const e = Math.min(1440, startMin + durMin);
  return `${Math.max(0.5, ((e - s) / 1440) * 100).toFixed(3)}%`;
}

// ── componente principal ──────────────────────────────────────────────────────
interface Props {
  branches: Branch[];
  driverMap: Record<string, UserProfile>;
  branchId: string | undefined;
  kindFilter: "all" | "inter_branch" | "last_mile";
  onTripClick: (trip: InterBranchTrip, e: React.MouseEvent) => void;
  selectedTripId: string | null;
  horizonPlans?: import("../../api/routing").GlobalRoutingPlan[];
}

export default function VehicleTimelineView({
  branches,
  driverMap,
  branchId,
  kindFilter,
  onTripClick,
  selectedTripId,
  horizonPlans = [],
}: Props) {
  const [day, setDay] = useState<Date>(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<InterBranchTrip[]>([]);
  const [loading, setLoading] = useState(false);

  const today = isToday(day);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  // Carga vehículos (una vez).
  useEffect(() => {
    vehicleApi.list().then(setVehicles).catch(() => {});
  }, []);

  // Carga trips del día visible + día anterior para mostrar continuaciones
  // de viajes que salieron ayer y llegan hoy.
  useEffect(() => {
    setLoading(true);
    const from = localYMD(addDays(day, -1));
    const to = localYMD(addDays(day, 2)); // exclusivo: cubre hasta mañana
    interBranchTripsApi.calendar(from, to, branchId)
      .then(setTrips)
      .catch(() => setTrips([]))
      .finally(() => setLoading(false));
  }, [day.getTime(), branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trips por vehículo del día visible, incluyendo continuaciones de ayer.
  // Declarado ANTES de filteredVehicles porque filteredVehicles lo referencia.
  const tripsByVehicle = useMemo(() => {
    const dayKey = localYMD(day);
    const prevDayKey = localYMD(addDays(day, -1));
    const map: Record<string, { trip: InterBranchTrip; isContinuation: boolean }[]> = {};
    for (const t of trips) {
      if (kindFilter !== "all" && t.kind !== kindFilter) continue;
      const depDayKey = localYMD(new Date(t.scheduled_departure_at ?? t.created_at));
      const arrDayKey = t.estimated_arrival_at ? localYMD(new Date(t.estimated_arrival_at)) : null;

      if (depDayKey === dayKey) {
        (map[t.vehicle_id] ??= []).push({ trip: t, isContinuation: false });
      } else if (depDayKey === prevDayKey && arrDayKey && arrDayKey >= dayKey) {
        (map[t.vehicle_id] ??= []).push({ trip: t, isContinuation: true });
      }
    }
    return map;
  }, [trips, day, kindFilter]);

  // Eventos de pronóstico del día visible, agrupados por vehicleId.
  // Declarado ANTES de filteredVehicles/vehicleRows porque esos lo referencian
  // para incluir los vehículos pronosticados como filas (en D+1 el vehículo está,
  // en la vida real de hoy, asignado a otra sucursal y se filtraría).
  const forecastByVehicle = useMemo(() => {
    const dayKey = localYMD(day);
    const allForecast = extractForecastEvents(horizonPlans, branches, kindFilter);
    const map: Record<string, ForecastEvent[]> = {};
    for (const ev of allForecast) {
      if (ev.planDate !== dayKey) continue;
      (map[ev.vehicleId] ??= []).push(ev);
    }
    return map;
  }, [horizonPlans, branches, kindFilter, day]);

  // Vehículos filtrados por sucursal (client-side, igual que VehicleList).
  const filteredVehicles = useMemo(() => {
    let veh = vehicles.filter((v) => v.status !== "inactivo");
    if (branchId) {
      const vehicleIdsWithTrips = new Set(Object.keys(tripsByVehicle));
      const vehicleIdsWithForecast = new Set(Object.keys(forecastByVehicle));
      veh = veh.filter(
        (v) => v.assigned_branch === branchId || v.destination_branch === branchId ||
          vehicleIdsWithTrips.has(v.id) || vehicleIdsWithForecast.has(v.id),
      );
    }
    return veh.sort((a, b) => a.license_plate.localeCompare(b.license_plate));
  }, [vehicles, branchId, tripsByVehicle, forecastByVehicle]);

  // También vehículos que tienen viaje o pronóstico pero no están en la lista filtrada.
  const vehicleRows = useMemo(() => {
    const rows = [...filteredVehicles];
    const seen = new Set(rows.map((v) => v.id));
    const extraIds = [...Object.keys(tripsByVehicle), ...Object.keys(forecastByVehicle)];
    for (const vid of extraIds) {
      if (!seen.has(vid)) {
        const v = vehicles.find((x) => x.id === vid);
        if (v) { rows.push(v); seen.add(v.id); }
      }
    }
    return rows;
  }, [filteredVehicles, tripsByVehicle, forecastByVehicle, vehicles]);

  // rowItems: filas intercaladas con encabezados de sección (inter-sucursal / última milla).
  // El "stripe" es el índice solo entre vehículos (para el zebra striping).
  type RowItem =
    | { type: "header"; key: string; label: string }
    | { type: "vehicle"; key: string; v: Vehicle; stripe: number };
  const rowItems = useMemo<RowItem[]>(() => {
    const inter = vehicleRows.filter((v) => v.mode === "inter_sucursal");
    const last = vehicleRows.filter((v) => v.mode === "ultima_milla");
    const items: RowItem[] = [];
    let stripe = 0;
    if (inter.length > 0) {
      items.push({ type: "header", key: "h-inter", label: "Inter-sucursal" });
      for (const v of inter) items.push({ type: "vehicle", key: v.id, v, stripe: stripe++ });
    }
    if (last.length > 0) {
      items.push({ type: "header", key: "h-last", label: "Última milla" });
      for (const v of last) items.push({ type: "vehicle", key: v.id, v, stripe: stripe++ });
    }
    return items;
  }, [vehicleRows]);

  const hours = Array.from({ length: 25 }, (_, i) => i);
  const gridWidth = hours.length * HOUR_W; // 25 * 56 = 1400 px

  const prevDay = () => setDay((d) => addDays(d, -1));
  const nextDay = () => setDay((d) => addDays(d, 1));
  const goToday = () => setDay(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));

  const dayLabel = `${day.getDate()} ${MONTHS_SHORT[day.getMonth()]} ${day.getFullYear()}`;

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll a la hora actual (o primera actividad) al cambiar de día.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetHour = today ? Math.max(0, new Date().getHours() - 1) : 6;
    el.scrollLeft = targetHour * HOUR_W;
  }, [day.getTime(), today]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, fontFamily: "inherit" }}>
      {/* Navegación de día */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 12px" }}>
        <Button variant="ghost" size="icon" onClick={prevDay}><ChevronLeft size={16} /></Button>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text-heading)", minWidth: 140, textAlign: "center" }}>
          {dayLabel}
          {today && (
            <span style={{ marginLeft: 8, fontSize: 11, background: "rgba(16,185,129,0.18)", color: "var(--ok)", padding: "1px 8px", borderRadius: 999, fontWeight: 700 }}>
              Hoy
            </span>
          )}
        </span>
        <Button variant="ghost" size="icon" onClick={nextDay}><ChevronRight size={16} /></Button>
        <Button variant="outline" size="sm" onClick={goToday}>Hoy</Button>
        {loading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Cargando…</span>}
      </div>

      {/* Contenedor scrolleable */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header: espacio label + eje horario (sticky vertical) */}
        <div
          style={{
            display: "flex",
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "var(--bg-card)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {/* Esquina */}
          <div style={{ width: LABEL_W, flexShrink: 0, borderRight: "1px solid var(--border)", padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
            Vehículo
          </div>
          {/* Eje de horas scrolleable */}
          <div ref={scrollRef} style={{ flex: 1, overflowX: "auto" }}>
            <div style={{ width: gridWidth, display: "flex", height: 36, position: "relative" }}>
              {hours.map((h) => (
                <div key={h} style={{ width: HOUR_W, flexShrink: 0, borderLeft: h > 0 ? "1px solid var(--border)" : undefined, opacity: 0.6, display: "flex", alignItems: "center", justifyContent: "flex-start", paddingLeft: 4, fontSize: 10.5, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {h < 24 ? `${String(h).padStart(2,"0")}:00` : ""}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Filas de vehículos */}
        <div style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto", display: "flex" }}>
          {/* Panel izquierdo fijo (labels) */}
          <div style={{ width: LABEL_W, flexShrink: 0, borderRight: "1px solid var(--border)" }}>
            {rowItems.length === 0 && (
              <div style={{ padding: "24px 12px", color: "var(--text-muted)", fontSize: 12 }}>
                Sin vehículos para esta sucursal.
              </div>
            )}
            {rowItems.map((item) => item.type === "header" ? (
              <div
                key={item.key}
                style={{
                  height: SECTION_H,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 10px",
                  background: "var(--bg-subtle)",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {item.label}
              </div>
            ) : (
              <div
                key={item.key}
                style={{
                  height: ROW_H,
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  padding: "0 10px",
                  gap: 2,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 12.5, color: "var(--text-primary)" }}>{item.v.license_plate}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: vehicleStatusColor(item.v.status), flexShrink: 0 }} />
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{vehicleStatusLabel(item.v.status)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Panel derecho scrolleable (grilla de bloques) */}
          <div style={{ flex: 1, overflowX: "auto" }}>
            <div style={{ width: gridWidth, position: "relative" }}>
              {rowItems.map((item) => {
                if (item.type === "header") {
                  return (
                    <div
                      key={item.key}
                      style={{
                        height: SECTION_H,
                        borderBottom: "1px solid var(--border)",
                        background: "var(--bg-subtle)",
                        position: "relative",
                      }}
                    />
                  );
                }
                const v = item.v;
                const vTrips = tripsByVehicle[v.id] ?? [];
                return (
                  <div
                    key={item.key}
                    style={{
                      height: ROW_H,
                      borderBottom: "1px solid var(--border)",
                      position: "relative",
                      background: item.stripe % 2 === 1 ? "rgba(0,0,0,0.015)" : "transparent",
                    }}
                  >
                    {/* Líneas de hora */}
                    {hours.map((h) => (
                      <div key={h} style={{ position: "absolute", left: h * HOUR_W, top: 0, bottom: 0, borderLeft: h > 0 ? "1px solid var(--border)" : undefined, opacity: 0.35 }} />
                    ))}

                    {/* Línea "ahora" */}
                    {today && (
                      <div style={{ position: "absolute", left: (nowMin / 1440) * gridWidth, top: 0, bottom: 0, borderLeft: "2px solid var(--danger-c,#ef4444)", zIndex: 4, pointerEvents: "none" }} />
                    )}

                    {/* Bloques de viaje */}
                    {vTrips.map(({ trip: t, isContinuation }) => {
                      const depSrc = t.scheduled_departure_at ?? t.created_at;
                      const depMin = minsFromMidnight(depSrc);
                      const durMin = tripDurationMin(t);
                      const color = KIND_COLOR[t.kind] ?? KIND_COLOR.inter_branch;
                      const tint = KIND_TINT[t.kind] ?? KIND_TINT.inter_branch;
                      const label = routeLabel(t, branches);
                      const isSelected = selectedTripId === t.id;
                      const driver = t.driver_id ? driverMap[t.driver_id] : null;
                      const driverName = driver ? (driver.full_name || driver.username) : null;

                      if (isContinuation) {
                        // Bloque de continuación: viene de ayer, termina a cierta hora hoy.
                        const arrMin = t.estimated_arrival_at ? minsFromMidnight(t.estimated_arrival_at) : 60;
                        return (
                          <div
                            key={`${t.id}-cont`}
                            className="cal-event"
                            onClick={(e) => onTripClick(t, e)}
                            title={`↓ continuación · ${t.license_plate} · ${label}`}
                            style={{
                              position: "absolute",
                              left: 0,
                              width: pctWidth(0, arrMin),
                              top: 5,
                              height: ROW_H - 10,
                              background: tint,
                              border: `1px solid ${color}`,
                              borderLeft: `3px dashed ${color}`,
                              borderRadius: "0 5px 5px 0",
                              padding: "2px 6px",
                              overflow: "hidden",
                              cursor: "pointer",
                              zIndex: isSelected ? 5 : 2,
                              outline: isSelected ? `2px solid ${color}` : undefined,
                              outlineOffset: isSelected ? 1 : undefined,
                            }}
                          >
                            <div style={{ fontSize: 10, fontWeight: 700, color, lineHeight: 1.25, fontVariantNumeric: "tabular-nums" }}>
                              ↓ hasta {fmtMinutesAsTime(arrMin)}
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {label}
                            </div>
                          </div>
                        );
                      }

                      // Bloque normal: sale hoy.
                      const spansNextDay = depMin + durMin > 1440;
                      const blockWidth = pctWidth(depMin, Math.min(durMin, 1440 - depMin));
                      return (
                        <div
                          key={t.id}
                          className="cal-event"
                          onClick={(e) => onTripClick(t, e)}
                          title={`${t.license_plate} · ${label}`}
                          style={{
                            position: "absolute",
                            left: pct(depMin),
                            width: blockWidth,
                            top: 5,
                            height: ROW_H - 10,
                            background: tint,
                            border: `1px solid ${color}`,
                            borderLeft: `3px solid ${color}`,
                            borderRadius: spansNextDay ? "5px 0 0 5px" : 5,
                            padding: "2px 6px",
                            overflow: "hidden",
                            cursor: "pointer",
                            zIndex: isSelected ? 5 : 2,
                            outline: isSelected ? `2px solid ${color}` : undefined,
                            outlineOffset: isSelected ? 1 : undefined,
                          }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 700, color, lineHeight: 1.25, fontVariantNumeric: "tabular-nums" }}>
                            {fmtMinutesAsTime(depMin)}–{spansNextDay ? "+1d →" : fmtMinutesAsTime(depMin + durMin)}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {label}
                          </div>
                          {ROW_H > 50 && driverName && (
                            <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {driverName}
                            </div>
                          )}
                          {ROW_H > 50 && (
                            <span style={{ fontSize: 9, color, fontWeight: 600 }}>{TRIP_STATUS_LABEL[t.status] ?? t.status}</span>
                          )}
                        </div>
                      );
                    })}

                    {/* Bloques de pronóstico (D+1, D+2) — rayado semitransparente */}
                    {(forecastByVehicle[v.id] ?? []).map((ev) => {
                      const depMin = ev.departureMin;
                      const durMin = Math.max(30, ev.arrivalMin - ev.departureMin);
                      const color = ev.kind === "last_mile" ? "var(--ok)" : "var(--brand-800)";
                      return (
                        <div
                          key={ev.key}
                          title={`Pronóstico · ${ev.licensePlate} · ${ev.routeLabel}`}
                          style={{
                            position: "absolute",
                            left: pct(depMin),
                            width: pctWidth(depMin, Math.min(durMin, 1440 - depMin)),
                            top: 5,
                            height: ROW_H - 10,
                            background: ev.kind === "last_mile"
                              ? "rgba(16,185,129,0.15)"
                              : "rgba(37,99,235,0.12)",
                            border: `1.5px dashed ${color}`,
                            borderRadius: 5,
                            padding: "2px 6px",
                            overflow: "hidden",
                            backgroundImage: "repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(255,255,255,0.18) 4px,rgba(255,255,255,0.18) 8px)",
                            zIndex: 1,
                            cursor: "default",
                          }}
                        >
                          <div style={{ fontSize: 10, fontWeight: 700, color, lineHeight: 1.25, fontStyle: "italic", fontVariantNumeric: "tabular-nums" }}>
                            {fmtMinutesAsTime(depMin)} · pronóstico
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {ev.routeLabel}
                          </div>
                        </div>
                      );
                    })}

                    {/* Vehículo libre: indicador sutil si no tiene viajes ni pronósticos en el día */}
                    {vTrips.filter((x) => !x.isContinuation).length === 0 && vTrips.length === 0 &&
                     (forecastByVehicle[v.id] ?? []).length === 0 && v.status === "disponible" && (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 12, color: "var(--text-muted)", fontSize: 11, opacity: 0.55, pointerEvents: "none" }}>
                        Libre
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Línea "ahora" vertical (encima de todas las filas) */}
              {today && rowItems.length > 0 && (
                <div style={{ position: "absolute", left: (nowMin / 1440) * gridWidth, top: 0, bottom: 0, borderLeft: "2px solid var(--danger-c,#ef4444)", zIndex: 6, pointerEvents: "none" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--danger-c,#ef4444)", position: "absolute", top: -4, left: -4 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Leyenda de estado */}
      <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
        {(["disponible","en_carga","en_transito","mantenimiento"] as const).map((s) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: vehicleStatusColor(s) }} />
            {vehicleStatusLabel(s)}
          </span>
        ))}
      </div>
    </div>
  );
}
