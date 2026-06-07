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
import VehicleTimelineView from "../components/calendar/VehicleTimelineView";

// ── tipos compartidos ─────────────────────────────────────────────────────────
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
    <div className="p-6 max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Calendar size={22} className="text-[#1e3a5f]" />
          <h1 className="m-0 text-xl font-bold text-slate-900">Calendario de viajes</h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* Filtro por tipo */}
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900 text-sm cursor-pointer"
          >
            <option value="all">Todos los tipos</option>
            <option value="inter_branch">Inter-sucursal</option>
            <option value="last_mile">Última milla</option>
          </select>

          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 cursor-pointer flex items-center gap-1.5 text-slate-900 text-sm"
          >
            <RefreshCw size={14} />
            Actualizar
          </button>
        </div>
      </div>

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
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "fixed", top, left, width: W }}
        className="bg-white border border-slate-200 rounded-xl p-4 shadow-xl z-41 max-h-[calc(100vh-16px)] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-bold text-base text-slate-900">{trip.license_plate}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
              isLastMile
                ? "bg-emerald-100 text-emerald-600"
                : "bg-blue-100 text-blue-600"
            }`}>
              {isLastMile ? "Última milla" : "Inter-sucursal"}
            </span>
            <span className="text-xs text-slate-400">{status}</span>
          </div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-5 flex-wrap mb-3">
          <Field icon={<Clock size={13} />} label="Salida planificada" value={hhmm(trip.scheduled_departure_at)} />
          <Field icon={<Clock size={13} />} label="Llegada estimada" value={hhmm(trip.estimated_arrival_at)} />
          {trip.started_at && <Field icon={<Clock size={13} />} label="Inició (real)" value={hhmm(trip.started_at)} />}
          {trip.completed_at && <Field icon={<Clock size={13} />} label="Finalizó (real)" value={hhmm(trip.completed_at)} />}
          <Field icon={<Package size={13} />} label="Envíos" value={`${trip.shipment_ids.length} · ${trip.total_weight_kg} kg`} />
          {driverName && <Field icon={<Truck size={13} />} label="Chofer" value={driverName} />}
        </div>

        {/* Itinerario con ETAs */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <MapPin size={13} className="text-slate-400" />
            <strong>{branchLabelById(trip.origin_branch_id, branches)}</strong>
            <span className="text-slate-400">· salida {hhmm(trip.scheduled_departure_at)}</span>
          </div>
          {(trip.stops ?? []).map((st, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600 pl-2">
              <span className="text-slate-200">↓</span>
              <MapPin size={13} className="text-slate-400" />
              <strong>{branchLabelById(st.branch_id, branches)}</strong>
              {st.estimated_arrival_at && <span className="text-slate-400">· llega {hhmm(st.estimated_arrival_at)}</span>}
              <span className="text-slate-400">· {st.shipment_ids.length} entrega{st.shipment_ids.length !== 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>

        <div className="mt-2.5 text-[11px] text-slate-400">ID: {trip.id}</div>
      </div>
    </>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] text-slate-400 uppercase tracking-wide flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}
