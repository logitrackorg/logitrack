import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ClipboardList,
  History,
  RotateCcw,
  Settings2,
  UserCog,
  XCircle,
} from "lucide-react";
import {
  metricPermissionsApi,
  type MetricPermissionsMatrix,
  type PermissionAuditLog,
  type PermissionChange,
} from "../api/metricPermissions";
import { adminApi } from "../api/admin";
import { adminResetApi } from "../api/adminReset";
import type { User } from "../api/auth";
import { toast } from "../utils/toast";
import { fmtDateTime } from "../utils/date";

const ROLE_LABELS: Record<string, string> = {
  supervisor: "Supervisor",
  manager: "Gerente",
};

type Tab = "permisos" | "historial";

// ─── User overrides section ───────────────────────────────────────────────────

interface UserOverridesSectionProps {
  /** Role-level matrix — used to determine the "default" for each user's role. */
  matrix: MetricPermissionsMatrix;
  /** Bump to force a re-fetch (e.g., after an admin reset). */
  refreshKey?: number;
}

function UserOverridesSection({ matrix, refreshKey }: UserOverridesSectionProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Record<string, boolean>>>({});
  const [loading, setLoading] = useState(true);
  // inflight tracks "${userId}|${metricId}" cells being saved.
  const [inflight, setInflight] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    Promise.all([
      adminApi.listUsers(),
      metricPermissionsApi.getUserOverrides(),
    ])
      .then(([allUsers, allOverrides]) => {
        setUsers(allUsers.filter((u) => u.role === "supervisor" || u.role === "manager"));
        setOverrides(allOverrides ?? {});
      })
      .catch(() => toast.error("No se pudo cargar las excepciones de usuario"))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  function roleDefault(user: User, metricId: string): boolean {
    return matrix.matrix[user.role]?.[metricId] ?? true;
  }

  function effectiveValue(user: User, metricId: string): boolean {
    const userOverride = overrides[user.id]?.[metricId];
    return userOverride !== undefined ? userOverride : roleDefault(user, metricId);
  }

  function hasOverride(userId: string, metricId: string): boolean {
    return overrides[userId]?.[metricId] !== undefined;
  }

  async function handleToggle(user: User, metricId: string) {
    const key = `${user.id}|${metricId}`;
    if (inflight.has(key)) return;

    const current = effectiveValue(user, metricId);
    const next = !current;
    const defaultVal = roleDefault(user, metricId);
    const shouldDelete = next === defaultVal;

    // Optimistic update.
    setOverrides((prev) => {
      const copy = { ...prev, [user.id]: { ...prev[user.id] } };
      if (shouldDelete) {
        delete copy[user.id][metricId];
      } else {
        copy[user.id][metricId] = next;
      }
      return copy;
    });

    setInflight((s) => new Set(s).add(key));
    try {
      if (shouldDelete) {
        await metricPermissionsApi.deleteUserOverride(user.id, metricId);
      } else {
        await metricPermissionsApi.setUserOverride(user.id, metricId, next);
      }
    } catch {
      // Revert on failure.
      setOverrides((prev) => {
        const copy = { ...prev, [user.id]: { ...prev[user.id] } };
        if (shouldDelete) {
          copy[user.id][metricId] = current; // restore the override that was deleted
        } else {
          delete copy[user.id][metricId]; // undo the set
        }
        return copy;
      });
      toast.error("No se pudo guardar la excepción");
    } finally {
      setInflight((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }

  function displayName(u: User): string {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return full || u.username;
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-slate-400 text-sm">Cargando excepciones…</div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="py-6 text-center text-slate-400 text-sm">
        No hay usuarios supervisores o gerentes para configurar.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <UserCog className="w-4 h-4 text-slate-500 dark:text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
          Excepciones por Usuario
        </h2>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Los cambios aquí sobreescriben la configuración del rol para ese usuario específico.
        Una celda en{" "}
        <span className="font-medium text-amber-600 dark:text-amber-400">ámbar</span>{" "}
        indica una excepción activa. Desmarcá / marcá para volver al valor del rol.
      </p>

      {/* Scroll container — first column is sticky */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <table className="text-sm border-separate border-spacing-0">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-900/40">
              {/* Sticky header cell for user column */}
              <th className="sticky left-0 z-20 bg-slate-50 dark:bg-slate-900/40 border-b border-r border-slate-100 dark:border-slate-700 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 min-w-[180px] whitespace-nowrap">
                Usuario
              </th>
              {matrix.metrics.map((m) => (
                <th
                  key={m.id}
                  className="border-b border-slate-100 dark:border-slate-700 px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[80px]"
                >
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user, idx) => {
              const rowBg =
                idx % 2 === 0
                  ? "bg-white dark:bg-slate-800"
                  : "bg-slate-50/50 dark:bg-slate-800/50";
              return (
                <tr key={user.id}>
                  {/* Sticky user cell */}
                  <td
                    className={`sticky left-0 z-10 ${rowBg} border-b border-r border-slate-100 dark:border-slate-700 last:border-b-0 px-4 py-2.5 whitespace-nowrap`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {displayName(user)}
                      </span>
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          user.role === "manager"
                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                            : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                        }`}
                      >
                        {user.role === "manager" ? "Ger" : "Sup"}
                      </span>
                    </div>
                    {user.branch_id && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {user.branch_id}
                      </span>
                    )}
                  </td>

                  {/* Metric cells */}
                  {matrix.metrics.map((m) => {
                    const key = `${user.id}|${m.id}`;
                    const isOverride = hasOverride(user.id, m.id);
                    const value = effectiveValue(user, m.id);
                    const busy = inflight.has(key);
                    return (
                      <td
                        key={m.id}
                        className={`border-b border-slate-100 dark:border-slate-700 last:border-b-0 px-3 py-2.5 text-center ${rowBg}`}
                      >
                        <label
                          className={`relative inline-flex items-center justify-center cursor-pointer ${
                            busy ? "opacity-50 pointer-events-none" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={value}
                            disabled={busy}
                            onChange={() => handleToggle(user, m.id)}
                            className={`w-4 h-4 rounded cursor-pointer ${
                              isOverride ? "accent-amber-500" : "accent-[var(--sidebar-bg)]"
                            }`}
                          />
                          {isOverride && (
                            <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                          )}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Reset section ────────────────────────────────────────────────────────────

type ResetTarget =
  | { type: "user"; userId: string; userName: string }
  | { type: "all" };

function ResetSection({ onAfterReset }: { onAfterReset?: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<ResetTarget | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    adminApi
      .listUsers()
      .then((all) =>
        setUsers(all.filter((u) => u.role === "supervisor" || u.role === "manager")),
      )
      .catch(() => {});
  }, []);

  function displayName(u: User) {
    const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
    return full || u.username;
  }

  function openConfirm(target: ResetTarget) {
    setConfirmTarget(target);
  }

  async function handleConfirmReset() {
    if (!confirmTarget) return;
    setResetting(true);
    try {
      if (confirmTarget.type === "all") {
        await adminResetApi.resetAll();
        toast.success("Configuración reseteada para todos los usuarios");
      } else {
        await adminResetApi.resetUser(confirmTarget.userId);
        toast.success(`Configuración de ${confirmTarget.userName} reseteada`);
      }
      setConfirmTarget(null);
      setSelectedUserId("");
      onAfterReset?.();
    } catch {
      toast.error("No se pudo resetear la configuración");
    } finally {
      setResetting(false);
    }
  }

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
            Restablecer configuración del dashboard
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Elimina las preferencias de orden y visibilidad de pestañas de un usuario o de
          todos. El usuario verá una notificación la próxima vez que abra el dashboard.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Usuario
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="">Seleccionar usuario…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)} ({u.role === "manager" ? "Gerente" : "Supervisor"})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() =>
              selectedUser &&
              openConfirm({ type: "user", userId: selectedUser.id, userName: displayName(selectedUser) })
            }
            disabled={!selectedUserId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Resetear usuario
          </button>

          <button
            onClick={() => openConfirm({ type: "all" })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Resetear todos los usuarios
          </button>
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !resetting) setConfirmTarget(null);
          }}
        >
          <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-gray-100">
                ¿Estás seguro?
              </h2>
            </div>

            <p className="text-sm text-slate-600 dark:text-gray-300">
              {confirmTarget.type === "all"
                ? "Se restablecerá la configuración de dashboard de todos los supervisores y gerentes a los valores por defecto. Cada usuario verá una notificación al ingresar."
                : `Se restablecerá la configuración de dashboard de ${confirmTarget.userName} a los valores por defecto. Verá una notificación al ingresar.`}
            </p>

            <p className="text-xs text-slate-400 dark:text-gray-500">
              Esta acción no se puede deshacer.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmTarget(null)}
                disabled={resetting}
                className="flex-1 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmReset}
                disabled={resetting}
                className="flex-1 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {resetting ? "Reseteando…" : "Resetear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Permisos tab ─────────────────────────────────────────────────────────────

interface PermissionsTabProps {
  matrix: MetricPermissionsMatrix;
  onMatrixUpdate: (updated: MetricPermissionsMatrix) => void;
  onAfterReset: () => void;
}

function PermissionsTab({ matrix, onMatrixUpdate, onAfterReset }: PermissionsTabProps) {
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [overridesRefreshKey, setOverridesRefreshKey] = useState(0);

  const hasPending = Object.keys(pendingChanges).length > 0;

  function handleCheck(role: string, metricId: string, newValue: boolean) {
    const key = `${role}|${metricId}`;
    const committed = matrix.matrix[role]?.[metricId] ?? true;
    setPendingChanges((prev) => {
      if (newValue === committed) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: newValue };
    });
  }

  function getDisplayValue(role: string, metricId: string): boolean {
    const key = `${role}|${metricId}`;
    return key in pendingChanges ? pendingChanges[key] : (matrix.matrix[role]?.[metricId] ?? true);
  }

  function handleRevert() {
    setPendingChanges({});
  }

  async function handleConfirm() {
    const changes: PermissionChange[] = Object.entries(pendingChanges).map(([key, isVisible]) => {
      const [roleName, metricId] = key.split("|");
      return { role_name: roleName, metric_id: metricId, is_visible: isVisible };
    });
    setSaving(true);
    try {
      await metricPermissionsApi.setBatchPermissions(changes);
      const updatedMatrix: MetricPermissionsMatrix = {
        ...matrix,
        matrix: { ...matrix.matrix },
      };
      for (const [key, isVisible] of Object.entries(pendingChanges)) {
        const [role, metricId] = key.split("|");
        updatedMatrix.matrix[role] = { ...updatedMatrix.matrix[role], [metricId]: isVisible };
      }
      onMatrixUpdate(updatedMatrix);
      setPendingChanges({});
      toast.success("Cambios guardados correctamente");
    } catch {
      toast.error("No se pudo guardar los cambios");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Role-level matrix */}
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 min-w-[180px]">
                  Pestaña
                </th>
                {matrix.roles.map((role) => (
                  <th
                    key={role}
                    className="px-4 py-3.5 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap"
                  >
                    {ROLE_LABELS[role] ?? role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.metrics.map((metric, idx) => (
                <tr
                  key={metric.id}
                  className={`border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors ${
                    idx % 2 === 0
                      ? "bg-white dark:bg-slate-800"
                      : "bg-slate-50/50 dark:bg-slate-800/50"
                  }`}
                >
                  <td className="px-5 py-3.5 font-medium text-slate-800 dark:text-slate-200">
                    {metric.label}
                  </td>
                  {matrix.roles.map((role) => {
                    const key = `${role}|${metric.id}`;
                    const isVisible = getDisplayValue(role, metric.id);
                    const isDirty = key in pendingChanges;
                    return (
                      <td key={role} className="px-4 py-3.5 text-center">
                        <label className="inline-flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={(e) => handleCheck(role, metric.id, e.target.checked)}
                            className={`w-4 h-4 rounded cursor-pointer ${
                              isDirty ? "accent-amber-500" : "accent-[var(--sidebar-bg)]"
                            }`}
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasPending ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-5 py-3.5">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Hay{" "}
              <span className="font-semibold">{Object.keys(pendingChanges).length}</span>{" "}
              {Object.keys(pendingChanges).length === 1 ? "cambio pendiente" : "cambios pendientes"}.
              Confirmá para aplicarlos o revertí para descartar.
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={handleRevert}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Revertir cambios
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--sidebar-bg)] text-white hover:opacity-90 disabled:opacity-50 cursor-pointer transition-opacity"
              >
                <CheckCircle className="w-4 h-4" />
                {saving ? "Guardando…" : "Confirmar cambios"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center">
            Los cambios se propagan a todos los usuarios conectados vía SSE al confirmar.
          </p>
        )}
      </div>

      {/* Divider */}
      <hr className="border-slate-200 dark:border-slate-700" />

      {/* User-level overrides */}
      <UserOverridesSection matrix={matrix} refreshKey={overridesRefreshKey} />

      {/* Divider */}
      <hr className="border-slate-200 dark:border-slate-700" />

      {/* Admin reset */}
      <ResetSection onAfterReset={() => { setOverridesRefreshKey((k) => k + 1); onAfterReset(); }} />
    </div>
  );
}

// ─── Historial tab ────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "", label: "Todos los roles" },
  { value: "supervisor", label: "Supervisor" },
  { value: "manager", label: "Gerente" },
];

function HistorialTab() {
  const [logs, setLogs] = useState<PermissionAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");

  function fetchLogs() {
    setLoading(true);
    metricPermissionsApi
      .getAuditLogs({
        role: filterRole || undefined,
        start_date: filterStart || undefined,
        end_date: filterEnd || undefined,
      })
      .then(setLogs)
      .catch(() => toast.error("No se pudo cargar el historial"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Rol</label>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Desde</label>
          <input
            type="date"
            value={filterStart}
            onChange={(e) => setFilterStart(e.target.value)}
            className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">Hasta</label>
          <input
            type="date"
            value={filterEnd}
            onChange={(e) => setFilterEnd(e.target.value)}
            className="text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--sidebar-bg)] text-white hover:opacity-90 disabled:opacity-50 cursor-pointer transition-opacity"
        >
          Filtrar
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
            Cargando historial…
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400">
            <ClipboardList className="w-6 h-6" />
            <span className="text-sm">Sin registros para los filtros seleccionados</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                {["Fecha/Hora", "Usuario", "Rol afectado", "Métrica", "Acción", "Cambio"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, idx) => (
                <tr
                  key={log.id}
                  className={`border-b border-slate-100 dark:border-slate-700 last:border-0 ${
                    idx % 2 === 0
                      ? "bg-white dark:bg-slate-800"
                      : "bg-slate-50/50 dark:bg-slate-800/50"
                  }`}
                >
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {fmtDateTime(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                    {log.admin_username}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {ROLE_LABELS[log.affected_role] ?? log.affected_role}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                    {log.metric_name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        log.action === "activada"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400"
                      }`}
                    >
                      {log.action === "activada" ? "Activada" : "Desactivada"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    {log.previous_state ? "Visible" : "Oculta"}
                    <span className="mx-1">→</span>
                    {log.new_state ? "Visible" : "Oculta"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && logs.length > 0 && (
        <p className="text-xs text-slate-400 text-center">
          Mostrando los últimos {logs.length} registros. El historial es de solo lectura.
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DashboardConfig() {
  const [matrix, setMatrix] = useState<MetricPermissionsMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("permisos");
  const [matrixKey, setMatrixKey] = useState(0);

  useEffect(() => {
    metricPermissionsApi
      .getMatrix()
      .then(setMatrix)
      .catch(() => toast.error("No se pudo cargar la matriz de permisos"))
      .finally(() => setLoading(false));
  }, [matrixKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Cargando configuración…
      </div>
    );
  }
  if (!matrix) {
    return (
      <div className="flex items-center justify-center h-64 text-rose-500 text-sm">
        Error al cargar permisos.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[var(--sidebar-bg)] flex items-center justify-center shrink-0">
          <Settings2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            Configuración de métricas del dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Controlá qué pestañas ve cada rol y aplicá excepciones por usuario.
          </p>
        </div>
      </div>

      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-700">
        <TabButton
          active={activeTab === "permisos"}
          onClick={() => setActiveTab("permisos")}
          icon={<Settings2 className="w-4 h-4" />}
          label="Permisos"
        />
        <TabButton
          active={activeTab === "historial"}
          onClick={() => setActiveTab("historial")}
          icon={<History className="w-4 h-4" />}
          label="Historial de auditoría"
        />
      </div>

      {activeTab === "permisos" && (
        <PermissionsTab
          matrix={matrix}
          onMatrixUpdate={setMatrix}
          onAfterReset={() => setMatrixKey((k) => k + 1)}
        />
      )}
      {activeTab === "historial" && <HistorialTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-10 px-4 flex items-center gap-2 text-sm border-b-2 transition-all whitespace-nowrap cursor-pointer focus-visible:outline-none ${
        active
          ? "border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-semibold"
          : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white font-medium"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
