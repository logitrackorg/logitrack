import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BadgeCheck, BarChart3, ClipboardList, Clock3, RefreshCw } from "lucide-react";
import {
  claimsApi,
  CLAIM_EVENT_LABELS,
  type Claim,
  type ClaimCategory,
  type ClaimEvent,
  type ClaimResolutionType,
  type ClaimStatus,
  type ClaimType,
} from "../api/claims";
import { fmtDateTime } from "../utils/date";
import { PageHeader } from "../components/ui/page-header";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useAuth } from "../context/AuthContext";
import { branchApi, type Branch } from "../api/branches";

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  damage: "Daño/Faltante",
  missing: "Daño/Faltante",
  delay: "Retraso",
  not_delivered: "No recibido",
  bad_treatment: "Maltrato",
  wrong_data: "Datos incorrectos",
  other: "Otro",
};

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  open: "Abierto",
  in_review: "En revisión",
  pending_customer: "Pendiente del cliente",
  derived: "Derivado",
  resolved_operativa: "Resuelto: operativo",
  resolved_comercial: "Resuelto: comercial",
  resolved_rrhh: "Resuelto: RRHH",
  resolved_improcedente: "Resuelto: improcedente",
};

const CATEGORY_OPTIONS: { value: ClaimCategory; label: string }[] = [
  { value: "operaciones", label: "Operaciones" },
  { value: "comercial", label: "Comercial" },
  { value: "rrhh", label: "RRHH" },
  { value: "legales", label: "Legales" },
  { value: "seguros", label: "Seguros" },
  { value: "administracion", label: "Administración" },
];

const RESOLUTION_OPTIONS: { value: ClaimResolutionType; label: string }[] = [
  { value: "operativa", label: "Operativa" },
  { value: "comercial", label: "Comercial" },
  { value: "rrhh", label: "RRHH" },
  { value: "improcedente", label: "Improcedente" },
];

function statusBadgeStyle(status: ClaimStatus): React.CSSProperties {
  switch (status) {
    case "open":
      return { background: "#0ea5e9", color: "#fff" };
    case "in_review":
      return { background: "#2563eb", color: "#fff" };
    case "pending_customer":
      return { background: "#f59e0b", color: "#1e293b" };
    case "derived":
      return { background: "#64748b", color: "#fff" };
    default:
      return { background: "#16a34a", color: "#fff" };
  }
}

