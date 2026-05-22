import { useEffect, useState } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
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
    onConfirm: () => void;
    variant?: "default" | "danger";
  } | null>(null);

  const loadClaims = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await claimsApi.list();
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
      onConfirm: async () => {
        setConfirmDialog(null);
        setBusyId(id);
        try {
          const updated = await claimsApi.updateCategory(id, nextCategory);
          setClaims((prev) => prev.map((c) => (c.id === id ? updated : c)));
          await loadClaimEvents(id, true);
        } catch {
          setError("No se pudo actualizar la categoría del reclamo.");
        } finally {
          setBusyId(null);
        }
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
      onConfirm: async () => {
        setConfirmDialog(null);
        setBusyId(id);
        try {
          const updated = await claimsApi.resolve(id, resolution);
          setClaims((prev) => prev.map((c) => (c.id === id ? updated : c)));
          await loadClaimEvents(id, true);
        } catch {
          setError("No se pudo resolver el reclamo.");
        } finally {
          setBusyId(null);
        }
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

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : claims.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-base font-semibold text-slate-700">No hay reclamos registrados</p>
          <p className="mt-1 text-sm text-slate-500">Los reclamos aparecerán cuando un cliente los genere desde tracking.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {claims.map((claim) => (
            <Card key={claim.id} className="p-4">
              <details
                onToggle={(e) => {
                  if ((e.currentTarget as HTMLDetailsElement).open) {
                    void loadClaimEvents(claim.id);
                  }
                }}
              >
                <summary style={{ cursor: "pointer", listStyle: "none" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 700, color: "#1e3a5f" }}>{claim.id}</div>
                      <div style={{ fontSize: 13, color: "#64748b" }}>
                        Envío {claim.tracking_id} · {CLAIM_TYPE_LABELS[claim.claim_type]}
                      </div>
                    </div>
                    <span style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      ...statusBadgeStyle(claim.status),
                    }}>
                      {CLAIM_STATUS_LABELS[claim.status]}
                    </span>
                  </div>
                </summary>

                <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gap: 6, fontSize: 13, color: "#334155" }}>
                    <div><strong>Creado por:</strong> {claim.created_by}</div>
                    <div><strong>Descripción:</strong> {claim.description}</div>
                    <div><strong>Creado:</strong> {fmtDateTime(claim.created_at)}</div>
                    <div><strong>Actualizado:</strong> {fmtDateTime(claim.updated_at)}</div>
                    <div><strong>Categoría asignada:</strong> {claim.assigned_category ? CATEGORY_OPTIONS.find((c) => c.value === claim.assigned_category)?.label : "Sin asignar"}</div>
                    <div><strong>Resolución:</strong> {claim.resolution_type ? CLAIM_STATUS_LABELS[claim.status] : "Pendiente"}</div>
                    <div><strong>Automático:</strong> {claim.is_automatic ? "Sí" : "No"}</div>
                  </div>

                  <div style={{ display: "grid", gap: 10, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                      <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Derivar a:</label>
                      <select
                        value={categoryDraft[claim.id] ?? ""}
                        onChange={(e) => setCategoryDraft((prev) => ({ ...prev, [claim.id]: e.target.value as ClaimCategory }))}
                        style={{
                          minWidth: 220,
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 13,
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
                        disabled={!categoryDraft[claim.id] || busyId === claim.id}
                        style={{
                          background: "#1e3a5f",
                          color: "#fff",
                          border: "none",
                          borderRadius: 8,
                          padding: "6px 12px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          opacity: !categoryDraft[claim.id] || busyId === claim.id ? 0.6 : 1,
                        }}
                      >
                        Aplicar
                      </button>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>Resolver:</span>
                      {RESOLUTION_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleResolve(claim.id, opt.value)}
                          disabled={busyId === claim.id}
                          style={{
                            background: "#f59e0b",
                            color: "#1e293b",
                            border: "none",
                            borderRadius: 999,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            opacity: busyId === claim.id ? 0.6 : 1,
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                    <details>
                      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>
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
                                    <> · {CLAIM_STATUS_LABELS[ev.from_status]} → {CLAIM_STATUS_LABELS[ev.to_status]}</>
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
        />
      )}
    </div>
  );
}