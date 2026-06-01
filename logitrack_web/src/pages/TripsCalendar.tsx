import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Truck,
  RefreshCw,
  Package,
  MapPin,
  Clock,
  X,
} from "lucide-react";
import type { InterBranchTrip } from "../api/interBranchTrips";
import { branchApi, branchLabelById, type Branch } from "../api/branches";
import { usersApi, type UserProfile } from "../api/users";
import { routingApi, type GlobalRoutingPlan } from "../api/routing";
import { useAuth } from "../context/AuthContext";
import { fmtDateTime } from "../utils/date";
import WeekCalendarView from "../components/calendar/WeekCalendarView";
import VehicleTimelineView from "../components/calendar/VehicleTimelineView";

// ── tipos compartidos ─────────────────────────────────────────────────────────
type ViewMode = "semana" | "timeline";
type KindFilter = "all" | "inter_branch" | "last_mile";

const STATUS_STYLE: Record<string, { label: string }> = {
  pendiente:   { label: "Pendiente" },
  en_transito: { label: "En tránsito" },
  completado:  { label: "Completado" },
  cancelado:   { label: "Cancelado" },
};

function hhmm(iso?: string) {
  if (!iso) return "—";
  return fmtDateTime(iso).split(" ")[1] ?? "—";
}

// ── componente principal ──────────────────────────────────────────────────────
export default function TripsCalendar() {
  const { user, hasRole } = useAuth();
  const [view, setView] = useState<ViewMode>("timeline");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [selectedTrip, setSelectedTrip] = useState<InterBranchTrip | null>(null);
  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [driverMap, setDriverMap] = useState<Record<string, UserProfile>>({});
  const [horizonPlans, setHorizonPlans] = useState<GlobalRoutingPlan[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const branchId = useMemo(
    () => (hasRole("manager") ? undefined : user?.branch_id ?? undefined),
    [user, hasRole],
  );

  // Carga datos compartidos (branches + drivers + horizonte de planes) una vez.
  useEffect(() => {
    Promise.all([branchApi.list(), usersApi.listDrivers()]).then(([br, dr]) => {
      setBranches(br);
      const map: Record<string, UserProfile> = {};
      dr.forEach((d) => { map[d.id] = d; });
      setDriverMap(map);
    });
    routingApi.getHorizonPlans().then(setHorizonPlans).catch(() => {});
  }, []);

  // Cerrar popover con Escape.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closeTrip(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const openTrip = (trip: InterBranchTrip, e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    setPopoverRect(el.getBoundingClientRect());
    setSelectedTrip(trip);
  };

  const closeTrip = () => { setSelectedTrip(null); setPopoverRect(null); };

  return (
    <div style={{ padding: "20px 24px", maxWidth: 1500, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Calendar size={22} style={{ color: "var(--brand-800)" }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-heading)" }}>Calendario de viajes</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Switch de vista */}
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {(["timeline", "semana"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: "6px 14px",
                  background: view === v ? "var(--brand-800)" : "var(--bg-card)",
                  color: view === v ? "#fff" : "var(--text-primary)",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: view === v ? 700 : 400,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {v === "timeline" ? <><Truck size={14} /> Por vehículo</> : <><Calendar size={14} /> Semana</>}
              </button>
            ))}
          </div>

          {/* Filtro por tipo */}
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", color: "var(--text-primary)", fontSize: 13, cursor: "pointer" }}
          >
            <option value="all">Todos los tipos</option>
            <option value="inter_branch">Inter-sucursal</option>
            <option value="last_mile">Última milla</option>
          </select>

          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "var(--text-primary)", fontSize: 13 }}
          >
            <RefreshCw size={14} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Vista activa */}
      {view === "semana" ? (
        <WeekCalendarView
          key={refreshKey}
          branches={branches}
          driverMap={driverMap}
          branchId={branchId}
          kindFilter={kindFilter}
          onTripClick={openTrip}
          selectedTripId={selectedTrip?.id ?? null}
          horizonPlans={horizonPlans}
        />
      ) : (
        <VehicleTimelineView
          key={refreshKey}
          branches={branches}
          driverMap={driverMap}
          branchId={branchId}
          kindFilter={kindFilter}
          onTripClick={openTrip}
          selectedTripId={selectedTrip?.id ?? null}
          horizonPlans={horizonPlans}
        />
      )}

      {/* Popover de detalle */}
      {selectedTrip && popoverRect && (
        <TripPopover
          trip={selectedTrip}
          anchor={popoverRect}
          branches={branches}
          driverMap={driverMap}
          onClose={closeTrip}
        />
      )}
    </div>
  );
}

