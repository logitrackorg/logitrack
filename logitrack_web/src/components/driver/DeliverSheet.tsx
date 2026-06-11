import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { recipientView } from "@/utils/driverActions";
import type { Shipment } from "@/api/shipments";

export interface DeliverSheetProps {
  open: boolean;
  onClose: () => void;
  shipment: Shipment | null;
  keyword: string;
  onKeywordChange: (s: string) => void;
  useContingency: boolean;
  onUseContingency: (v: boolean) => void;
  dni: string;
  onDniChange: (s: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  speedBlocked: boolean;
  blockMessage: string;
  needsLocation: boolean;
  onRequestLocation: () => void;
  error: string;
  effectiveSpeed?: number;
  speedSource?: string;
}

export function DeliverSheet({
  open,
  onClose,
  shipment,
  keyword,
  onKeywordChange,
  useContingency,
  onUseContingency,
  dni,
  onDniChange,
  submitting,
  onConfirm,
  speedBlocked,
  blockMessage,
  needsLocation,
  onRequestLocation,
  error,
}: DeliverSheetProps) {
  const keywordRef = useRef<HTMLInputElement>(null);
  const dniRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        (useContingency ? dniRef : keywordRef).current?.focus();
      }, 80);
      return () => clearTimeout(t);
    }
  }, [open, useContingency]);

  if (!shipment) return null;

  const { name } = recipientView(shipment);
  const isLastMile = shipment.delivery_method === "ultima_milla";
  const keywordAttempts = shipment.keyword_attempts ?? 0;
  const locked = keywordAttempts >= 3;

  const canConfirm = isLastMile
    ? useContingency
      ? !!dni.trim()
      : !locked && !!keyword.trim()
    : !!dni.trim();

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Confirmar entrega"
      description={`Entrega a ${name}`}
    >
      {isLastMile && !useContingency && (
        <>
          {locked && (
            <div className="mb-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 px-4 py-3">
              <p className="text-xs font-bold text-red-700 dark:text-red-400">
                Campo bloqueado — 3 intentos fallidos
              </p>
              <p className="text-xs text-red-600 dark:text-red-400/80 mt-0.5">
                Usá la opción de entrega con DNI para continuar.
              </p>
            </div>
          )}
          {!locked && keywordAttempts > 0 && (
            <div className="mb-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-4 py-2.5">
              <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold">
                Intentos fallidos: {keywordAttempts}/3 — quedan{" "}
                {3 - keywordAttempts} intento(s)
              </p>
            </div>
          )}
          <label className="block text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-1.5">
            Palabra clave de seguridad
          </label>
          <input
            ref={keywordRef}
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            autoComplete="off"
            placeholder="Dictada por el destinatario"
            disabled={locked}
            className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="mt-1.5 text-[11px] dark:text-gray-400 text-slate-500">
            El cliente debe decirte su palabra clave al abrir la puerta.
          </p>
        </>
      )}

      {isLastMile && useContingency && (
        <>
          <div className="mb-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 px-4 py-3">
            <p className="text-xs font-bold text-amber-800 dark:text-amber-400">
              <AlertTriangle
                size={14}
                className="inline text-amber-500 dark:text-amber-400"
              />{" "}
              Entrega de contingencia
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-0.5">
              El registro quedará marcado para auditoría del supervisor.
            </p>
          </div>
          <label className="block text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-1.5">
            DNI del destinatario
          </label>
          <input
            ref={dniRef}
            value={dni}
            onChange={(e) => onDniChange(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ej: 30123456"
            className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </>
      )}

      {!isLastMile && (
        <>
          <label className="block text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-1.5">
            DNI del destinatario
          </label>
          <input
            ref={dniRef}
            value={dni}
            onChange={(e) => onDniChange(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ej: 30123456"
            className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500"
          />
          <p className="mt-1.5 text-[11px] dark:text-gray-400 text-slate-500">
            Solo dígitos. Debe coincidir con el DNI registrado al crear el envío.
          </p>
        </>
      )}

      {error && (
        <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
      )}

      <div className="flex flex-col gap-2 mt-5">
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
          disabled={!canConfirm || submitting || speedBlocked}
          className="h-14 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-base font-bold w-full"
        >
          {submitting ? "Guardando…" : "Confirmar entrega"}
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

      {isLastMile && locked && !useContingency && (
        <Button
          variant="outline"
          onClick={() => onUseContingency(true)}
          className="mt-3 h-14 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-800 text-base font-bold w-full hover:bg-amber-100"
        >
          Entregar con DNI
        </Button>
      )}
      {isLastMile && useContingency && (
        <Button
          variant="link"
          onClick={() => onUseContingency(false)}
          className="mt-3 w-full text-sm"
        >
          Volver a intentar con palabra clave
        </Button>
      )}

      {speedBlocked && (
        <div className="mt-3 text-center">
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            {blockMessage}
          </p>
          {needsLocation && (
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onRequestLocation();
              }}
              className="mt-2 h-11 px-6 rounded-xl bg-[var(--brand)] text-white text-sm font-bold"
            >
              Activar ubicación
            </Button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
