import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { FAILED_REASONS, recipientView } from "@/utils/driverActions";
import type { Shipment } from "@/api/shipments";

interface FailedSheetProps {
  open: boolean;
  onClose: () => void;
  shipment: Shipment | null;
  reason: string;
  onReasonChange: (s: string) => void;
  notes: string;
  onNotesChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  speedBlocked: boolean;
  blockMessage: string;
  needsLocation: boolean;
  onRequestLocation: () => void;
}

export function FailedSheet({
  open,
  onClose,
  shipment,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  submitting,
  onConfirm,
  speedBlocked,
  blockMessage,
  needsLocation,
  onRequestLocation,
}: FailedSheetProps) {
  if (!shipment) return null;
  const { name } = recipientView(shipment);
  const requiresNotes = reason === "otro";
  const canSubmit = !!reason && !(requiresNotes && !notes.trim());

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Marcar como no entregado"
      description={`No entrega a ${name}`}
    >
      <p className="text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-2">
        ¿Qué pasó?
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {FAILED_REASONS.map((r) => {
          const active = reason === r.id;
          return (
            <Button
              key={r.id}
              variant="outline"
              onClick={() => onReasonChange(r.id)}
              className={`h-14 rounded-xl border-2 text-sm font-semibold transition-all duration-150 active:scale-95 ${
                active
                  ? "border-rose-500 dark:border-rose-400 bg-rose-50 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-500/25"
                  : "dark:border-gray-600 border-slate-200 bg-transparent dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700/50 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </Button>
          );
        })}
      </div>

      <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
        Notas {requiresNotes ? "(obligatorio)" : "(opcional)"}
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder={requiresNotes ? "Describí el motivo" : "Detalle adicional para el supervisor"}
        rows={3}
        className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-rose-500/20 focus:border-rose-500 resize-y"
      />

      <div className="flex flex-col gap-2 mt-5">
        <Button
          variant="destructive"
          onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          disabled={!canSubmit || submitting || speedBlocked}
          className="h-14 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-base font-bold w-full"
        >
          {submitting ? "Guardando…" : "Confirmar"}
        </Button>
        <Button
          variant="outline"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="h-14 rounded-xl text-base font-semibold w-full"
        >
          Cancelar
        </Button>
      </div>
      {speedBlocked && (
        <div className="mt-3 text-center">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{blockMessage}</p>
          {needsLocation && (
            <Button
              variant="default"
              onClick={(e) => { e.stopPropagation(); onRequestLocation(); }}
              className="mt-2 h-11 px-6 rounded-xl bg-[var(--brand)] hover:opacity-90 active:scale-95 text-white text-sm font-bold transition-all duration-150"
            >
              Activar ubicación
            </Button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
