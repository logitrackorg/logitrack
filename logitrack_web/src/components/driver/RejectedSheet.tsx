import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recipientView, REJECTED_REASONS } from "@/utils/driverActions";
import { type Shipment } from "@/api/shipments";

interface RejectedSheetProps {
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
  effectiveSpeed?: number;
  speedSource?: string;
}

export function RejectedSheet({
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
}: RejectedSheetProps) {
  if (!shipment) return null;
  const { name } = recipientView(shipment);
  const requiresNotes = reason === "otro";
  const canSubmit = !!reason && !(requiresNotes && !notes.trim());

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Rechazo por destinatario"
      description={`${name} rechazó el envío`}
    >
      <p className="text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-2">
        Motivo del rechazo
      </p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {REJECTED_REASONS.map((r) => {
          const active = reason === r.id;
          return (
            <Button
              key={r.id}
              variant="outline"
              onClick={() => onReasonChange(r.id)}
              className={cn(
                "h-14 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 px-2",
                active
                  ? "border-amber-500 dark:border-amber-400 bg-amber-50 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300"
                  : "dark:border-gray-600 border-slate-200 bg-transparent dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700/50 hover:bg-slate-50",
              )}
            >
              <r.icon className="text-lg" />
              <span className="text-xs leading-tight text-center">{r.label}</span>
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
        rows={2}
        className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-amber-500/20 focus:border-amber-500 resize-none"
      />

      <div className="flex flex-col gap-2 mt-5">
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
          disabled={!canSubmit || submitting || speedBlocked}
          className="h-14 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-base font-bold w-full"
        >
          {submitting ? "Guardando…" : "Confirmar rechazo"}
        </Button>
        <Button
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="h-14 rounded-xl text-base font-semibold w-full"
        >
          Cancelar
        </Button>
      </div>
      {speedBlocked && (
        <div className="mt-3 text-center">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            {blockMessage}
          </p>
          {needsLocation && (
            <Button
              variant="default"
              onClick={(e) => {
                e.stopPropagation();
                onRequestLocation();
              }}
              className="mt-2 h-11 px-6 rounded-xl text-white text-sm font-bold"
            >
              Activar ubicación
            </Button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
