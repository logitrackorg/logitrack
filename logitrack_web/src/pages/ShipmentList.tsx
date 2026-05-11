import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Package, Plus, Search, X, Download, AlertTriangle, MapPin, Filter, FileText, Clock } from "lucide-react";
import { shipmentApi, type Shipment, type ShipmentStatus, INCIDENT_TYPE_LABELS } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { usersApi, type UserProfile } from "../api/users";
import { fmtDate } from "../utils/date";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityBadge } from "../components/PriorityBadge";
import { shipmentStatusLabelOverride } from "../utils/shipmentStatus";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/page-header";
import { Card } from "../components/ui/card";

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

type StatusFilter = ShipmentStatus | "active" | "expired" | "";

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
  "h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

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
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirmState | null>(null);
  const [bulkDriverId, setBulkDriverId] = useState("");
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const dateRangeInvalid = !!(dateFrom && dateTo && dateTo < dateFrom);

  // Track whether the last server fetch included expired drafts, to detect
  // when a statusFilter change requires a new server request.
  const loadedWithExpiredRef = useRef(statusFilter === "expired");

  const load = async (withExpired: boolean) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const params = withExpired ? { include_expired: "true" } : undefined;
      const data = await shipmentApi.list(params);
      setShipments(data ?? []);
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
    if (statusFilter !== "active" && statusFilter !== "" && s.status !== statusFilter) return false;
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

  const eligibleInView = filtered.filter((s) => BULK_ELIGIBLE_STATUSES.includes(s.status as ShipmentStatus));
  const allEligibleSelected = eligibleInView.length > 0 && eligibleInView.every((s) => selected.has(s.tracking_id));

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

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Envíos"
        description="Seguimiento y gestión del flujo logístico"
        icon={<Package className="w-5 h-5" />}
        actions={
          hasRole("operator", "supervisor") ? (
            <div className="flex items-center gap-2">
              {/* Drafts button with badge */}
              {(() => {
                const draftCount = shipments.filter((s) => s.status === "draft").length;
                return (
                  <button
                    onClick={() => navigate("/drafts")}
                    className="relative inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    Borradores
                    {draftCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                        {draftCount > 99 ? "99+" : draftCount}
                      </span>
                    )}
                  </button>
                );
              })()}
              <button
                onClick={() => navigate("/new")}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Nuevo envío
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Search & filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por ID, remitente, destinatario o ciudad…"
              className={`${inputClass} w-full pl-9 pr-${query ? "10" : "3"}`}
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
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Desde</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className={inputClass}
            />
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Hasta</span>
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

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={inputClass}
          >
            <option value="active">Activos</option>
            <option value="">Todos</option>
            <option value="at_origin_hub">En sucursal de origen</option>
            <option value="loaded">Enviar a sucursal</option>
            <option value="in_transit">En tránsito</option>
            <option value="at_hub">En sucursal</option>
            <option value="out_for_delivery">Última milla</option>
            <option value="delivery_failed">Entrega fallida</option>
            <option value="redelivery_scheduled">Reentrega programada</option>
            <option value="no_entregado">No entregado</option>
            <option value="rechazado">Rechazado</option>
            <option value="ready_for_pickup">Listo para retiro</option>
            <option value="ready_for_return">Listo para devolución</option>
            <option value="delivered">Entregados</option>
            <option value="returned">Devueltos</option>
            <option value="cancelled">Cancelados</option>
            <option value="lost">Extraviados</option>
            <option value="destroyed">Daño total</option>
            <option value="draft">Borrador</option>
            {hasRole("supervisor", "manager") && (
              <option value="expired">Borradores expirados</option>
            )}
          </select>

          {isOperator ? (
            <span className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-blue-50 border border-blue-200 text-sm font-semibold text-[#1e3a5f]">
              <MapPin className="w-3.5 h-3.5" />
              {branches.find(b => b.id === branchFilter)?.name ?? branchFilter}
            </span>
          ) : (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className={inputClass}
            >
              <option value="">Todas las sucursales</option>
              {(() => {
                const byProvince = branches.reduce((acc, b) => {
                  if (!acc[b.province]) acc[b.province] = [];
                  acc[b.province].push(b);
                  return acc;
                }, {} as Record<string, Branch[]>);
                return Object.entries(byProvince)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([province, pBranches]) => (
                    <optgroup key={province} label={province}>
                      {[...pBranches]
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(b => (
                          <option key={b.id} value={b.id}>{b.name} — {b.address.city}</option>
                        ))}
                    </optgroup>
                  ));
              })()}
            </select>
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
        <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-xl border border-slate-300 bg-slate-100 text-sm text-slate-700">
          <Clock className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
          <span>
            Mostrando borradores expirados. Son visibles solo para supervisores y gerentes hasta que se eliminen los datos personales (según configuración en <strong>Configuración del sistema</strong>).
          </span>
        </div>
      )}

      {/* Bulk action toolbar */}
      {canBulk && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <span className="text-sm font-semibold text-[#1e3a5f]">
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
            className="ml-auto text-xs text-slate-500 hover:text-slate-700 underline cursor-pointer"
          >
            Cancelar selección
          </button>
        </div>
      )}

      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center">
          <Filter className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No se encontraron envíos con los filtros aplicados.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {filtered.length} {filtered.length !== 1 ? "envíos" : "envío"}
            </p>
            {hasRole("manager") && (
              <button
                onClick={() => exportToCSV(filtered, branches)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="bg-slate-50/50 text-left border-b border-slate-100">
                  {canBulk && (
                    <th className="px-4 py-3 w-10 text-center">
                      {eligibleInView.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allEligibleSelected}
                          onChange={toggleSelectAll}
                          title="Seleccionar todos los elegibles"
                          className="cursor-pointer accent-[#1e3a5f]"
                        />
                      )}
                    </th>
                  )}
                  <th className={thClass}>ID de seguimiento</th>
                  <th className={thClass}>Remitente</th>
                  <th className={thClass}>Destinatario</th>
                  <th className={thClass}>Origen → Destino</th>
                  <th className={thClass}>Peso</th>
                  <th className={thClass}>Prioridad</th>
                  <th className={thClass}>Estado</th>
                  <th className={thClass}>Creado</th>
                  <th className={thClass}>Entrega est.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const isEligible = BULK_ELIGIBLE_STATUSES.includes(s.status as ShipmentStatus);
                  const isChecked = selected.has(s.tracking_id);
                  return (
                    <tr
                      key={s.tracking_id}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.tagName === "INPUT") return;
                        navigate(`/shipments/${s.tracking_id}`);
                      }}
                      className={`border-b border-slate-100 cursor-pointer transition-colors ${
                        isChecked ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-slate-50"
                      }`}
                    >
                      {canBulk && (
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {isEligible && (
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelect(s.tracking_id)}
                              className="cursor-pointer accent-[#1e3a5f]"
                            />
                          )}
                        </td>
                      )}
                      <td className={tdClass}>
                        <code className={`text-xs font-mono ${s.status === "draft" ? "text-slate-400" : "text-slate-700"}`}>
                          {s.tracking_id}
                        </code>
                      </td>
                      <td className={tdClass}>{corr(s, "sender_name", s.sender.name)}</td>
                      <td className={tdClass}>{corr(s, "recipient_name", s.recipient.name)}</td>
                      <td className={tdClass}>
                        <span className="text-slate-600">{corr(s, "origin_city", s.sender.address.city)}</span>
                        <span className="mx-1.5 text-slate-300">→</span>
                        <span className="text-slate-600">{corr(s, "destination_city", s.recipient.address.city)}</span>
                      </td>
                      <td className={tdClass}>
                        {s.status === "draft" && (!s.weight_kg || s.weight_kg <= 0)
                          ? <span className="text-slate-400 text-xs italic">Sin definir</span>
                          : <span className="tabular-nums whitespace-nowrap">{corr(s, "weight_kg", s.weight_kg)} kg</span>
                        }
                      </td>
                      <td className={tdClass}><PriorityBadge priority={s.priority} /></td>
                      <td className={tdClass}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <StatusBadge status={s.status} label={shipmentStatusLabelOverride(s)} />
                          {s.has_incident && (
                            <span
                              title={s.incident_type ? INCIDENT_TYPE_LABELS[s.incident_type] : "Incidencia registrada"}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                            >
                              <AlertTriangle className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`${tdClass} text-slate-500`}>{fmtDate(s.created_at)}</td>
                      <td className={`${tdClass} text-slate-500`}>{s.estimated_delivery_at ? fmtDate(s.estimated_delivery_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Bulk confirm modal */}
      {bulkConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Confirmar actualización masiva</h3>
            <p className="text-sm text-slate-700 mb-3">
              Se actualizarán <strong>{bulkConfirm.count}</strong> {bulkConfirm.count === 1 ? "envío" : "envíos"} al estado{" "}
              <strong>"{actionLabel(bulkConfirm.action)}"</strong>.
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Los envíos que no admitan esta transición serán omitidos sin cancelar la operación.
            </p>

            {bulkConfirm.action === "out_for_delivery" && (
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
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
                className="h-10 px-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={executeBulk}
                disabled={bulkLoading || (bulkConfirm.action === "out_for_delivery" && !bulkDriverId)}
                className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-3">Resultado de la actualización masiva</h3>
            <p className="text-sm text-slate-700 mb-2">
              <strong className="text-emerald-600">{bulkResult.updated}</strong>{" "}
              {bulkResult.updated === 1 ? "envío actualizado" : "envíos actualizados"} exitosamente.
            </p>
            {bulkResult.skipped.length > 0 && (
              <>
                <p className="text-sm text-slate-700 mb-2">
                  <strong className="text-amber-600">{bulkResult.skipped.length}</strong>{" "}
                  {bulkResult.skipped.length === 1 ? "envío omitido" : "envíos omitidos"}:
                </p>
                <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-lg mb-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">ID</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.skipped.map((s) => (
                        <tr key={s.tracking_id} className="border-t border-slate-100">
                          <td className="px-3 py-2"><code className="font-mono">{s.tracking_id}</code></td>
                          <td className="px-3 py-2 text-slate-500">{s.reason}</td>
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
                className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-semibold cursor-pointer"
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

const thClass = "px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider";
const tdClass = "px-4 py-3 text-slate-700";
