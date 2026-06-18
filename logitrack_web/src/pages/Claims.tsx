import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { BadgeCheck, BarChart3, ClipboardList, Clock3, Download, Paperclip, RefreshCw, SendHorizonal } from "lucide-react";
import {
  claimsApi,
  CLAIM_EVENT_LABELS,
  CLAIM_TYPE_LABELS,
  type Claim,
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
  transferred: "Derivado a sucursal",
  transfer_rejected: "Derivación rechazada",
  resolved_operativa: "Resuelto: operativo",
  resolved_comercial: "Resuelto: comercial",
  resolved_rrhh: "Resuelto: RRHH",
  resolved_improcedente: "Resuelto: improcedente",
};

const RESOLUTION_OPTIONS: { value: ClaimResolutionType; label: string }[] = [
  { value: "operativa", label: "Operativa" },
  { value: "comercial", label: "Comercial" },
  { value: "rrhh", label: "RRHH" },
  { value: "improcedente", label: "Improcedente" },
];

function formatChangedBy(changedBy: string): string {
  if (!changedBy || changedBy === "system") return "sistema";
  if (changedBy.startsWith("chatbot-customer:")) {
    const dni = changedBy.replace("chatbot-customer:", "");
    return `Destinatario (DNI ${dni}) vía chatbot`;
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
      return "bg-amber-500 dark:text-gray-100 text-slate-900";
    case "derived":
      return "bg-slate-500 text-white";
    case "transferred":
      return "bg-violet-600 text-white";
    case "transfer_rejected":
      return "bg-rose-500 text-white";
    default:
      return "bg-emerald-500 text-white";
  }
}

