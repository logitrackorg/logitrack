import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, X, Download, AlertTriangle, MapPin, FileText, Clock, ChevronDown, LayoutList, Truck, PackageOpen } from "lucide-react";
import { shipmentApi, type Shipment, type ShipmentStatus } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { usersApi, type UserProfile } from "../api/users";
import { interBranchTripsApi, type InterBranchTrip } from "../api/interBranchTrips";
import { fmtDate } from "../utils/date";
import { filterActiveTrips, groupShipmentsByTrip } from "../utils/groupShipmentsByTrip";
import { useAuth } from "../context/AuthContext";
import { Card } from "../components/ui/card";
import { SelectMenu } from "../components/ui/SelectMenu";
import { TopbarActions } from "../components/topbarContext";
import { ShipmentKPIStrip } from "../components/ShipmentKPIStrip";
import { Button } from "../components/ui/button";
import { Skeleton, SkeletonLine } from "../components/ui/skeleton";
import { ShipmentRow, ShipmentTableHeader, ShipmentTripGroups } from "../components/ShipmentTripGroups";

// Returns the corrected value if one exists, otherwise the original.
function corr(s: Shipment, key: string, fallback: string | number): string {
  const v = s.corrections?.[key];
  return v !== undefined ? v : String(fallback);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportToCSV(shipments: Shipment[], branches: Branch[]) {
  const branchName = (id?: string) => {
    if (!id) return "";
    const b = branches.find((b) => b.id === id);
    return b ? `${b.name} — ${b.address.city}` : id;
  };

  const headers = [
    "ID de seguimiento", "Estado", "Prioridad",
    "Ciudad de origen", "Provincia de origen", "Ciudad de destino", "Provincia de destino",
    "Sucursal receptora", "Tipo de envío", "Peso (kg)", "Ubicación actual",
    "Creado", "Entrega estimada",
  ];

  const rows = shipments.map((s) => [
    s.status === "draft" ? "" : s.tracking_id,
    s.status,
    s.priority ?? "",
    corr(s, "origin_city", s.sender.address.city),
    s.sender.address.province,
    corr(s, "destination_city", s.recipient.address.city),
    s.recipient.address.province,
    branchName(s.receiving_branch_id),
    s.shipment_type ?? "",
    corr(s, "weight_kg", s.weight_kg),
    s.current_location ?? "",
    fmtDate(s.created_at),
    s.estimated_delivery_at ? fmtDate(s.estimated_delivery_at) : "",
  ].map(csvEscape).join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shipments_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type StatusFilter = ShipmentStatus | "active" | "expired" | "sla_risk" | "sla_compromised" | "";

const BULK_ELIGIBLE_STATUSES: ShipmentStatus[] = ["at_hub", "delivery_failed"];

type BulkAction = "ready_for_pickup" | "out_for_delivery";

interface BulkConfirmState {
  action: BulkAction;
  count: number;
}

interface BulkResult {
  updated: number;
  skipped: { tracking_id: string; reason: string }[];
}

const inputClass =
  "h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all";

type ViewMode = "flat" | "trip";

function isLikelyDelayed(s: Shipment): boolean {
  if (!s.estimated_delivery_at) return false;
  const now = new Date();
  const est = new Date(s.estimated_delivery_at);
  return est < now && !["delivered", "returned", "cancelled", "lost", "destroyed"].includes(s.status);
}

function isLikelyAtRisk(s: Shipment): boolean {
  if (!s.estimated_delivery_at) return false;
  const now = new Date();
  const est = new Date(s.estimated_delivery_at);
  const hoursLeft = (est.getTime() - now.getTime()) / 36e5;
  return hoursLeft >= 0 && hoursLeft <= 24 && !["delivered", "returned", "cancelled", "lost", "destroyed"].includes(s.status);
}

export function ShipmentList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [trips, setTrips] = useState<InterBranchTrip[]>([]);
  const [driverMap, setDriverMap] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<ViewMode>(
    searchParams.get("view") === "trip" ? "trip" : "flat",
  );
  const [expandedTripIds, setExpandedTripIds] = useState<Set<string>>(() => {
    const id = searchParams.get("trip_id");
    return id ? new Set([id]) : new Set();
  });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get("status") as StatusFilter) ??
    (sessionStorage.getItem("shipment_status_filter") as StatusFilter) ??
    "active"
  );

  useEffect(() => {
    sessionStorage.setItem("shipment_status_filter", statusFilter);
  }, [statusFilter]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { hasRole, user } = useAuth();
  const isOperator = user?.role === "operator";
  const hasBranchDefault = isOperator || user?.role === "supervisor";
  const [branchFilter, setBranchFilter] = useState(hasBranchDefault ? (user?.branch_id ?? "") : "");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const canBulk = hasRole("operator", "supervisor");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirmState | null>(null);
  const [bulkDriverId, setBulkDriverId] = useState("");
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const dateRangeInvalid = !!(dateFrom && dateTo && dateTo < dateFrom);

  // Track whether the last server fetch included expired drafts, to detect
  // when a statusFilter change requires a new server request.
  const loadedWithExpiredRef = useRef(statusFilter === "expired");

  const tripBranchParam =
    user?.role === "manager" && branchFilter ? branchFilter : undefined;

  const load = async (withExpired: boolean) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = withExpired ? { include_expired: "true" } : undefined;
      const [data, tripsData, drivers] = await Promise.all([
        shipmentApi.list(params),
        interBranchTripsApi.listByBranch(tripBranchParam).catch(() => [] as InterBranchTrip[]),
        usersApi.listDrivers().catch(() => [] as UserProfile[]),
      ]);
      setShipments(data ?? []);
      setTrips(filterActiveTrips(tripsData ?? []));
      const dMap: Record<string, string> = {};
      drivers.forEach((d) => {
        dMap[d.id] = d.full_name || d.username;
      });
      setDriverMap(dMap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const withExpired = statusFilter === "expired";
    loadedWithExpiredRef.current = withExpired;
    load(withExpired);
    branchApi.listActive().then(setBranches).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.role !== "manager") return;
    load(loadedWithExpiredRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  // Reload from server when toggling to/from the expired-drafts view, since
  // expired items are excluded by default and need a separate server param.
  useEffect(() => {
    const wantExpired = statusFilter === "expired";
    if (wantExpired !== loadedWithExpiredRef.current) {
      loadedWithExpiredRef.current = wantExpired;
      load(wantExpired);
    }
  }, [statusFilter]);

  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const filtered = shipments.filter((s) => {
    // Expired drafts are never shown outside the explicit "expired" filter,
    // even if the server returned them (e.g. during a filter transition).
    if (statusFilter !== "expired" && s.status === "expired") return false;
    if (statusFilter === "active" && (s.status === "delivered" || s.status === "draft" || s.status === "returned" || s.status === "cancelled" || s.status === "lost" || s.status === "destroyed")) return false;
    if (statusFilter === "sla_risk") {
      if (!(s.is_delayed ?? isLikelyDelayed(s))) return false;
    } else if (statusFilter === "sla_compromised") {
      if (!(s.is_at_risk ?? isLikelyAtRisk(s))) return false;
    } else if (statusFilter === "at_hub") {
      if (s.status !== "at_hub" && s.status !== "at_origin_hub") return false;
    } else if (statusFilter !== "active" && statusFilter !== "" && s.status !== statusFilter) return false;
    if (branchFilter && s.receiving_branch_id !== branchFilter && !(s.status === "in_transit" && s.current_location === branchFilter)) return false;
    if (!dateRangeInvalid) {
      const created = localDate(s.created_at);
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > dateTo) return false;
    }
    const q = query.trim().toLowerCase();
    if (q.length >= 3) {
      const cor = s.corrections ?? {};
      const senderName = (cor.sender_name ?? s.sender?.name ?? "").toLowerCase();
      const recipientName = (cor.recipient_name ?? s.recipient?.name ?? "").toLowerCase();
      const senderCity = (cor.sender_city ?? s.sender?.address?.city ?? "").toLowerCase();
      const recipientCity = (cor.recipient_city ?? s.recipient?.address?.city ?? "").toLowerCase();
      if (
        !s.tracking_id.toLowerCase().includes(q) &&
        !senderName.includes(q) &&
        !recipientName.includes(q) &&
        !senderCity.includes(q) &&
        !recipientCity.includes(q)
      ) return false;
    }
    return true;
  });
  filtered.sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));

  const eligibleInView = filtered.filter((s) => BULK_ELIGIBLE_STATUSES.includes(s.status as ShipmentStatus));
  const allEligibleSelected = eligibleInView.length > 0 && eligibleInView.every((s) => selected.has(s.tracking_id));

  const { groups, ungrouped } = useMemo(
    () => groupShipmentsByTrip(filtered, trips),
    [filtered, trips],
  );

  const setViewModeAndParams = (mode: ViewMode) => {
    setViewMode(mode);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (mode === "trip") next.set("view", "trip");
      else next.delete("view");
      return next;
    }, { replace: true });
  };

  const toggleTripExpanded = (tripId: string) => {
    setExpandedTripIds((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", "trip");
      next.set("trip_id", tripId);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    const tripId = searchParams.get("trip_id");
    if (searchParams.get("view") === "trip" && tripId) {
      setViewMode("trip");
      setExpandedTripIds((prev) => new Set([...prev, tripId]));
    }
  }, [searchParams]);

  const toggleSelect = (trackingId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackingId)) next.delete(trackingId);
      else next.add(trackingId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allEligibleSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligibleInView.map((s) => s.tracking_id)));
    }
  };

  const openBulkAction = (action: BulkAction) => {
    if (selected.size === 0) return;
    if (action === "out_for_delivery") {
      usersApi.listDrivers(user?.branch_id).then(setDrivers).catch(() => {});
      setBulkDriverId("");
    }
    setBulkConfirm({ action, count: selected.size });
  };

  const executeBulk = async () => {
    if (!bulkConfirm) return;
    if (bulkConfirm.action === "out_for_delivery" && !bulkDriverId) return;
    setBulkLoading(true);
    try {
      const result = await shipmentApi.bulkUpdateStatus({
        tracking_ids: Array.from(selected),
        status: bulkConfirm.action,
        driver_id: bulkConfirm.action === "out_for_delivery" ? bulkDriverId : undefined,
      });
      setBulkResult(result);
      setBulkConfirm(null);
      setSelected(new Set());
      await load(loadedWithExpiredRef.current);
    } finally {
      setBulkLoading(false);
    }
  };

  const actionLabel = (action: BulkAction) =>
    action === "ready_for_pickup" ? "Listo para retiro" : "Última milla (asignar a chofer)";

  const draftCount = shipments.filter((s) => s.status === "draft").length;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {hasRole("operator", "supervisor") && (
        <TopbarActions>
          <button
            onClick={() => navigate("/drafts")}
            className="relative inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-sm font-semibold transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            Borradores
            {draftCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                {draftCount > 99 ? "99+" : draftCount}
              </span>
            )}
          </button>
          <Button
            variant="default"
            size="lg"
            onClick={() => navigate("/new")}
          >
            <Plus className="w-4 h-4" />
            Nuevo envío
          </Button>
        </TopbarActions>
      )}

      {/* KPI strip — computed from raw shipment list, siempre refleja el total sin filtros de estado */}
      <ShipmentKPIStrip
        shipments={shipments}
        activeFilter={statusFilter}
        onFilter={(v) => setStatusFilter(v)}
      />

      {/* Status chips + search/date/branch */}
      <Card className="mb-4 p-4">
        {/* Chips de estado */}
        <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-slate-100 dark:border-slate-700">
          {(
            [
              { label: "Activos",           value: "active" },
              { label: "En tránsito",       value: "in_transit" },
              { label: "Última milla",      value: "out_for_delivery" },
              { label: "En sucursal",       value: "at_hub" },
              { label: "Entrega fallida",   value: "delivery_failed" },
              { label: "Listo p/ retiro",   value: "ready_for_pickup" },
              { label: "Todos",             value: "" },
            ] as { label: string; value: StatusFilter }[]
          ).map(({ label, value }) => {
            const isActive = statusFilter === value;
            return (
              <button
                key={value || "__all__"}
                onClick={() => setStatusFilter(value)}
                className={`inline-flex items-center h-8 px-3 rounded-full text-xs font-semibold border transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-blue-900 text-white border-blue-900 shadow-sm"
                    : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                {label}
              </button>
            );
          })}
          {/* Más estados — select compacto para opciones poco frecuentes */}
          <div className="relative">
            <select
              value={[
                "active", "in_transit", "out_for_delivery", "at_hub",
                "delivery_failed", "ready_for_pickup", "",
              ].includes(statusFilter) ? "" : statusFilter}
              onChange={(e) => { if (e.target.value) setStatusFilter(e.target.value as StatusFilter); }}
              className="h-8 pl-3 pr-8 rounded-full text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 cursor-pointer appearance-none hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-w-[110px]"
            >
              <option value="">Más estados…</option>
              <option value="at_origin_hub">En sucursal origen</option>
              <option value="loaded">Cargado en vehículo</option>
              <option value="redelivery_scheduled">Reentrega programada</option>
              <option value="no_entregado">No entregado</option>
              <option value="rechazado">Rechazado</option>
              <option value="ready_for_return">Listo para devolución</option>
              <option value="delivered">Entregados</option>
              <option value="returned">Devueltos</option>
              <option value="cancelled">Cancelados</option>
              <option value="lost">Extraviados</option>
              <option value="destroyed">Daño total</option>
              <option value="pending_payment">Pago pendiente</option>
              <option value="draft">Borrador</option>
              {hasRole("supervisor", "manager") && (
                <option value="expired">Borradores expirados</option>
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          </div>
        </div>

        {/* Search + fecha + sucursal */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por ID, remitente, destinatario o ciudad…"
               className={`${inputClass} w-full pl-9 ${query ? "pr-10" : "pr-3"}`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="Desde"
              className={inputClass}
            />
            <span className="text-slate-300 dark:text-slate-600">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className={`${inputClass} ${dateRangeInvalid ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200" : ""}`}
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-xs text-slate-500 hover:text-slate-700 underline cursor-pointer"
              >
                Limpiar
              </button>
            )}
          </div>

          {isOperator ? (
            <span className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm font-semibold text-blue-900 dark:text-blue-300">
              <MapPin className="w-3.5 h-3.5" />
              {branches.find(b => b.id === branchFilter)?.name ?? branchFilter}
            </span>
          ) : (
            <SelectMenu
              value={branchFilter}
              onChange={setBranchFilter}
              placeholder="Todas las sucursales"
              ariaLabel="Filtrar por sucursal"
              className="w-[230px]"
              groups={Object.entries(
                branches.reduce((acc, b) => {
                  if (!acc[b.province]) acc[b.province] = [];
                  acc[b.province].push(b);
                  return acc;
                }, {} as Record<string, Branch[]>)
              )
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([province, pBranches]) => ({
                  label: province,
                  options: [...pBranches]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((b) => ({ value: b.id, label: `${b.name} — ${b.address.city}` })),
                }))}
            />
          )}
        </div>

        {dateRangeInvalid && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            La fecha "Hasta" debe ser posterior a "Desde"
          </p>
        )}
      </Card>

      {/* Expired-drafts notice */}
      {statusFilter === "expired" && (
        <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300">
          <Clock className="w-4 h-4 shrink-0 mt-0.5 text-slate-500 dark:text-slate-400" />
          <span>
            Mostrando borradores expirados. Visibles solo para supervisores y gerentes hasta que se eliminen los datos personales (según <strong>Configuración del sistema</strong>).
          </span>
        </div>
      )}

      {/* Bulk action toolbar */}
      {canBulk && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 bg-blue-600 text-white rounded-lg">
          <span className="text-sm font-semibold">
            {selected.size} {selected.size === 1 ? "envío seleccionado" : "envíos seleccionados"}
          </span>
          <button
            onClick={() => openBulkAction("ready_for_pickup")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Marcar como "Listo para retiro"
          </button>
          <button
            onClick={() => openBulkAction("out_for_delivery")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Asignar a última milla
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-white/80 hover:text-white underline cursor-pointer"
          >
            Cancelar selección
          </button>
        </div>
      )}

      {loading ? (
        /* Skeleton table */
        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-3 w-28" />
                <SkeletonLine className="flex-1" />
                <SkeletonLine className="flex-1" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-14 px-6 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
            <PackageOpen className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">No se encontraron envíos</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">
            {query || statusFilter !== "active" || dateFrom || dateTo || branchFilter
              ? "Probá ajustando los filtros aplicados."
              : "Todavía no hay envíos registrados."}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {(query || statusFilter !== "active" || dateFrom || dateTo) && (
              <Button
                variant="outline"
                size="default"
                onClick={() => { setQuery(""); setStatusFilter("active"); setDateFrom(""); setDateTo(""); }}
              >
                <X className="w-3.5 h-3.5" />
                Limpiar filtros
              </Button>
            )}
            {hasRole("operator", "supervisor") && (
              <Button
                variant="default"
                size="default"
                onClick={() => navigate("/new")}
              >
                <Plus className="w-3.5 h-3.5" />
                Crear envío
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {filtered.length} {filtered.length !== 1 ? "envíos" : "envío"}
                {viewMode === "trip" && groups.length > 0 && (
                  <span className="normal-case font-medium text-slate-400 ml-2">
                    · {groups.length} viaje{groups.length !== 1 ? "s" : ""} activo{groups.length !== 1 ? "s" : ""}
                  </span>
                )}
              </p>
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewModeAndParams("flat")}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    viewMode === "flat"
                      ? "bg-[#1e3a5f] text-white"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  Lista plana
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewModeAndParams("trip");
                    const deepLinkTrip = searchParams.get("trip_id");
                    if (deepLinkTrip) {
                      setExpandedTripIds(new Set([deepLinkTrip]));
                    } else {
                      setExpandedTripIds(new Set(groups.map((g) => g.trip.id)));
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    viewMode === "trip"
                      ? "bg-[#1e3a5f] text-white"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  <Truck className="w-3.5 h-3.5" />
                  Por viaje
                </button>
              </div>
            </div>
            {hasRole("manager", "admin") && (
              <Button
                variant="outline"
                size="default"
                onClick={() => exportToCSV(filtered, branches)}
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </Button>
            )}
          </div>
          {viewMode === "trip" ? (
            <>
              <div className="overflow-x-auto border-b border-slate-100 dark:border-slate-700">
                <table className="w-full text-sm min-w-[900px]">
                  <ShipmentTableHeader
                    canBulk={canBulk}
                    showSelectAll={eligibleInView.length > 0}
                    allSelected={allEligibleSelected}
                    onSelectAll={toggleSelectAll}
                  />
                </table>
              </div>
              <ShipmentTripGroups
                groups={groups}
                ungrouped={ungrouped}
                expandedTripIds={expandedTripIds}
                onToggleTrip={toggleTripExpanded}
                canBulk={canBulk}
                selected={selected}
                onToggleSelect={toggleSelect}
                driverMap={driverMap}
              />
            </>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <ShipmentTableHeader
                  canBulk={canBulk}
                  showSelectAll={eligibleInView.length > 0}
                  allSelected={allEligibleSelected}
                  onSelectAll={toggleSelectAll}
                />
                <tbody>
                  {filtered.map((s) => (
                    <ShipmentRow
                      key={s.tracking_id}
                      shipment={s}
                      canBulk={canBulk}
                      selected={selected}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Bulk confirm modal */}
      {bulkConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">Confirmar actualización masiva</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">
              Se actualizarán <strong>{bulkConfirm.count}</strong> {bulkConfirm.count === 1 ? "envío" : "envíos"} al estado{" "}
              <strong>"{actionLabel(bulkConfirm.action)}"</strong>.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Los envíos que no admitan esta transición serán omitidos sin cancelar la operación.
            </p>

            {bulkConfirm.action === "out_for_delivery" && (
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Chofer asignado
                </label>
                <select
                  value={bulkDriverId}
                  onChange={(e) => setBulkDriverId(e.target.value)}
                  className={`${inputClass} w-full`}
                >
                  <option value="">Seleccioná un chofer…</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.username}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setBulkConfirm(null)}
                disabled={bulkLoading}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300 disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={executeBulk}
                disabled={bulkLoading || (bulkConfirm.action === "out_for_delivery" && !bulkDriverId)}
                className="h-10 px-5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {bulkLoading ? "Procesando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk result modal */}
      {bulkResult && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">Resultado de la actualización masiva</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">
              <strong className="text-emerald-600 dark:text-emerald-400">{bulkResult.updated}</strong>{" "}
              {bulkResult.updated === 1 ? "envío actualizado" : "envíos actualizados"} exitosamente.
            </p>
            {bulkResult.skipped.length > 0 && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">
                  <strong className="text-amber-600 dark:text-amber-400">{bulkResult.skipped.length}</strong>{" "}
                  {bulkResult.skipped.length === 1 ? "envío omitido" : "envíos omitidos"}:
                </p>
                <div className="max-h-52 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800">
                        <th className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-300">ID</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-300">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.skipped.map((s) => (
                        <tr key={s.tracking_id} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="px-3 py-2"><code className="font-mono text-slate-700 dark:text-slate-300">{s.tracking_id}</code></td>
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{s.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setBulkResult(null)}
                className="h-10 px-5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white text-sm font-semibold cursor-pointer"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