// ── TripPopover ───────────────────────────────────────────────────────────────
function TripPopover({
  trip,
  anchor,
  branches,
  driverMap,
  onClose,
}: {
  trip: InterBranchTrip;
  anchor: DOMRect;
  branches: Branch[];
  driverMap: Record<string, UserProfile>;
  onClose: () => void;
}) {
  const driver = trip.driver_id ? driverMap[trip.driver_id] : null;
  const driverName = driver ? (driver.full_name || driver.username) : null;
  const isLastMile = trip.kind === "last_mile";
  const kindColor = isLastMile ? "var(--ok)" : "var(--brand-800)";
  const status = STATUS_STYLE[trip.status]?.label ?? trip.status;

  const W = 340;
  const margin = 10;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + margin;
  if (left + W > vw - 8) left = anchor.left - W - margin;
  if (left < 8) left = Math.max(8, (vw - W) / 2);
  let top = anchor.top;
  const estH = 340;
  if (top + estH > vh - 8) top = Math.max(8, vh - estH - 8);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={onClose} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top,
          left,
          width: W,
          maxHeight: "calc(100vh - 16px)",
          overflowY: "auto",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderLeft: `4px solid ${kindColor}`,
          borderRadius: 12,
          padding: "16px 18px",
          boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
          zIndex: 41,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>{trip.license_plate}</span>
            <span style={{ background: isLastMile ? "rgba(16,185,129,0.15)" : "rgba(37,99,235,0.15)", color: kindColor, fontSize: 11, padding: "2px 9px", borderRadius: 999, fontWeight: 600 }}>
              {isLastMile ? "Última milla" : "Inter-sucursal"}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{status}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
          <Field icon={<Clock size={13} />} label="Salida planificada" value={hhmm(trip.scheduled_departure_at)} />
          <Field icon={<Clock size={13} />} label="Llegada estimada" value={hhmm(trip.estimated_arrival_at)} />
          {trip.started_at && <Field icon={<Clock size={13} />} label="Inició (real)" value={hhmm(trip.started_at)} />}
          {trip.completed_at && <Field icon={<Clock size={13} />} label="Finalizó (real)" value={hhmm(trip.completed_at)} />}
          <Field icon={<Package size={13} />} label="Envíos" value={`${trip.shipment_ids.length} · ${trip.total_weight_kg} kg`} />
          {driverName && <Field icon={<Truck size={13} />} label="Chofer" value={driverName} />}
        </div>

        {/* Itinerario con ETAs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
            <MapPin size={13} style={{ color: "var(--text-muted)" }} />
            <strong>{branchLabelById(trip.origin_branch_id, branches)}</strong>
            <span style={{ color: "var(--text-muted)" }}>· salida {hhmm(trip.scheduled_departure_at)}</span>
          </div>
          {(trip.stops ?? []).map((st, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", paddingLeft: 8 }}>
              <span style={{ color: "var(--border)" }}>↓</span>
              <MapPin size={13} style={{ color: "var(--text-muted)" }} />
              <strong>{branchLabelById(st.branch_id, branches)}</strong>
              {st.estimated_arrival_at && <span style={{ color: "var(--text-muted)" }}>· llega {hhmm(st.estimated_arrival_at)}</span>}
              <span style={{ color: "var(--text-muted)" }}>· {st.shipment_ids.length} entrega{st.shipment_ids.length !== 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>ID: {trip.id}</div>
      </div>
    </>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", gap: 4 }}>
        {icon}
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}
