import { useCallback, useEffect, useState } from "react";
import { Plus, Search, AlertCircle, Filter } from "lucide-react";
import { AddressAutocomplete } from "../components/AddressAutocomplete";
import { branchApi, type Branch, type BranchCapacity, type CreateBranchPayload, type UpdateBranchPayload, statusLabel } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { fmtDateTime } from "../utils/date";
import { TopbarActions } from "../components/topbarContext";
import { Card } from "../components/ui/card";

const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes",
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza",
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const STATUS_OPTIONS: { value: Branch["status"]; label: string }[] = [
  { value: "activo", label: "Activo" },
  { value: "inactivo", label: "Inactivo" },
  { value: "fuera_de_servicio", label: "Fuera de servicio" },
];

type SortKey = "name" | "city" | "province" | "status" | "updated_at";

export function BranchList() {
  const isMobile = useIsMobile();
  const { hasRole } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [statusModal, setStatusModal] = useState<Branch | null>(null);
  const [error, setError] = useState("");

  const isAdmin = hasRole("admin");
  const canViewCapacity = hasRole("supervisor", "manager", "admin");

  const [capacities, setCapacities] = useState<Record<string, BranchCapacity>>({});

  const loadBranches = useCallback(async () => {
    try {
      const data = await branchApi.list();
      setBranches(data);
      if (canViewCapacity) {
        const caps = await Promise.all(
          data.map((b) => branchApi.getCapacity(b.id).catch(() => null))
        );
        const map: Record<string, BranchCapacity> = {};
        caps.forEach((c) => { if (c) map[c.branch_id] = c; });
        setCapacities(map);
      }
    } catch {
      setError("No se pudieron cargar las sucursales.");
    } finally {
      setLoading(false);
    }
  }, [canViewCapacity]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  const filtered = branches
    .filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (search) {
        if (!search.trim()) return false;
        const q = search.toLowerCase();
        return (
          b.name.toLowerCase().includes(q) ||
          b.id.toLowerCase().includes(q) ||
          b.address.city.toLowerCase().includes(q) ||
          b.address.street.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "city": cmp = a.address.city.localeCompare(b.address.city); break;
        case "province": cmp = (a.province || "").localeCompare(b.province || ""); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "updated_at": cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(); break;
      }
      return sortAsc ? cmp : -cmp;
    });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div className={`${isMobile ? "p-4" : "p-6 md:px-8"} max-w-[1200px] mx-auto`}>
      {isAdmin && (
        <TopbarActions>
          <button
            onClick={() => { setShowCreate(true); setError(""); }}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nueva sucursal
          </button>
        </TopbarActions>
      )}

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              className="w-full pl-9 h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb]"
              placeholder="Buscar por nombre, ID, ciudad o dirección…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-[3px] focus:ring-[#2563eb]/20 focus:border-[#2563eb]"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </Card>

      {error && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Filter className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-base font-semibold text-slate-700">No se encontraron sucursales</p>
          <p className="mt-1 text-sm text-slate-500">
            {branches.length === 0 ? "No hay sucursales registradas en el sistema." : search.trim() === "" ? "Ingresá un término de búsqueda para continuar." : "Intentá ajustar la búsqueda o los filtros."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--border)]">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider"><button onClick={() => handleSort("name")} className="bg-transparent border-none cursor-pointer text-inherit font-semibold text-xs uppercase tracking-wider p-0">Nombre{sortIcon("name")}</button></th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider"><button onClick={() => handleSort("city")} className="bg-transparent border-none cursor-pointer text-inherit font-semibold text-xs uppercase tracking-wider p-0">Ubicación{sortIcon("city")}</button></th>
                <th className={isMobile ? "hidden" : "px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider"}>Dirección</th>
                <th className={isMobile ? "hidden" : "px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider"}>Horarios</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider"><button onClick={() => handleSort("status")} className="bg-transparent border-none cursor-pointer text-inherit font-semibold text-xs uppercase tracking-wider p-0">Estado{sortIcon("status")}</button></th>
                {canViewCapacity && <th className={isMobile ? "hidden" : "px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider"}>Capacidad</th>}
                <th className={isMobile ? "hidden" : "px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider"}><button onClick={() => handleSort("updated_at")} className="bg-transparent border-none cursor-pointer text-inherit font-semibold text-xs uppercase tracking-wider p-0">Actualizado{sortIcon("updated_at")}</button></th>
                {isAdmin && <th className="px-3 py-2.5 text-left text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2.5 align-middle">
                    <div className="font-semibold">{b.name}</div>
                  </td>
                  <td className="px-3 py-2.5 align-middle">{b.address.city}, {b.province}</td>
                  <td className={isMobile ? "hidden" : "px-3 py-2.5 align-middle"}>{b.address.street}</td>
                  <td className={isMobile ? "hidden" : `px-3 py-2.5 align-middle text-[13px] ${b.hours ? "text-[var(--text-strong)]" : "text-[var(--text-muted)]"}`}>
                    {b.hours || "—"}
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border border-transparent ${
                      b.status === "activo"
                        ? "bg-green-600 text-white dark:bg-green-500/20 dark:text-green-300 dark:border-green-500/40"
                        : b.status === "inactivo"
                        ? "bg-gray-500 text-white dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-500/40"
                        : "bg-red-600 text-white dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40"
                    }`}>
                      {statusLabel(b.status)}
                    </span>
                  </td>
                  {canViewCapacity && (
                    <td className={isMobile ? "hidden" : "px-3 py-2.5 align-middle"}>
                      <CapacityIndicator cap={capacities[b.id]} />
                    </td>
                  )}
                  <td className={isMobile ? "hidden" : "px-3 py-2.5 align-middle"}>
                    <div className="text-xs">{fmtDateTime(b.updated_at)}</div>
                    {b.updated_by && <div className="text-[11px] text-[var(--text-muted)]">por {b.updated_by}</div>}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex gap-1.5">
                        <button onClick={() => { setEditing(b); setError(""); }}
                          disabled={b.status !== "activo"}
                          className={`bg-[var(--bg-muted)] border border-[var(--border-strong)] rounded px-2.5 py-1 cursor-pointer text-xs font-medium ${b.status !== "activo" ? "opacity-40" : ""}`}
                          title={b.status !== "activo" ? "No se puede editar una sucursal inactiva" : "Editar datos"}
                        >
                          Editar
                        </button>
                        <button onClick={() => { setStatusModal(b); setError(""); }}
                          className="bg-[var(--bg-muted)] border border-[var(--border-strong)] rounded px-2.5 py-1 cursor-pointer text-xs font-medium">
                          Estado
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Create Modal */}
      {showCreate && (
        <BranchFormModal
          title="Nueva sucursal"
          submitLabel="Crear"
          onClose={() => setShowCreate(false)}
          onSubmit={async (data) => {
            await branchApi.create(data);
            setShowCreate(false);
            await loadBranches();
          }}
          error={error}
        />
      )}

      {/* Edit Modal */}
      {editing && (
        <BranchFormModal
          title="Editar sucursal"
          submitLabel="Guardar"
          initial={editing}
          currentCapacity={capacities[editing.id]}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            await branchApi.update(editing.id, data);
            setEditing(null);
            await loadBranches();
          }}
          error={error}
        />
      )}

      {/* Status Modal */}
      {statusModal && (
        <StatusModal
          branch={statusModal}
          onClose={() => setStatusModal(null)}
          onSubmit={async (status) => {
            await branchApi.updateStatus(statusModal.id, status);
            setStatusModal(null);
            await loadBranches();
          }}
          error={error}
        />
      )}
    </div>
  );
}

// ─── Capacity Indicator ───────────────────────────────────────────────────────

function CapacityIndicator({ cap }: { cap?: BranchCapacity }) {
  if (!cap) {
    return <span className="text-xs text-[var(--text-muted)]">—</span>;
  }

  const pct = Math.min(cap.percentage, 100);

  return (
    <div className="min-w-[120px]">
      <div className="flex justify-between items-center mb-0.5">
        <span className={`text-xs font-semibold ${cap.alert ? "text-[var(--danger-text)]" : "text-[var(--text-strong)]"}`}>
          {cap.current} / {cap.max_capacity} bultos
        </span>
        {cap.alert && (
          <span className="text-[11px] text-[var(--danger-text)] font-bold ml-1">⚠</span>
        )}
      </div>
      <div className="bg-[var(--bg-muted)] rounded h-1.5 overflow-hidden">
        <div className={`h-full rounded transition-[width] duration-300 ${
          cap.alert
            ? "bg-[var(--danger-c)]"
            : pct >= 60
            ? "bg-[var(--warn)]"
            : "bg-[var(--ok)]"
        }`} style={{ width: `${pct}%` }} />
      </div>
      <div className={`text-[11px] mt-0.5 ${cap.alert ? "text-[var(--danger-text)]" : "text-[var(--text-secondary)]"}`}>
        {Math.round(pct)}% ocupado
      </div>
    </div>
  );
}

// ─── Branch Form Modal (Create / Edit) ────────────────────────────────────────

function BranchFormModal({
  title, submitLabel, initial, currentCapacity, onClose, onSubmit, error,
}: {
  title: string;
  submitLabel: string;
  initial?: Branch;
  currentCapacity?: BranchCapacity;
  onClose: () => void;
  onSubmit: (data: CreateBranchPayload | UpdateBranchPayload) => Promise<void>;
  error: string;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    id: initial?.id ?? "",
    name: initial?.name ?? "",
    street: initial?.address.street ?? "",
    city: initial?.address.city ?? "",
    province: initial?.province ?? initial?.address.province ?? "",
    postal_code: initial?.address.postal_code ?? "",
    max_capacity: initial?.max_capacity ?? 50,
    hours: initial?.hours ?? "",
  });
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const validate = () => {
    if (!form.name.trim()) { setLocalError("El nombre es obligatorio."); return false; }
    if (!form.street.trim()) { setLocalError("La calle es obligatoria."); return false; }
    if (!form.city.trim()) { setLocalError("La ciudad es obligatoria."); return false; }
    if (!form.province) { setLocalError("La provincia es obligatoria."); return false; }
    if (!form.postal_code.trim()) { setLocalError("El código postal es obligatorio."); return false; }
    if (form.max_capacity < 1) { setLocalError("La capacidad debe ser al menos 1."); return false; }
    return true;
  };

  const doSubmit = async () => {
    setSubmitting(true);
    setLocalError("");
    try {
      await onSubmit(form);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setLocalError(msg ?? "La operación falló. Intentá de nuevo.");
      setStep("form");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    if (isEdit && initial && form.max_capacity !== initial.max_capacity) {
      setStep("confirm");
      return;
    }
    await doSubmit();
  };

  if (step === "confirm" && initial) {
    const currentCount = currentCapacity?.current ?? 0;
    const newPct = Math.round((currentCount / form.max_capacity) * 100);
    const overCapacity = currentCount > form.max_capacity;

    return (
      <Modal onClose={onClose}>
        <h2 className="m-0 mb-5 text-lg">Confirmar cambio de capacidad</h2>
        <div className="grid gap-3">
          <div className="p-3.5 bg-[var(--bg-subtle)] rounded-lg border border-[var(--border)]">
            <div className="font-semibold mb-2">{form.name || initial.name}</div>
            <div className="text-xs text-[var(--text-secondary)] grid gap-1.5">
              <div className="flex justify-between">
                <span>Bultos actuales en el almacén:</span>
                <strong className="text-[var(--text-strong)]">{currentCount} bultos</strong>
              </div>
              <div className="flex justify-between">
                <span>Capacidad anterior:</span>
                <span>{initial.max_capacity} bultos</span>
              </div>
              <div className="flex justify-between">
                <span>Nueva capacidad:</span>
                <strong className="text-[var(--text-heading)]">{form.max_capacity} bultos</strong>
              </div>
              <div className="flex justify-between">
                <span>Ocupación con nueva capacidad:</span>
                <strong className={overCapacity ? "text-[var(--danger-text)]" : newPct >= 80 ? "text-[var(--warn-text)]" : "text-[var(--ok-text)]"}>
                  {newPct}%
                </strong>
              </div>
            </div>
          </div>
          {overCapacity && (
            <div className="px-3.5 py-2.5 bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-lg text-xs text-[var(--danger-text)] flex gap-2 items-start">
              <span className="font-bold shrink-0">⚠</span>
              <span>La nueva capacidad ({form.max_capacity}) es menor que los bultos actuales ({currentCount}). El almacén quedaría con exceso de carga.</span>
            </div>
          )}
          {!overCapacity && newPct >= 80 && (
            <div className="px-3.5 py-2.5 bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg text-xs text-[var(--warn-text)] flex gap-2 items-start">
              <span className="font-bold shrink-0">⚠</span>
              <span>Con esta capacidad, el almacén quedaría al {newPct}% de ocupación.</span>
            </div>
          )}
          {(localError || error) && <p className="text-[var(--danger-c)] m-0 text-xs">{localError || error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            <button type="button" onClick={() => setStep("form")} className="bg-[var(--bg-card)] text-[var(--text-strong)] border border-[var(--border-strong)] rounded-md px-[18px] py-2 cursor-pointer font-medium text-sm disabled:opacity-50" disabled={submitting}>Volver</button>
            <button type="button" onClick={doSubmit} disabled={submitting} className="bg-[#1e3a5f] text-white border-none rounded-md px-[18px] py-2 cursor-pointer font-semibold text-sm disabled:opacity-70">
              {submitting ? "Guardando..." : "Confirmar cambio"}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="m-0 mb-5 text-lg">{title}</h2>
      <form onSubmit={handleSubmit} className="grid gap-[14px]">
        {!isEdit && (
          <Field label="ID (opcional — se genera automáticamente si se deja vacío)">
            <input className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border" value={form.id} onChange={(e) => set("id", e.target.value)} placeholder="ej. caba-02" />
          </Field>
        )}
        <Field label="Nombre *">
          <input className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="ej. CDBA-02" />
        </Field>
        <Field label="Calle *">
          <AddressAutocomplete className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border" required value={form.street}
            onChange={(v) => set("street", v)}
            onAddressSelect={(p) => {
              if (p.street) set("street", p.street);
              if (p.city) set("city", p.city);
              if (p.province) set("province", p.province);
              if (p.postal_code) set("postal_code", p.postal_code);
            }}
            placeholder="Av. Corrientes 1234, Rosario" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ciudad *">
            <input className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border" required value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Buenos Aires" />
          </Field>
          <Field label="Provincia *">
            <select className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border" required value={form.province} onChange={(e) => set("province", e.target.value)}>
              <option value="">Seleccioná...</option>
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código postal *">
            <input className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border" required value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} placeholder="C1043" />
          </Field>
          <Field label="Capacidad máxima (bultos) *">
            <input
              className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border"
              type="number"
              min={1}
              required
              value={form.max_capacity}
              onChange={(e) => setForm((prev) => ({ ...prev, max_capacity: Math.max(1, parseInt(e.target.value) || 1) }))}
            />
          </Field>
        </div>
        <Field label="Horarios de atención">
          <input
            className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border"
            value={form.hours}
            onChange={(e) => set("hours", e.target.value)}
            placeholder="ej. Lunes a Viernes 9:00-18:00hs"
          />
        </Field>
        {(localError || error) && <p className="text-[var(--danger-c)] m-0 text-xs">{localError || error}</p>}
        <div className="flex gap-2 justify-end mt-2">
          <button type="button" onClick={onClose} className="bg-[var(--bg-card)] text-[var(--text-strong)] border border-[var(--border-strong)] rounded-md px-[18px] py-2 cursor-pointer font-medium text-sm disabled:opacity-50" disabled={submitting}>Cancelar</button>
          <button type="submit" disabled={submitting} className="bg-[#1e3a5f] text-white border-none rounded-md px-[18px] py-2 cursor-pointer font-semibold text-sm disabled:opacity-70">
            {submitting ? "Guardando..." : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Status Modal ─────────────────────────────────────────────────────────────

function StatusModal({
  branch, onClose, onSubmit, error,
}: {
  branch: Branch;
  onClose: () => void;
  onSubmit: (status: Branch["status"]) => Promise<void>;
  error: string;
}) {
  const [status, setStatus] = useState(branch.status);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalError("");
    try {
      await onSubmit(status);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setLocalError(msg ?? "No se pudo actualizar el estado.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2 className="m-0 mb-5 text-lg">Cambiar estado</h2>
      <div className="mb-4 p-3 bg-[var(--bg-subtle)] rounded-lg">
        <strong>{branch.name}</strong> <span className="text-[var(--text-muted)]">— {branch.address.city}</span>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
          Estado actual: <span className={`font-semibold ${
            branch.status === "activo" ? "text-green-600" : branch.status === "inactivo" ? "text-gray-500" : "text-red-600"
          }`}>{statusLabel(branch.status)}</span>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="grid gap-[14px]">
        <Field label="Nuevo estado">
          <select className="px-2.5 py-2 rounded-md border border-[var(--border-strong)] text-sm w-full box-border" value={status} onChange={(e) => setStatus(e.target.value as Branch["status"])}>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {(localError || error) && <p className="text-[var(--danger-c)] m-0 text-xs">{localError || error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="bg-[var(--bg-card)] text-[var(--text-strong)] border border-[var(--border-strong)] rounded-md px-[18px] py-2 cursor-pointer font-medium text-sm disabled:opacity-50" disabled={submitting}>Cancelar</button>
          <button type="submit" disabled={submitting} className="bg-[#1e3a5f] text-white border-none rounded-md px-[18px] py-2 cursor-pointer font-semibold text-sm disabled:opacity-70">
            {submitting ? "Guardando..." : "Actualizar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-xl px-7 py-6 max-w-[520px] w-full max-h-[90vh] overflow-auto shadow-[0_20px_60px_rgba(0,0,0,0.2)]" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <label className="text-xs font-semibold text-[var(--text-strong)]">{label}</label>
      {children}
    </div>
  );
}
