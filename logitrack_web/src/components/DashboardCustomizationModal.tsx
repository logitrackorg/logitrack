import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, X } from "lucide-react";
import { useDashboardPrefs } from "../context/DashboardPrefsContext";
import { useMetricPermissions } from "../context/MetricPermissionsContext";
import type { DashboardMetricPref } from "../api/dashboardPrefs";
import { dashboardProfilesApi, type DashboardProfile } from "../api/dashboardProfiles";

interface Props {
  open: boolean;
  onClose: () => void;
}

// ─── SortableItem ──────────────────────────────────────────────────────────────

function SortableItem({
  pref,
  onToggle,
}: {
  pref: DashboardMetricPref;
  onToggle: (metricId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: pref.metric_id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : "auto",
      }}
      {...attributes}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 select-none"
    >
      <button
        {...listeners}
        aria-label="Arrastrar para reordenar"
        className="shrink-0 cursor-grab active:cursor-grabbing text-slate-300 dark:text-gray-600 hover:text-slate-500 dark:hover:text-gray-400 touch-none"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span
        className={`flex-1 text-sm font-medium ${
          pref.is_hidden
            ? "text-slate-400 dark:text-gray-500 line-through"
            : "text-slate-700 dark:text-gray-200"
        }`}
      >
        {pref.metric_label}
      </span>

      <button
        role="switch"
        aria-checked={!pref.is_hidden}
        aria-label={pref.is_hidden ? "Mostrar pestaña" : "Ocultar pestaña"}
        onClick={() => onToggle(pref.metric_id)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
          !pref.is_hidden ? "bg-blue-600" : "bg-slate-200 dark:bg-gray-600"
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
            !pref.is_hidden ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function DashboardCustomizationModal({ open, onClose }: Props) {
  const { prefs, updatePrefs } = useDashboardPrefs();
  const { hasMetricPermission } = useMetricPermissions();

  const [modalPrefs, setModalPrefs] = useState<DashboardMetricPref[]>([]);

  // ── Profiles state ──────────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<DashboardProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync from context + fetch profiles when modal opens
  useEffect(() => {
    if (!open) return;
    if (prefs) {
      setModalPrefs(prefs.filter((p) => hasMetricPermission(p.metric_id)));
    }
    setProfilesLoading(true);
    dashboardProfilesApi
      .list()
      .then(setProfiles)
      .catch(() => {})
      .finally(() => setProfilesLoading(false));
    setProfileError(null);
    setNewProfileName("");
  }, [open, prefs, hasMetricPermission]);

  // ── DnD ────────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = modalPrefs.findIndex((p) => p.metric_id === active.id);
    const newIndex = modalPrefs.findIndex((p) => p.metric_id === over.id);
    const reordered = arrayMove(modalPrefs, oldIndex, newIndex).map((p, i) => ({
      ...p,
      sort_order: i,
    }));
    setModalPrefs(reordered);
    updatePrefs(reordered);
  }

  function handleToggle(metricId: string) {
    const updated = modalPrefs.map((p) =>
      p.metric_id === metricId ? { ...p, is_hidden: !p.is_hidden } : p,
    );
    setModalPrefs(updated);
    updatePrefs(updated);
  }

  // ── Profiles ───────────────────────────────────────────────────────────────
  async function handleSaveProfile() {
    const name = newProfileName.trim();
    if (!name) return;
    setSavingProfile(true);
    setProfileError(null);
    try {
      const saved = await dashboardProfilesApi.create(
        name,
        modalPrefs.map((p) => ({
          metric_id: p.metric_id,
          sort_order: p.sort_order,
          is_hidden: p.is_hidden,
        })),
      );
      setProfiles((prev) => [...prev, saved]);
      setNewProfileName("");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status;
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (status === 400 && msg) {
        setProfileError(msg);
      } else {
        setProfileError("No se pudo guardar el perfil");
      }
    } finally {
      setSavingProfile(false);
    }
  }

  function handleLoadProfile(profile: DashboardProfile) {
    const permittedPrefs = profile.preferences.filter((p) =>
      hasMetricPermission(p.metric_id),
    );
    setModalPrefs(permittedPrefs);
    updatePrefs(permittedPrefs);
  }

  async function handleDeleteProfile(id: string) {
    try {
      await dashboardProfilesApi.delete(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setProfileError("No se pudo eliminar el perfil");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-semibold text-slate-800 dark:text-gray-100">
            Personalizar pestañas
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 rounded-md p-1 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hint */}
        <p className="px-4 py-2 text-xs text-slate-500 dark:text-gray-400 shrink-0">
          Arrastrá para reordenar. Usá el interruptor para mostrar u ocultar.
        </p>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-4 pb-4">
          {/* Sortable tab list */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={modalPrefs.map((p) => p.metric_id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-1.5 pt-1">
                {modalPrefs.map((pref) => (
                  <SortableItem
                    key={pref.metric_id}
                    pref={pref}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {modalPrefs.length === 0 && (
            <p className="text-center text-sm text-slate-400 dark:text-gray-500 py-8">
              No hay métricas disponibles.
            </p>
          )}

          {/* ── Profiles section ───────────────────────────────────────────── */}
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-gray-700">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-2.5">
              Perfiles guardados
            </h3>

            {/* Save input */}
            <div className="flex gap-2 mb-1">
              <input
                ref={nameInputRef}
                type="text"
                value={newProfileName}
                onChange={(e) => {
                  setNewProfileName(e.target.value);
                  setProfileError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleSaveProfile()}
                placeholder="Guardar perfil como..."
                maxLength={60}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSaveProfile}
                disabled={!newProfileName.trim() || savingProfile}
                className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {savingProfile ? "..." : "Guardar"}
              </button>
            </div>

            {profileError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-2">
                {profileError}
              </p>
            )}

            {/* Profiles list */}
            <div className="mt-2">
              {profilesLoading ? (
                <p className="text-xs text-slate-400 dark:text-gray-500 text-center py-3">
                  Cargando...
                </p>
              ) : profiles.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-gray-500 text-center py-3">
                  Sin perfiles guardados
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {profiles.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800/60 group"
                    >
                      <span className="flex-1 text-sm text-slate-700 dark:text-gray-200 truncate">
                        {profile.name}
                      </span>
                      <button
                        onClick={() => handleLoadProfile(profile)}
                        className="shrink-0 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors cursor-pointer"
                      >
                        Cargar
                      </button>
                      <button
                        onClick={() => handleDeleteProfile(profile.id)}
                        aria-label={`Eliminar perfil ${profile.name}`}
                        className="shrink-0 text-slate-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-gray-700 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
