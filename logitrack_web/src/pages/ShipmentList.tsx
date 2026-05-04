import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { shipmentApi, type Shipment, type ShipmentStatus, INCIDENT_TYPE_LABELS } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { usersApi, type UserProfile } from "../api/users";
import { fmtDate } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { useAuth } from "../context/AuthContext";
import { Plus, Download, X, AlertTriangle, RefreshCw, Package, Search, Filter, ChevronDown, Truck, AlertCircle, CheckCircle2, TrendingUp } from "lucide-react";

function corr(s: Shipment, key: string, fallback: string | number): string {
  const v = s.corrections?.[key];
  return v !== undefined ? v : String(fallback);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function exportToCSV(shipments: Shipment[], branches: Branch[]) {
  const branchName = (id?: string) => {
    if (!id) return "";
    const b = branches.find((b) => b.id === id);
    return b ? `${b.name} — ${b.address.city}` : id;
  };
  const headers = [
    "ID de seguimiento",
    "Estado",
    "Prioridad",
    "Ciudad de origen",
    "Provincia de origen",
    "Ciudad de destino",
    "Provincia de destino",
    "Sucursal receptora",
    "Tipo de envío",
    "Peso (kg)",
    "Ubicación actual",
    "Creado",
    "Entrega estimada",
  ];
  const rows = shipments.map((s) =>
    [
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
      fmtDate(s.estimated_delivery_at),
    ]
      .map(csvEscape)
      .join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shipments_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

type StatusFilter = ShipmentStatus | "active" | "";
const BULK_ELIGIBLE: ShipmentStatus[] = ["at_hub", "delivery_failed"];
type BulkAction = "ready_for_pickup" | "out_for_delivery";
interface BulkConfirm {
  action: BulkAction;
  count: number;
}
interface BulkResult {
  updated: number;
  skipped: { tracking_id: string; reason: string }[];
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Activos" },
  { value: "", label: "Todos" },
  { value: "at_origin_hub", label: "En sucursal de origen" },
  { value: "loaded", label: "Cargado" },
  { value: "in_transit", label: "En tránsito" },
  { value: "at_hub", label: "En sucursal" },
  { value: "out_for_delivery", label: "En reparto" },
  { value: "delivery_failed", label: "Entrega fallida" },
  { value: "redelivery_scheduled", label: "Reentrega programada" },
  { value: "no_entregado", label: "No entregado" },
  { value: "rechazado", label: "Rechazado" },
  { value: "ready_for_pickup", label: "Listo para retiro" },
  { value: "ready_for_return", label: "Listo para devolución" },
  { value: "delivered", label: "Entregados" },
  { value: "returned", label: "Devueltos" },
  { value: "cancelled", label: "Cancelados" },
  { value: "lost", label: "Extraviados" },
  { value: "destroyed", label: "Daño total" },
  { value: "draft", label: "Borrador" },
];

const inputCls =
  "h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";
const btnPrimary =
  "inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-500/20";
const btnSecondary =
  "inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-gray-600 transition-colors cursor-pointer disabled:opacity-50";

export function ShipmentList() {
  const [searchParams] = useSearchParams();
  const [shipments, setShipments] = useState<Shipment[]>([]);
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
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirm | null>(null);
  const [bulkDriverId, setBulkDriverId] = useState("");
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const dateRangeInvalid = !!(dateFrom && dateTo && dateTo < dateFrom);

  const load = async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      setShipments((await shipmentApi.list()) ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    branchApi
      .listActive()
      .then(setBranches)
      .catch(() => {});
  }, []);

  const localDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const filtered = shipments.filter((s) => {
    const terminal = ["delivered", "draft", "returned", "cancelled", "lost", "destroyed"];
    if (statusFilter === "active" && terminal.includes(s.status)) return false;
    if (statusFilter !== "active" && statusFilter !== "" && s.status !== statusFilter) return false;
    if (
      branchFilter &&
      s.receiving_branch_id !== branchFilter &&
      !(s.status === "in_transit" && s.current_location === branchFilter)
    )
      return false;
    if (!dateRangeInvalid) {
      const created = localDate(s.created_at);
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > dateTo) return false;
    }
    const q = query.trim().toLowerCase();
    if (q.length >= 3) {
      const cor = s.corrections ?? {};
      const fields = [
        cor.sender_name ?? s.sender?.name ?? "",
        cor.recipient_name ?? s.recipient?.name ?? "",
        cor.sender_city ?? s.sender?.address?.city ?? "",
        cor.recipient_city ?? s.recipient?.address?.city ?? "",
        s.tracking_id,
      ];
      if (!fields.some((f) => f.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  const eligibleInView = filtered.filter((s) => BULK_ELIGIBLE.includes(s.status as ShipmentStatus));
  const allEligibleSelected = eligibleInView.length > 0 && eligibleInView.every((s) => selected.has(s.tracking_id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openBulkAction = (action: BulkAction) => {
    if (selected.size === 0) return;
    if (action === "out_for_delivery") {
      usersApi
        .listDrivers(user?.branch_id)
        .then(setDrivers)
        .catch(() => {});
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
      await load();
    } finally {
      setBulkLoading(false);
    }
  };

  const branchesByProvince = branches.reduce(
    (acc, b) => {
      if (!acc[b.province]) acc[b.province] = [];
      acc[b.province].push(b);
      return acc;
    },
    {} as Record<string, Branch[]>
  );

  // Calcular stats rápidos
  const stats = {
    total: shipments.length,
    active: shipments.filter(s => !['delivered', 'returned', 'cancelled', 'lost', 'destroyed', 'draft'].includes(s.status)).length,
    inTransit: shipments.filter(s => s.status === 'in_transit' || s.status === 'out_for_delivery').length,
    delivered: shipments.filter(s => s.status === 'delivered').length,
    incidents: shipments.filter(s => s.has_incident).length,
  };

  // Active filter pills
  const activeFilters: { key: string; label: string; onRemove: () => void }[] = [];
  if (query) activeFilters.push({ key: 'query', label: `Búsqueda: "${query}"`, onRemove: () => setQuery('') });
  if (statusFilter && statusFilter !== 'active') activeFilters.push({ key: 'status', label: STATUS_OPTIONS.find(o => o.value === statusFilter)?.label ?? statusFilter, onRemove: () => setStatusFilter('active') });
  if (branchFilter) activeFilters.push({ key: 'branch', label: branches.find(b => b.id === branchFilter)?.name ?? branchFilter, onRemove: () => setBranchFilter('') });
  if (dateFrom) activeFilters.push({ key: 'dateFrom', label: `Desde ${dateFrom}`, onRemove: () => setDateFrom('') });
  if (dateTo) activeFilters.push({ key: 'dateTo', label: `Hasta ${dateTo}`, onRemove: () => setDateTo('') });

  return (
    <div className={`max-w-[1400px] mx-auto space-y-4 ${canBulk && selected.size > 0 ? "pb-24" : ""}`}>
      {/* Header con stats - Premium KPI Cards */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Envíos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? "Cargando..." : `${filtered.length} resultado${filtered.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        
        {/* KPI Cards */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center gap-2">
            {/* Activos */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setStatusFilter('active')}>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900 leading-tight">{stats.active}</div>
                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Activos</div>
              </div>
            </div>
            
            {/* En Tránsito */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setStatusFilter('in_transit')}>
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                <Truck className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900 leading-tight">{stats.inTransit}</div>
                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">En tránsito</div>
              </div>
            </div>
            
            {/* Entregados */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setStatusFilter('delivered')}>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900 leading-tight">{stats.delivered}</div>
                <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Entregados</div>
              </div>
            </div>
            
            {/* Incidencias */}
            {stats.incidents > 0 && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <div className="text-lg font-bold text-red-700 leading-tight">{stats.incidents}</div>
                  <div className="text-[10px] text-red-500 font-medium uppercase tracking-wide">Incidencias</div>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className={btnSecondary} title="Actualizar">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          {hasRole("admin", "manager") && (
            <button onClick={() => exportToCSV(filtered, branches)} className={btnSecondary}>
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exportar CSV</span>
            </button>
          )}
          {hasRole("operator", "supervisor", "admin") && (
            <button onClick={() => navigate("/new")} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Nuevo envío</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters - Panel colapsable */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header del panel de filtros */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-gray-700">Filtros</span>
            {(query || statusFilter !== "active" || branchFilter || dateFrom || dateTo) && (
              <span className="px-1.5 py-0.5 rounded-full bg-[#1e3a5f] text-[10px] font-semibold text-white">
                Active
              </span>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showFilters ? "rotate-180" : ""}`} />
        </button>

        {/* Contenido de filtros */}
        {showFilters && (
          <div className="px-4 pb-4 space-y-3">
            {/* Fila 1: Búsqueda y Estado */}
            <div className="flex flex-wrap gap-3">
              {/* Search - Premium con icono grande */}
              <div className="relative flex-1 min-w-72">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar por ID, nombre o ciudad..."
                  className={`${inputCls} w-full pl-11 pr-8 h-10`}
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-slate-100 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Status */}
              <div className="w-44">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className={`${inputCls} w-full`}>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Branch */}
              {isOperator ? (
                <span className="inline-flex items-center h-9 px-3 rounded-lg border border-blue-200 bg-blue-50 text-sm font-medium text-[#1e3a5f]">
                  {branches.find((b) => b.id === branchFilter)?.name ?? branchFilter}
                </span>
              ) : (
                <div className="w-56">
                  <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={`${inputCls} w-full`}>
                    <option value="">Todas las sucursales</option>
                    {Object.entries(branchesByProvince)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([province, pBranches]) => (
                        <optgroup key={province} label={province}>
                          {[...pBranches]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name} — {b.address.city}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                  </select>
                </div>
              )}
            </div>

            {/* Fila 2: Fechas */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Fecha de creación:</span>
              <div className="flex items-center gap-2">
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${inputCls} w-36`} />
                <span className="text-gray-400">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className={`${inputCls} w-36 ${dateRangeInvalid ? "border-red-300 focus:border-red-400" : ""}`}
                />
                {(dateFrom || dateTo) && (
                  <button
                    onClick={() => {
                      setDateFrom("");
                      setDateTo("");
                    }}
                    className="text-gray-400 hover:text-gray-600 p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {dateRangeInvalid && (
                <span className="flex items-center gap-1 text-xs text-red-600">
                  <AlertTriangle className="w-3 h-3" /> Rango inválido
                </span>
              )}
            </div>

            {/* Active Filter Pills */}
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <span className="text-xs text-slate-500 font-medium">Filtros activos:</span>
                {activeFilters.map((f) => (
                  <button
                    key={f.key}
                    onClick={f.onRemove}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition-colors cursor-pointer group">
                    {f.label}
                    <X className="w-3 h-3 group-hover:text-slate-800" />
                  </button>
                ))}
                <button
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("active");
                    setBranchFilter("");
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="text-xs text-blue-600 font-medium hover:underline cursor-pointer">
                  Limpiar todo
                </button>
              </div>
            )}
          </div>
        )}
      </div>

        {/* Bulk toolbar - Fixed bottom */}
        {canBulk && selected.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-gray-900/95 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-800/50 animate-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#1e3a5f] flex items-center justify-center">
                <span className="text-sm font-bold text-white">{selected.size}</span>
              </div>
              <span className="text-sm font-medium text-white">
                {selected.size === 1 ? "envío seleccionado" : "envíos seleccionados"}
              </span>
            </div>
            <div className="h-6 w-px bg-gray-700" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => openBulkAction("ready_for_pickup")}
                className="h-8 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-all hover:scale-105 cursor-pointer">
                Listo para retiro
              </button>
              <button
                onClick={() => openBulkAction("out_for_delivery")}
                className="h-8 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-all hover:scale-105 cursor-pointer">
                Asignar a reparto
              </button>
            </div>
            <button
              onClick={() => setSelected(new Set())}
              className="ml-2 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {canBulk && <th className="w-10 px-4 py-3"></th>}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Remitente</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Destinatario</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Ruta</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Peso</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Prioridad</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Creado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Entrega est.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {canBulk && <td className="px-4 py-3"><div className="w-4 h-4 bg-slate-100 rounded animate-pulse" /></td>}
                      <td className="px-4 py-3"><div className="h-4 w-24 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-32 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-40 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-12 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-5 w-16 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-5 w-20 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-100 rounded animate-pulse" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-20 bg-slate-100 rounded animate-pulse" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <Package className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Sin resultados</h3>
              <p className="text-sm text-gray-500 max-w-sm mb-4">No se encontraron envíos con los filtros aplicados. Intentá con otros criterios de búsqueda.</p>
              <button
                onClick={() => {
                  setQuery("");
                  setStatusFilter("active");
                  setBranchFilter("");
                  setDateFrom("");
                  setDateTo("");
                }}
                className="text-sm text-[#1e3a5f] font-medium hover:underline">
                Limpiar todos los filtros
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 shadow-sm">
                  <tr>
                    {canBulk && (
                      <th className="w-10 px-3 py-3 text-center bg-slate-50">
                        {eligibleInView.length > 0 && (
                          <input
                            type="checkbox"
                            checked={allEligibleSelected}
                            onChange={() =>
                              allEligibleSelected
                                ? setSelected(new Set())
                                : setSelected(new Set(eligibleInView.map((s) => s.tracking_id)))
                            }
                            className="cursor-pointer rounded"
                          />
                        )}
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      Involucrados
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      Ruta
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      Peso
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      Prioridad
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      Estado
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      Creado
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                      Entrega est.
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((s) => {
                    const isEligible = BULK_ELIGIBLE.includes(s.status as ShipmentStatus);
                    const isChecked = selected.has(s.tracking_id);
                    return (
                      <tr
                        key={s.tracking_id}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).tagName === "INPUT") return;
                          navigate(`/shipments/${s.tracking_id}`);
                        }}
                        className={`cursor-pointer transition-all duration-150 group ${isChecked ? "bg-blue-50/70" : "hover:bg-slate-50/80"}`}>
                        {canBulk && (
                          <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            {isEligible && (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleSelect(s.tracking_id)}
                                className="cursor-pointer rounded"
                              />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <code
                            className={`text-xs font-mono font-semibold tracking-wide ${s.status === "draft" ? "text-gray-400" : "text-[#1e3a5f]"}`}>
                            {s.tracking_id}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {/* Remitente avatar */}
                            <div className="flex-shrink-0" title={`Remitente: ${corr(s, "sender_name", s.sender.name)}`}>
                              <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-white shadow-sm flex items-center justify-center">
                                <span className="text-[10px] font-bold text-emerald-700">
                                  {(corr(s, "sender_name", s.sender.name) || "R").charAt(0).toUpperCase()}
                                </span>
                              </div>
                            </div>
                            {/* Destinatario avatar */}
                            <div className="flex-shrink-0" title={`Destinatario: ${corr(s, "recipient_name", s.recipient.name)}`}>
                              <div className="w-8 h-8 rounded-full bg-violet-100 border-2 border-white shadow-sm flex items-center justify-center -ml-4">
                                <span className="text-[10px] font-bold text-violet-700">
                                  {(corr(s, "recipient_name", s.recipient.name) || "D").charAt(0).toUpperCase()}
                                </span>
                              </div>
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate max-w-[140px]" title={corr(s, "sender_name", s.sender.name)}>
                                {corr(s, "sender_name", s.sender.name)}
                              </div>
                              <div className="text-xs text-gray-400 truncate max-w-[140px]">→ {corr(s, "recipient_name", s.recipient.name)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium truncate max-w-16">
                              {corr(s, "origin_city", s.sender.address.city)}
                            </span>
                            <Truck className="w-3 h-3 text-slate-400 flex-shrink-0" />
                            <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-medium truncate max-w-16">
                              {corr(s, "destination_city", s.recipient.address.city)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {corr(s, "weight_kg", s.weight_kg)} kg
                        </td>
                        <td className="px-4 py-3">
                          <PriorityBadge priority={s.priority} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {/* Ping indicator for active states */}
                            {['in_transit', 'out_for_delivery', 'at_hub', 'loaded', 'at_origin_hub'].includes(s.status) && (
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                              </span>
                            )}
                            <StatusBadge status={s.status} />
                            {s.has_incident && (
                              <span
                                title={
                                  s.incident_type ? INCIDENT_TYPE_LABELS[s.incident_type] : "Incidencia registrada"
                                }
                                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[10px] border border-amber-200">
                                !
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(s.created_at)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {fmtDate(s.estimated_delivery_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* Bulk confirm modal */}
      {bulkConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Actualización masiva</h2>
              <button onClick={() => setBulkConfirm(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Se actualizarán <strong className="text-gray-900">{bulkConfirm.count}</strong>{" "}
              {bulkConfirm.count === 1 ? "envío" : "envíos"} a{" "}
              <strong className="text-gray-900">
                "{bulkConfirm.action === "ready_for_pickup" ? "Listo para retiro" : "En reparto"}"
              </strong>
              .
            </p>
            <p className="text-xs text-gray-400">Los envíos que no admitan esta transición serán omitidos.</p>
            {bulkConfirm.action === "out_for_delivery" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Chofer asignado</label>
                <select
                  value={bulkDriverId}
                  onChange={(e) => setBulkDriverId(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 focus:border-[#2563eb]">
                  <option value="">Seleccioná un chofer...</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.username}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setBulkConfirm(null)}
                disabled={bulkLoading}
                className="h-9 px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-gray-600 transition-colors cursor-pointer disabled:opacity-50">
                Cancelar
              </button>
              <button
                onClick={executeBulk}
                disabled={bulkLoading || (bulkConfirm.action === "out_for_delivery" && !bulkDriverId)}
                className={btnPrimary}>
                {bulkLoading ? "Procesando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk result modal */}
      {bulkResult && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900">Resultado</h2>
            <p className="text-sm text-gray-600">
              <strong className="text-emerald-600">{bulkResult.updated}</strong>{" "}
              {bulkResult.updated === 1 ? "envío actualizado" : "envíos actualizados"} correctamente.
            </p>
            {bulkResult.skipped.length > 0 && (
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  <strong className="text-amber-600">{bulkResult.skipped.length}</strong>{" "}
                  {bulkResult.skipped.length === 1 ? "envío omitido" : "envíos omitidos"}:
                </p>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                  {bulkResult.skipped.map((s) => (
                    <div key={s.tracking_id} className="flex items-center gap-3 px-3 py-2">
                      <code className="font-mono text-[#1e3a5f] font-semibold">{s.tracking_id}</code>
                      <span className="text-gray-400">{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => setBulkResult(null)} className={btnPrimary}>
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