export function Claims() {
  const { hasRole, user } = useAuth();
  const isManager = hasRole("manager");
  // Solo los supervisores pueden accionar sobre reclamos (comentar, resolver,
  // solicitar info, derivar a sucursal). Los operadores tienen acceso de solo lectura.
  const isSupervisor = hasRole("supervisor");
  const myBranchId = user?.branch_id ?? "";
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [selectedClaimId, setSelectedClaimId] = useState<string>("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [eventsByClaim, setEventsByClaim] = useState<Record<string, ClaimEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<string | null>(null);

  // Transfer modal state
  const [transferModal, setTransferModal] = useState<{ claimId: string } | null>(null);
  const [transferBranchId, setTransferBranchId] = useState<string>("");
  const [transferNotes, setTransferNotes] = useState<string>("");
  const [transferBranches, setTransferBranches] = useState<Branch[]>([]);

  // Reject transfer modal state
  const [rejectModal, setRejectModal] = useState<{ claimId: string } | null>(null);
  const [rejectNotes, setRejectNotes] = useState<string>("");

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

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await claimsApi.list(isManager && selectedBranch ? selectedBranch : undefined, selectedStatus ? (selectedStatus as ClaimStatus) : undefined);
      setClaims(data ?? []);
    } catch {
      setError("No se pudieron cargar los reclamos.");
    } finally {
      setLoading(false);
    }
  }, [isManager, selectedBranch, selectedStatus]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadClaims(); }, []);

  // Sucursales activas: las usa el filtro del gerente y la resolución de nombres
  // en el historial. El dropdown de derivación NO usa esta lista: carga por
  // reclamo solo las sucursales del recorrido (ver handleOpenTransferModal).
  useEffect(() => {
    branchApi.listActive().then(setBranches).catch(() => {});
  }, []);

  // If route includes a claim id, open it on load
  const { id: routeClaimId } = useParams();
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  useEffect(() => {
    if (routeClaimId) {
      setOpenClaimId(routeClaimId);
      void loadClaimEvents(routeClaimId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeClaimId]);

  // Resuelve el ID de una sucursal a su nombre usando las sucursales ya
  // cargadas (las del filtro de manager o las del dropdown de derivación).
  // Si no la encuentra, cae al ID para no romper el renglón del historial.
  const branchName = (id?: string): string => {
    if (!id) return "";
    return [...transferBranches, ...branches].find((b) => b.id === id)?.name ?? id;
  };

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
  }, [isManager, selectedBranch, selectedStatus, loadClaims]);

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

  const handleAddComment = async (id: string) => {
    const comment = (commentDraft[id] ?? "").trim();
    if (comment.length < 3) return;
    setBusyId(id);
    try {
      await claimsApi.addComment(id, comment);
      setCommentDraft((prev) => ({ ...prev, [id]: "" }));
      await loadClaimEvents(id, true);
    } catch {
      setError("No se pudo agregar el comentario.");
    } finally {
      setBusyId(null);
    }
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

  const handleOpenTransferModal = (claimId: string) => {
    setTransferBranchId("");
    setTransferNotes("");
    setTransferBranches([]);
    setTransferModal({ claimId });
    // Solo se puede derivar a las sucursales del recorrido del envío
    // (origen, intermedias y destino), excluyendo la sucursal actual.
    claimsApi.transferBranches(claimId).then(setTransferBranches).catch(() => {
      setError("No se pudieron cargar las sucursales del recorrido.");
    });
  };

  const handleTransfer = async () => {
    if (!transferModal) return;
    setBusyId(transferModal.claimId);
    try {
      const updated = await claimsApi.transfer(transferModal.claimId, transferBranchId, transferNotes);
      setClaims((prev) => prev.map((c) => (c.id === transferModal.claimId ? updated : c)));
      await loadClaimEvents(transferModal.claimId, true);
      setTransferModal(null);
    } catch {
      setError("No se pudo derivar el reclamo a la sucursal.");
    } finally {
      setBusyId(null);
    }
  };

  const handleAcceptTransfer = (claimId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: "Aceptar reclamo",
      message: "¿Confirmás que tu sucursal acepta la gestión de este reclamo?",
      confirmLabel: "Sí, aceptar",
      cancelLabel: "Cancelar",
      variant: "default",
      onConfirm: () => {
        setConfirmDialog(null);
        setBusyId(claimId);
        (async () => {
          try {
            const updated = await claimsApi.acceptTransfer(claimId);
            setClaims((prev) => prev.map((c) => (c.id === claimId ? updated : c)));
            await loadClaimEvents(claimId, true);
          } catch {
            setError("No se pudo aceptar el reclamo.");
          } finally {
            setBusyId(null);
          }
        })();
      },
    });
  };

  const handleOpenRejectModal = (claimId: string) => {
    setRejectNotes("");
    setRejectModal({ claimId });
  };

  const handleRejectTransfer = async () => {
    if (!rejectModal) return;
    setBusyId(rejectModal.claimId);
    try {
      await claimsApi.rejectTransfer(rejectModal.claimId, rejectNotes);
      setRejectModal(null);
      // Al rechazar, el reclamo deja de estar asignado a esta sucursal
      // (AssignedBranchID = ""), por lo que pedir su historial devolvería 403.
      // Recargamos la lista ya re-scopeada en vez de refrescar los eventos.
      await loadClaims();
    } catch {
      setError("No se pudo rechazar el reclamo.");
    } finally {
      setBusyId(null);
    }
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
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[var(--sidebar-bg)] hover:bg-[#15294a] text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        }
      />

      {isManager && (
        <Card className="p-5 mb-4 dark:border-gray-700 border-slate-200 shadow-sm bg-gradient-to-br from-white via-white to-slate-50/80">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sidebar-bg)]">Panel gerencial</p>
                <h3 className="mt-1 text-base font-semibold dark:text-gray-100 text-slate-900">Métricas de reclamos</h3>
                <p className="mt-1 text-sm dark:text-gray-400 text-slate-500">Resumen dinámico sobre el conjunto filtrado.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold dark:text-gray-400 text-slate-600">Sucursal</label>
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="h-10 min-w-[180px] rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white px-3 text-sm dark:text-gray-100 text-slate-900 shadow-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10"
                  >
                    <option value="">Todas</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold dark:text-gray-400 text-slate-600">Estado</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="h-10 min-w-[180px] rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white px-3 text-sm dark:text-gray-100 text-slate-900 shadow-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10"
                  >
                    <option value="">Todos</option>
                    {Object.keys(CLAIM_STATUS_LABELS).map((s) => (
                      <option key={s} value={s}>{CLAIM_STATUS_LABELS[s as ClaimStatus]}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold dark:text-gray-400 text-slate-600">ID reclamo</label>
                  <input
                    value={selectedClaimId}
                    onChange={(e) => setSelectedClaimId(e.target.value)}
                    placeholder="Buscar por ID"
                    className="h-10 min-w-[200px] rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white px-3 text-sm dark:text-gray-100 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-2xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider dark:text-gray-400 text-slate-500">Total de reclamos</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight dark:text-gray-100 text-slate-900">{visibleMetrics.total}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)]">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs dark:text-gray-400 text-slate-500">Registros que entran en el filtro actual.</p>
              </div>

              <div className="rounded-2xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider dark:text-gray-400 text-slate-500">Reclamos abiertos</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight dark:text-gray-100 text-slate-900">{visibleMetrics.open}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <Clock3 className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs dark:text-gray-400 text-slate-500">Casos que siguen activos.</p>
              </div>

              <div className="rounded-2xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider dark:text-gray-400 text-slate-500">Reclamos cerrados</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight dark:text-gray-100 text-slate-900">{visibleMetrics.closed}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <BadgeCheck className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs dark:text-gray-400 text-slate-500">Casos resueltos o finalizados.</p>
              </div>

              <div className="rounded-2xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider dark:text-gray-400 text-slate-500">Pendientes de revisión</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight dark:text-gray-100 text-slate-900">{visibleMetrics.pending_review}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs dark:text-gray-400 text-slate-500">En estado pendiente del cliente.</p>
              </div>

              <div className="rounded-2xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider dark:text-gray-400 text-slate-500">Resueltos este mes</p>
                    <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight dark:text-gray-100 text-slate-900">{visibleMetrics.resolved_this_month}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                    <RefreshCw className="h-5 w-5" />
                  </div>
                </div>
                <p className="mt-2 text-xs dark:text-gray-400 text-slate-500">Tasa de resolución: {visibleResolutionRate}%</p>
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
          <p className="text-sm dark:text-gray-400 text-slate-500">Cargando…</p>
        </Card>
      ) : visibleClaims.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-base font-semibold dark:text-gray-300 text-slate-700">No hay reclamos registrados</p>
          <p className="mt-1 text-sm dark:text-gray-400 text-slate-500">Los reclamos aparecerán cuando un cliente los genere desde tracking.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleClaims.map((claim) => (
            <Card key={claim.id} className="overflow-hidden rounded-2xl dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white shadow-sm">
              <details
                open={openClaimId === claim.id || undefined}
                onToggle={(e) => {
                  const opened = (e.currentTarget as HTMLDetailsElement).open;
                  setOpenClaimId(opened ? claim.id : null);
                  if (opened) void loadClaimEvents(claim.id);
                }}
              >
                <summary
                  className="cursor-pointer list-none px-5 py-[18px] border-b dark:border-gray-700 border-slate-200 bg-gradient-to-b from-white to-slate-50"
                >
                  <div className="flex flex-wrap gap-3 items-center justify-between">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="text-xs font-extrabold tracking-wide uppercase dark:text-gray-100 text-slate-900 bg-[var(--sidebar-bg)]/[0.08] px-2 py-0.5 rounded-full">
                          {claim.id}
                        </span>
                        <span className="text-xs dark:text-gray-500 text-slate-400">Envío {claim.tracking_id}</span>
                      </div>
                      <div className="text-xs dark:text-gray-400 text-slate-500">
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
                  <div className="grid gap-2 text-xs dark:text-gray-300 text-slate-700 leading-relaxed">
                    <div><strong>Creado por:</strong> {claim.created_by}</div>
                    <div><strong>Descripción:</strong> {claim.description}</div>
                    <div><strong>Creado:</strong> {fmtDateTime(claim.created_at)}</div>
                    <div><strong>Actualizado:</strong> {fmtDateTime(claim.updated_at)}</div>
                    <div><strong>Resolución:</strong> {claim.resolution_type ? CLAIM_STATUS_LABELS[claim.status] : "Pendiente"}</div>
                    <div><strong>Automático:</strong> {claim.is_automatic ? "Sí" : "No"}</div>
                  </div>

                  {claim.evidence_file_name && (
                    <div className="flex flex-wrap gap-3 items-center justify-between border dark:border-gray-700 border-slate-200 rounded-2xl px-4 py-3.5 dark:bg-gray-800/50 bg-slate-50">
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold dark:text-gray-400 text-slate-500 uppercase tracking-wide">Evidencia adjunta</div>
                        <div className="text-sm font-bold dark:text-gray-100 text-slate-900 break-words">{claim.evidence_file_name}</div>
                        {claim.evidence_upload_date && (
                          <div className="text-xs dark:text-gray-400 text-slate-500">Subida el {fmtDateTime(claim.evidence_upload_date)}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadEvidence(claim.id, claim.evidence_file_name ?? "evidencia")}
                        className="bg-gradient-to-b from-[var(--sidebar-bg)] to-[#162b49] text-white border-none rounded-xl px-3.5 py-2.5 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(30,58,95,0.14)] inline-flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Descargar evidencia
                      </button>
                    </div>
                  )}

                  {isSupervisor && (() => {
                    const isTerminal = String(claim.status).startsWith("resolved_");
                    const isTransferred = claim.status === "transferred";
                    const isReceivedTransfer = isTransferred && claim.assigned_branch_id === myBranchId;
                    return (
                      <div className="grid gap-3 border-t dark:border-gray-700 border-slate-200 pt-4">
                        {/* Comentario interno — disponible en cualquier estado */}
                        <div className="grid gap-2">
                          <label className="text-xs dark:text-gray-400 text-slate-500 font-bold uppercase tracking-wide">Comentario interno</label>
                          <textarea
                            value={commentDraft[claim.id] ?? ""}
                            onChange={(e) => setCommentDraft((prev) => ({ ...prev, [claim.id]: e.target.value }))}
                            rows={2}
                            maxLength={1000}
                            placeholder="Dejá una nota de seguimiento sobre este reclamo (visible solo internamente)…"
                            className="w-full border dark:border-gray-700 border-slate-200 rounded-xl px-3 py-2.5 text-xs dark:bg-gray-800 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] resize-y"
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleAddComment(claim.id)}
                              disabled={(commentDraft[claim.id] ?? "").trim().length < 3 || busyId === claim.id}
                              className="bg-gradient-to-b from-[var(--sidebar-bg)] to-[#162b49] text-white border-none rounded-xl px-3.5 py-2.5 text-xs font-bold min-h-[42px] cursor-pointer shadow-[0_8px_18px_rgba(30,58,95,0.14)] disabled:opacity-55"
                            >
                              Agregar comentario
                            </button>
                          </div>
                        </div>

                        {isTransferred ? (
                          <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400 font-semibold">
                            <SendHorizonal className="w-4 h-4 shrink-0" />
                            Reclamo derivado a otra sucursal — las acciones no están disponibles hasta que sea aceptado o rechazado.
                          </div>
                        ) : !isTerminal ? (
                          <div className="flex flex-wrap gap-2.5 items-center">
                            <span className="text-xs dark:text-gray-400 text-slate-500 font-bold uppercase tracking-wide">Resolver</span>
                            {RESOLUTION_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => handleResolve(claim.id, opt.value)}
                                disabled={busyId === claim.id}
                                className="bg-amber-50 dark:text-gray-100 text-slate-900 border border-amber-200 rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)] disabled:opacity-60"
                              >
                                {opt.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
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
                              disabled={busyId === claim.id}
                              className="bg-gradient-to-b from-sky-500 to-sky-600 text-white border-none rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(14,165,233,0.18)] disabled:opacity-60"
                            >
                              Solicitar más info
                            </button>
                            {(claim.status === "open" || claim.status === "pending_customer") && (
                              <button
                                type="button"
                                onClick={() => handleMarkInReview(claim.id)}
                                disabled={busyId === claim.id}
                                className="bg-gradient-to-b from-blue-600 to-blue-700 text-white border-none rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(37,99,235,0.18)] disabled:opacity-60"
                              >
                                {claim.status === "open" ? "Tomar reclamo" : "Pasar a revisión"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenTransferModal(claim.id)}
                              disabled={busyId === claim.id}
                              className="bg-gradient-to-b from-violet-600 to-violet-700 text-white border-none rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(124,58,237,0.18)] disabled:opacity-60 inline-flex items-center gap-1.5"
                            >
                              <SendHorizonal className="w-3.5 h-3.5" />
                              Derivar a sucursal
                            </button>
                          </div>
                        ) : null}

                        {/* Aceptar / Rechazar — supervisor de la sucursal receptora */}
                        {isReceivedTransfer && (
                          <div className="flex flex-wrap gap-2.5 items-center border-t dark:border-gray-700 border-slate-200 pt-3">
                            <span className="text-xs dark:text-gray-400 text-slate-500 font-bold uppercase tracking-wide">Reclamo derivado a tu sucursal</span>
                            <button
                              type="button"
                              onClick={() => handleAcceptTransfer(claim.id)}
                              disabled={busyId === claim.id}
                              className="bg-gradient-to-b from-emerald-600 to-emerald-700 text-white border-none rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(5,150,105,0.18)] disabled:opacity-60"
                            >
                              Aceptar reclamo
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenRejectModal(claim.id)}
                              disabled={busyId === claim.id}
                              className="bg-gradient-to-b from-rose-500 to-rose-600 text-white border-none rounded-full px-3.5 py-2 text-xs font-bold cursor-pointer shadow-[0_8px_18px_rgba(244,63,94,0.18)] disabled:opacity-60"
                            >
                              Rechazar reclamo
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="border-t dark:border-gray-700 border-slate-200 pt-4">
                    <details>
                      <summary className="cursor-pointer text-xs font-extrabold dark:text-gray-400 text-slate-500 mb-2 uppercase tracking-wide">
                        Historial del reclamo
                      </summary>
                      <div className="mt-2">
                        {eventsLoadingId === claim.id ? (
                          <p className="m-0 text-xs dark:text-gray-500 text-slate-400">Cargando historial…</p>
                        ) : (eventsByClaim[claim.id]?.length ?? 0) === 0 ? (
                          <p className="m-0 text-xs dark:text-gray-500 text-slate-400">Sin eventos registrados.</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {[...(eventsByClaim[claim.id] ?? [])].reverse().map((ev) => (
                              <div
                                key={ev.id}
                                className="border dark:border-gray-700 border-slate-200 rounded-lg px-2.5 py-2 text-xs dark:bg-gray-800/50 bg-slate-50"
                              >
                                <div className="flex justify-between gap-2 mb-1">
                                  <span className="font-semibold dark:text-gray-100 text-slate-900">
                                    {CLAIM_EVENT_LABELS[ev.event_type] ?? ev.event_type}
                                  </span>
                                  <span className="dark:text-gray-500 text-slate-400 whitespace-nowrap">{fmtDateTime(ev.timestamp)}</span>
                                </div>
                                {ev.notes && <div className="dark:text-gray-400 text-slate-500">{ev.notes}</div>}
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
                                      <Paperclip size={14} className="inline mr-1" /> Descargar adjunto: {ev.evidence_file_name}
                                    </button>
                                  </div>
                                )}
                                <div className="dark:text-gray-400 text-slate-500 text-xs mt-1">
                                  por <strong>{formatChangedBy(ev.changed_by)}</strong>
                                  {ev.from_status && ev.to_status && (
                                    <span> · {CLAIM_STATUS_LABELS[ev.from_status]} → {CLAIM_STATUS_LABELS[ev.to_status]}
                                      {ev.event_type === "claim_transferred" && ev.target_branch_id && (
                                        <> {branchName(ev.target_branch_id)}</>
                                      )}
                                    </span>
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

      {/* Modal: Derivar a sucursal */}
      {transferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5">
            <h2 className="text-base font-bold dark:text-gray-100 text-slate-900">Derivar reclamo a otra sucursal</h2>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wide">Sucursal destino</label>
              <select
                value={transferBranchId}
                onChange={(e) => setTransferBranchId(e.target.value)}
                className="h-10 rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white px-3 text-sm dark:text-gray-100 text-slate-900 shadow-sm outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10"
              >
                <option value="">Seleccionar sucursal</option>
                {transferBranches
                  .filter((b) => b.id !== myBranchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
              </select>
              {transferBranches.filter((b) => b.id !== myBranchId).length === 0 && (
                <p className="text-xs dark:text-gray-400 text-slate-500">
                  No hay otras sucursales en el recorrido de este envío para derivar.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wide">
                Motivo de la derivación
              </label>
              <textarea
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                rows={3}
                placeholder="Mínimo 15 caracteres…"
                className="rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-slate-900 shadow-sm outline-none resize-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10"
              />
              {transferNotes.length > 0 && transferNotes.length < 15 && (
                <p className="text-xs text-rose-500">El motivo debe tener al menos 15 caracteres ({transferNotes.length}/15).</p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setTransferModal(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold dark:text-gray-300 text-slate-700 border dark:border-gray-700 border-slate-200 hover:bg-slate-50 dark:hover:bg-gray-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleTransfer}
                disabled={!transferBranchId || transferNotes.length < 15 || busyId === transferModal.claimId}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white transition disabled:opacity-50"
              >
                Confirmar derivación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Rechazar derivación */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5">
            <h2 className="text-base font-bold dark:text-gray-100 text-slate-900">Rechazar reclamo derivado</h2>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wide">
                Motivo del rechazo
              </label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                placeholder="Mínimo 15 caracteres…"
                className="rounded-xl border dark:border-gray-700 border-slate-200 dark:bg-gray-800 bg-white px-3 py-2 text-sm dark:text-gray-100 text-slate-900 shadow-sm outline-none resize-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-[var(--brand)]/10"
              />
              {rejectNotes.length > 0 && rejectNotes.length < 15 && (
                <p className="text-xs text-rose-500">El motivo debe tener al menos 15 caracteres ({rejectNotes.length}/15).</p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setRejectModal(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold dark:text-gray-300 text-slate-700 border dark:border-gray-700 border-slate-200 hover:bg-slate-50 dark:hover:bg-gray-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRejectTransfer}
                disabled={rejectNotes.length < 15 || busyId === rejectModal.claimId}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50"
              >
                Confirmar rechazo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
