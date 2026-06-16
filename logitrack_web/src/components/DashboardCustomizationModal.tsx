import { useEffect, useState } from "react";
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
import { GripVertical, X } from "lucide-react";
import { useDashboardPrefs } from "../context/DashboardPrefsContext";
import { useMetricPermissions } from "../context/MetricPermissionsContext";
import type { DashboardMetricPref } from "../api/dashboardPrefs";

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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 select-none"
    >
      {/* Drag handle — only this element activates drag */}
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

      {/* Toggle switch */}
      <button
        role="switch"
        aria-checked={!pref.is_hidden}
        aria-label={pref.is_hidden ? "Mostrar pestaña" : "Ocultar pestaña"}
        onClick={() => onToggle(pref.metric_id)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
          !pref.is_hidden
            ? "bg-blue-600"
            : "bg-slate-200 dark:bg-gray-600"
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

  // Sync from context when modal opens
  useEffect(() => {
    if (open && prefs) {
      setModalPrefs(prefs.filter((p) => hasMetricPermission(p.metric_id)));
    }
  }, [open, prefs, hasMetricPermission]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col max-h-[80vh]">
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

        {/* Sortable list */}
        <div className="overflow-y-auto flex-1 px-4 pb-4">
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
