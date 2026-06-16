import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

/** Motivos de ejemplo para mover un envío a la zona de Revisión. */
const PRESET_REASONS = [
  "Embalaje dañado",
  "Etiqueta ilegible o faltante",
  "Posible faltante de contenido",
  "Contenido sospechoso o derramado",
];

const OTHER = "__other__";

interface RevisionReasonModalProps {
  open: boolean;
  trackingId: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Pide el motivo antes de mover un envío a Revisión: ofrece motivos de ejemplo
 * o permite escribir uno propio, y exige confirmación explícita.
 */
export function RevisionReasonModal({
  open,
  trackingId,
  submitting,
  onCancel,
  onConfirm,
}: RevisionReasonModalProps) {
  const [selected, setSelected] = useState("");
  const [otherText, setOtherText] = useState("");

  const isOther = selected === OTHER;
  const reason = isOther ? otherText.trim() : selected;
  const canConfirm = reason.length > 0 && !submitting;

  function handleClose() {
    setSelected("");
    setOtherText("");
    onCancel();
  }

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent>
        <DialogHeader onClose={handleClose}>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-[var(--warn-text)]" />
            Mover a Revisión
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-2 space-y-3">
          <p className="text-sm text-[var(--text-muted)]">
            Indicá el motivo por el que el envío{" "}
            <span className="font-semibold text-[var(--text-primary)]">{trackingId}</span> pasa a la
            zona de Revisión.
          </p>

          <div className="space-y-2">
            {PRESET_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="revision-reason"
                  className="accent-[var(--warn)]"
                  checked={selected === r}
                  onChange={() => setSelected(r)}
                />
                <span>{r}</span>
              </label>
            ))}

            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="radio"
                name="revision-reason"
                className="accent-[var(--warn)]"
                checked={isOther}
                onChange={() => setSelected(OTHER)}
              />
              <span>Otro motivo…</span>
            </label>

            {isOther && (
              <textarea
                autoFocus
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Escribí el motivo…"
                rows={3}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(reason)}
            disabled={!canConfirm}
            className="bg-[var(--warn)] hover:opacity-90 text-white"
          >
            Confirmar y mover a Revisión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