export function Claims() {
  const { hasRole } = useAuth();
  const isManager = hasRole("manager");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [selectedClaimId, setSelectedClaimId] = useState<string>("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<Record<string, ClaimCategory | "">>({});
  const [eventsByClaim, setEventsByClaim] = useState<Record<string, ClaimEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<string | null>(null);
  
  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: (notes?: string) => void;
    variant?: "default" | "danger";
    requireComment?: boolean;
  } | null>(null);

  const loadClaims = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await claimsApi.list(isManager && selectedBranch ? selectedBranch : undefined, selectedStatus ? (selectedStatus as ClaimStatus) : undefined);
      setClaims(data ?? []);
      const nextDraft: Record<string, ClaimCategory | ""> = {};
      data.forEach((c) => { nextDraft[c.id] = c.assigned_category ?? ""; });
      setCategoryDraft(nextDraft);
    } catch {
      setError("No se pudieron cargar los reclamos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadClaims(); }, []);

  useEffect(() => {
    if (isManager) {
      branchApi.listActive().then(setBranches).catch(() => {});
    }
  }, [isManager]);

  // If route includes a claim id, open it on load
  const { id: routeClaimId } = useParams();
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  useEffect(() => {
    if (routeClaimId) {
      setOpenClaimId(routeClaimId);
      void loadClaimEvents(routeClaimId, true);
    }
  }, [routeClaimId]);

  const loadClaimEvents = async (claimId: string, force = false) => {
    if (!force && eventsByClaim[claimId]) return;
    setEventsLoadingId(claimId);
    try {
      const evs = await claimsApi.getEvents(claimId);
      setEventsByClaim((prev) => ({ ...prev, [claimId]: evs ?? [] }));
    } catch {
      setError("No se pudo cargar el historial del reclamo.");
    } finally {
      setEventsLoadingId(null);
    }
  };

  // reload when filters change (for manager)
  useEffect(() => {
    if (isManager) void loadClaims();
  }, [selectedBranch, selectedStatus]);

  const visibleClaims = isManager && selectedClaimId.trim()
    ? claims.filter((claim) => claim.id.toLowerCase().includes(selectedClaimId.trim().toLowerCase()))
    : claims;

  const now = new Date();
  const visibleMetrics = visibleClaims.reduce(
    (acc, claim) => {
      acc.total += 1;
      if (claim.status === "open") acc.open += 1;
      if (String(claim.status).startsWith("resolved_")) {
        acc.closed += 1;
        const updatedAt = new Date(claim.updated_at);
        if (updatedAt.getFullYear() === now.getFullYear() && updatedAt.getMonth() === now.getMonth()) {
          acc.resolved_this_month += 1;
        }
      }
      if (claim.status === "pending_customer") acc.pending_review += 1;
      const createdAt = new Date(claim.created_at);
      if (createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth()) {
        acc.created_this_month += 1;
      }
      return acc;
    },
    { total: 0, open: 0, closed: 0, pending_review: 0, resolved_this_month: 0, created_this_month: 0 }
  );
  const visibleResolutionRate = visibleMetrics.created_this_month > 0
    ? Math.round((visibleMetrics.resolved_this_month / visibleMetrics.created_this_month) * 100)
    : 0;

  const handleUpdateCategory = async (id: string) => {
    const nextCategory = categoryDraft[id];
    if (!nextCategory) return;

    const categoryLabel = CATEGORY_OPTIONS.find((c) => c.value === nextCategory)?.label ?? nextCategory;
    
    // Show confirm dialog
    setConfirmDialog({
      isOpen: true,
      title: "Confirmar derivación",
      message: `¿Estás seguro de derivar este reclamo a "${categoryLabel}"? Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, derivar",
      cancelLabel: "Cancelar",
      variant: "default",
        requireComment: true,
      onConfirm: (notes?: string) => {
        setConfirmDialog(null);
        setBusyId(id);
        (async () => {
          try {
            const updated = await claimsApi.updateCategory(id, nextCategory, notes);
            setClaims((prev) => prev.map((c) => (c.id === id ? updated : c)));
            await loadClaimEvents(id, true);
          } catch {
            setError("No se pudo actualizar la categoría del reclamo.");
          } finally {
            setBusyId(null);
          }
        })();
      },
    });
  };

  const handleResolve = async (id: string, resolution: ClaimResolutionType) => {
    const resolutionLabel = RESOLUTION_OPTIONS.find((o) => o.value === resolution)?.label ?? resolution;
    
    // Show confirm dialog
    setConfirmDialog({
      isOpen: true,
      title: "Confirmar resolución",
      message: `¿Estás seguro de resolver este reclamo como "${resolutionLabel}"? Esta acción no se puede deshacer.`,
      confirmLabel: "Sí, resolver",
      cancelLabel: "Cancelar",
      variant: "default",
      requireComment: true,
      onConfirm: (notes?: string) => {
        setConfirmDialog(null);
        setBusyId(id);
        (async () => {
          try {
            const updated = await claimsApi.resolve(id, resolution, notes);
            setClaims((prev) => prev.map((c) => (c.id === id ? updated : c)));
            await loadClaimEvents(id, true);
          } catch {
            setError("No se pudo resolver el reclamo.");
          } finally {
            setBusyId(null);
          }
        })();
      },
    });
  };

  const handleMarkInReview = async (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Volver a revisión",
      message: "¿Querés pasar este reclamo a estado En revisión?",
      confirmLabel: "Sí, pasar a revisión",
      cancelLabel: "Cancelar",
      variant: "default",
      onConfirm: () => {
        setConfirmDialog(null);
        setBusyId(id);
        (async () => {
          try {
            const updated = await claimsApi.markInReview(id);
            setClaims((prev) => prev.map((c) => (c.id === id ? updated : c)));
            await loadClaimEvents(id, true);
          } catch {
            setError("No se pudo cambiar el estado del reclamo.");
          } finally {
            setBusyId(null);
          }
        })();
      },
    });
  };

  return (
    <div className="max-w-[1100px] mx-auto p-6 md:px-8">
      <PageHeader
        title="Reclamos"
        description="Seguimiento interno de reclamos por sucursal de origen"
        icon={<ClipboardList className="w-5 h-5" />}
        actions={
          <button
            onClick={loadClaims}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        }
      />

      {isManager && (
        <Card className="p-5 mb-4 border-slate-200 shadow-sm bg-gradient-to-br from-white via-white to-slate-50/80">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1e3a5f]">Panel gerencial</p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">Métricas de reclamos</h3>
                <p className="mt-1 text-sm text-slate-500">Resumen dinámico sobre el conjunto filtrado.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Sucursal</label>
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="h-10 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                  >
                    <option value="">Todas</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Estado</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="h-10 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                  >
                    <option value="">Todos</option>
                    {Object.keys(CLAIM_STATUS_LABELS).map((s) => (
                      <option key={s} value={s}>{CLAIM_STATUS_LABELS[s as ClaimStatus]}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>ID reclamo</label>
                  <input
                    value={selectedClaimId}
                    onChange={(e) => setSelectedClaimId(e.target.value)}
                    placeholder="Buscar por ID"
                    className="h-10 min-w-[200px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total de reclamos</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{visibleMetrics.total}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f]">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Registros que entran en el filtro actual.</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reclamos abiertos</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{visibleMetrics.open}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <Clock3 className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Casos que siguen activos.</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reclamos cerrados</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{visibleMetrics.closed}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <BadgeCheck className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Casos resueltos o finalizados.</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pendientes de revisión</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{visibleMetrics.pending_review}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">En estado pendiente del cliente.</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Resueltos este mes</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{visibleMetrics.resolved_this_month}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <RefreshCw className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">Tasa de resolución: {visibleResolutionRate}%</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : visibleClaims.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-base font-semibold text-slate-700">No hay reclamos registrados</p>
          <p className="mt-1 text-sm text-slate-500">Los reclamos aparecerán cuando un cliente los genere desde tracking.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleClaims.map((claim) => (
            <Card key={claim.id} className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
              <details
                open={openClaimId === claim.id || undefined}
                onToggle={(e) => {
                  const opened = (e.currentTarget as HTMLDetailsElement).open;
                  setOpenClaimId(opened ? claim.id : null);
                  if (opened) void loadClaimEvents(claim.id);
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    listStyle: "none",
                    padding: "18px 20px",
                    borderBottom: "1px solid #e2e8f0",
                    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#1e3a5f", background: "rgba(30,58,95,0.08)", padding: "3px 8px", borderRadius: 999 }}>
                          {claim.id}
                        </span>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>Envío {claim.tracking_id}</span>
                      </div>
                      <div style={{ fontSize: 13, color: "#475569" }}>
                        {CLAIM_TYPE_LABELS[claim.claim_type]}
                      </div>
                    </div>
                    <span
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 800,
                        boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
                        ...statusBadgeStyle(claim.status),
                      }}
                    >
                      {CLAIM_STATUS_LABELS[claim.status]}
                    </span>
                  </div>
                </summary>

                <div style={{ padding: "18px 20px 20px", display: "grid", gap: 16 }}>
                  <div style={{ display: "grid", gap: 8, fontSize: 13, color: "#334155", lineHeight: 1.45 }}>
                    <div><strong>Creado por:</strong> {claim.created_by}</div>
                    <div><strong>Descripción:</strong> {claim.description}</div>
                    <div><strong>Creado:</strong> {fmtDateTime(claim.created_at)}</div>
                    <div><strong>Actualizado:</strong> {fmtDateTime(claim.updated_at)}</div>
                    <div><strong>Categoría asignada:</strong> {claim.assigned_category ? CATEGORY_OPTIONS.find((c) => c.value === claim.assigned_category)?.label : "Sin asignar"}</div>
                    <div><strong>Resolución:</strong> {claim.resolution_type ? CLAIM_STATUS_LABELS[claim.status] : "Pendiente"}</div>
                    <div><strong>Automático:</strong> {claim.is_automatic ? "Sí" : "No"}</div>
                  </div>

                  {!isManager && (
                    <div style={{ display: "grid", gap: 12, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
                        <label style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Derivar a</label>
                        <select
                          value={categoryDraft[claim.id] ?? ""}
                          onChange={(e) => setCategoryDraft((prev) => ({ ...prev, [claim.id]: e.target.value as ClaimCategory }))}
                          style={{
                            minWidth: 240,
                            border: "1px solid #cbd5e1",
                            borderRadius: 12,
                            padding: "10px 12px",
                            fontSize: 13,
                            background: "#fff",
                            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                          }}
                        >
                          <option value="">Seleccionar área</option>
                          {CATEGORY_OPTIONS.map((cat) => (
                            <option key={cat.value} value={cat.value}>{cat.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleUpdateCategory(claim.id)}
                          disabled={!categoryDraft[claim.id] || busyId === claim.id || String(claim.status).startsWith("resolved_")}
                          style={{
                            background: "linear-gradient(180deg, #1e3a5f 0%, #162b49 100%)",
                            color: "#fff",
                            border: "none",
                            borderRadius: 12,
                            padding: "10px 14px",
                            fontSize: 12,
                            fontWeight: 700,
                            minHeight: 42,
                            cursor: "pointer",
                            opacity: !categoryDraft[claim.id] || busyId === claim.id || String(claim.status).startsWith("resolved_") ? 0.55 : 1,
                            boxShadow: "0 8px 18px rgba(30,58,95,0.14)",
                          }}
                        >
                          Aplicar
                        </button>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Resolver</span>
                        {RESOLUTION_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleResolve(claim.id, opt.value)}
                            disabled={busyId === claim.id || String(claim.status).startsWith("resolved_")}
                            style={{
                              background: "#fff7ed",
                              color: "#1e293b",
                              border: "1px solid #fed7aa",
                              borderRadius: 999,
                              padding: "9px 14px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                              opacity: busyId === claim.id || String(claim.status).startsWith("resolved_") ? 0.6 : 1,
                              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            // request more info
                            setConfirmDialog({
                              isOpen: true,
                              title: "Solicitar más información",
                              message: "Solicitar más información al cliente (por ejemplo: fotos o aclaraciones). Se registrará en el historial.",
                              confirmLabel: "Solicitar",
                              cancelLabel: "Cancelar",
                              variant: "default",
                              requireComment: true,
                              onConfirm: (notes?: string) => {
                                setConfirmDialog(null);
                                setBusyId(claim.id);
                                (async () => {
                                  try {
                                    const updated = await claimsApi.requestInfo(claim.id, notes);
                                    setClaims((prev) => prev.map((c) => (c.id === claim.id ? updated : c)));
                                    await loadClaimEvents(claim.id, true);
                                  } catch {
                                    setError("No se pudo solicitar información al cliente.");
                                  } finally {
                                    setBusyId(null);
                                  }
                                })();
                              },
                            });
                          }}
                          disabled={busyId === claim.id || String(claim.status).startsWith("resolved_")}
                          style={{
                            background: "linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%)",
                            color: "#fff",
                            border: "none",
                            borderRadius: 999,
                            padding: "9px 14px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            opacity: busyId === claim.id || String(claim.status).startsWith("resolved_") ? 0.6 : 1,
                            boxShadow: "0 8px 18px rgba(14,165,233,0.18)",
                          }}
                        >
                          Solicitar más info
                        </button>
                        {claim.status === "pending_customer" && (
                          <button
                            type="button"
                            onClick={() => handleMarkInReview(claim.id)}
                            disabled={busyId === claim.id}
                            style={{
                              background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
                              color: "#fff",
                              border: "none",
                              borderRadius: 999,
                              padding: "9px 14px",
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                              opacity: busyId === claim.id ? 0.6 : 1,
                              boxShadow: "0 8px 18px rgba(37,99,235,0.18)",
                            }}
                          >
                            Pasar a revisión
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                    <details>
                      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 800, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 }}>
                        Historial del reclamo
                      </summary>
                      <div style={{ marginTop: 8 }}>
                        {eventsLoadingId === claim.id ? (
                          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>Cargando historial…</p>
                        ) : (eventsByClaim[claim.id]?.length ?? 0) === 0 ? (
                          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>Sin eventos registrados.</p>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {[...(eventsByClaim[claim.id] ?? [])].reverse().map((ev) => (
                              <div
                                key={ev.id}
                                style={{
                                  border: "1px solid #e2e8f0",
                                  borderRadius: 8,
                                  padding: "8px 10px",
                                  fontSize: 13,
                                  background: "#f8fafc",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontWeight: 600, color: "#1e3a5f" }}>
                                    {CLAIM_EVENT_LABELS[ev.event_type] ?? ev.event_type}
                                  </span>
                                  <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}>{fmtDateTime(ev.timestamp)}</span>
                                </div>
                                {ev.notes && <div style={{ color: "#475569" }}>{ev.notes}</div>}
                                <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                                  por <strong>{ev.changed_by}</strong>
                                  {ev.from_status && ev.to_status && (
                                    <span> · {CLAIM_STATUS_LABELS[ev.from_status]} → {CLAIM_STATUS_LABELS[ev.to_status]}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          cancelLabel={confirmDialog.cancelLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
          variant={confirmDialog.variant}
          requireComment={confirmDialog.requireComment}
        />
      )}
    </div>
  );
}
