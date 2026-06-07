import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BadgeCheck, BarChart3, ClipboardList, Clock3, Download, RefreshCw } from "lucide-react";
import {
  claimsApi,
  CLAIM_EVENT_LABELS,
  CLAIM_TYPE_LABELS,
  type Claim,
  type ClaimCategory,
  type ClaimEvent,
  type ClaimResolutionType,
  type ClaimStatus,
} from "../api/claims";
import { fmtDateTime } from "../utils/date";
import { PageHeader } from "../components/ui/page-header";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useAuth } from "../context/AuthContext";
import { branchApi, type Branch } from "../api/branches";

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

function formatChangedBy(changedBy: string): string {
  if (changedBy.startsWith("chatbot-customer:")) {
    const dni = changedBy.replace("chatbot-customer:", "");
    return `Cliente (DNI ${dni}) vía chatbot`;
  }
  if (changedBy.startsWith("chatbot-sender:")) {
    const dni = changedBy.replace("chatbot-sender:", "");
    return `Remitente (DNI ${dni}) vía chatbot`;
  }
  return changedBy;
}

function statusBadgeClass(status: ClaimStatus): string {
  switch (status) {
    case "open":
      return "bg-blue-500 text-white";
    case "in_review":
      return "bg-blue-600 text-white";
    case "pending_customer":
      return "bg-amber-500 text-slate-900";
    case "derived":
      return "bg-slate-500 text-white";
    default:
      return "bg-emerald-500 text-white";
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

  const handleDownloadEvidence = async (claimId: string, fileName: string) => {
    try {
      const blob = await claimsApi.downloadEvidence(claimId);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("No se pudo descargar la evidencia del reclamo.");
    }
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
                  <label className="text-xs font-semibold text-slate-600">Sucursal</label>
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
                  <label className="text-xs font-semibold text-slate-600">Estado</label>
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
                  <label className="text-xs font-semibold text-slate-600">ID reclamo</label>
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
                  className="cursor-pointer list-none px-5 py-[18px] border-b border-slate-200 bg-gradient-to-b from-white to-slate-50"
                >
                  <div className="flex flex-wrap gap-3 items-center justify-between">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="text-xs font-extrabold tracking-wide uppercase text-slate-900 bg-[#1e3a5f]/[0.08] px-2 py-0.5 rounded-full">
                          {claim.id}
                        </span>
                        <span className="text-xs text-slate-400">Envío {claim.tracking_id}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {CLAIM_TYPE_LABELS[claim.claim_type]}
                      </div>
                    </div>
                    <span
                      className={`px-3 py-1.5 rounded-full text-xs font-extrabold shadow-[0_1px_2px_rgba(15,23,42,0.08)] ${statusBadgeClass(claim.status)}`}
                    >
                      {CLAIM_STATUS_LABELS[claim.status]}
                    </span>
                  </div>
                </summary>

                <div className="px-5 py-[18px] grid gap-4">
                  <div className="grid gap-2 text-xs text-slate-700 leading-relaxed">
                    <div><strong>Creado por:</strong> {claim.created_by}</div>
                    <div><strong>Descripción:</strong> {claim.description}</div>
                    <div><strong>Creado:</strong> {fmtDateTime(claim.created_at)}</div>
                    <div><strong>Actualizado:</strong> {fmtDateTime(claim.updated_at)}</div>
                    <div><strong>Categoría asignada:</strong> {claim.assigned_category ? CATEGORY_OPTIONS.find((c) => c.value === claim.assigned_category)?.label : "Sin asignar"}</div>
                    <div><strong>Resolución:</strong> {claim.resolution_type ? CLAIM_STATUS_LABELS[claim.status] : "Pendiente"}</div>
                    <div><strong>Automático:</strong> {claim.is_automatic ? "Sí" : "No"}</div>
                  </div>

                  {claim.evidence_file_name && (
                    <div className="flex flex-wrap gap-3 items-center justify-between border border-slate-200 rounded-2xl px-4 py-3.5 bg-slate-50">
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wide">Evidencia adjunta</div>
                        <div className="text-sm font-bold text-slate-900 break-words">{claim.evidence_file_name}</div>
                        {claim.evidence_upload_date && (
                          <div className="text-xs text-slate-500">Subida el {fmtDateTime(claim.evidence_upload_date)}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadEvidence(claim.id, claim.evidence_file_name ?? "evidencia")}
                        className="bg-gradient-to-b from-[#1e3a5f] to-[#162b49] text-white border-none rounded-xl px-3.5 py-2.5 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(30,58,95,0.14)] inline-flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Descargar evidencia
                      </button>
                    </div>
                  )}

                  {!isManager && (
                    <div className="grid gap-3 border-t border-slate-200 pt-4">
                      <div className="flex flex-wrap gap-2.5 items-end">
                        <label className="text-xs text-slate-500 font-bold uppercase tracking-wide">Derivar a</label>
                        <select
                          value={categoryDraft[claim.id] ?? ""}
                          onChange={(e) => setCategoryDraft((prev) => ({ ...prev, [claim.id]: e.target.value as ClaimCategory }))}
                          className="min-w-[240px] border border-slate-200 rounded-xl px-3 py-2.5 text-xs bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
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
                          className="bg-gradient-to-b from-[#1e3a5f] to-[#162b49] text-white border-none rounded-xl px-3.5 py-2.5 text-xs font-bold min-h-[42px] cursor-pointer shadow-[0_8px_18px_rgba(30,58,95,0.14)] disabled:opacity-55"
                        >
                          Aplicar
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2.5 items-center">
                        <span className="text-xs text-slate-500 font-bold uppercase tracking-wide">Resolver</span>
                        {RESOLUTION_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleResolve(claim.id, opt.value)}
                            disabled={busyId === claim.id || String(claim.status).startsWith("resolved_")}
                            className="bg-amber-50 text-slate-900 border border-amber-200 rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] disabled:opacity-60"
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
                          className="bg-gradient-to-b from-sky-500 to-sky-600 text-white border-none rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(14,165,233,0.18)] disabled:opacity-60"
                        >
                          Solicitar más info
                        </button>
                        {claim.status === "pending_customer" && (
                          <button
                            type="button"
                            onClick={() => handleMarkInReview(claim.id)}
                            disabled={busyId === claim.id}
                            className="bg-gradient-to-b from-blue-600 to-blue-700 text-white border-none rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(37,99,235,0.18)] disabled:opacity-60"
                          >
                            Pasar a revisión
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-slate-200 pt-4">
                    <details>
                      <summary className="cursor-pointer text-xs font-extrabold text-slate-500 mb-2 uppercase tracking-wide">
                        Historial del reclamo
                      </summary>
                      <div className="mt-2">
                        {eventsLoadingId === claim.id ? (
                          <p className="m-0 text-xs text-slate-400">Cargando historial…</p>
                        ) : (eventsByClaim[claim.id]?.length ?? 0) === 0 ? (
                          <p className="m-0 text-xs text-slate-400">Sin eventos registrados.</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {[...(eventsByClaim[claim.id] ?? [])].reverse().map((ev) => (
                              <div
                                key={ev.id}
                                className="border border-slate-200 rounded-lg px-2.5 py-2 text-xs bg-slate-50"
                              >
                                <div className="flex justify-between gap-2 mb-1">
                                  <span className="font-semibold text-slate-900">
                                    {CLAIM_EVENT_LABELS[ev.event_type] ?? ev.event_type}
                                  </span>
                                  <span className="text-slate-400 whitespace-nowrap">{fmtDateTime(ev.timestamp)}</span>
                                </div>
                                {ev.notes && <div className="text-slate-500">{ev.notes}</div>}
                                {ev.event_type === "claim_customer_responded" && ev.evidence_file_name && (
                                  <div className="mt-1">
                                    <button
                                      className="text-blue-600 underline text-xs"
                                      onClick={async () => {
                                        try {
                                          const blob = await claimsApi.downloadResponseEvidence(claim.id);
                                          const url = URL.createObjectURL(blob);
                                          const a = document.createElement("a");
                                          a.href = url;
                                          a.download = ev.evidence_file_name!;
                                          a.click();
                                          URL.revokeObjectURL(url);
                                        } catch {
                                          alert("No se pudo descargar el archivo.");
                                        }
                                      }}
                                    >
                                      📎 Descargar adjunto: {ev.evidence_file_name}
                                    </button>
                                  </div>
                                )}
                                <div className="text-slate-500 text-xs mt-1">
                                  por <strong>{formatChangedBy(ev.changed_by)}</strong>
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
