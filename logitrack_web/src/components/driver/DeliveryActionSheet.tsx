import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recipientView, FAILED_REASONS, REJECTED_REASONS } from "@/utils/driverActions";
import type { Shipment } from "@/api/shipments";

export interface DeliveryActionSheetProps {
  mode: "deliver" | "failed" | "rejected";
  open: boolean;
  onClose: () => void;
  shipment: Shipment | null;

  // Shared
  submitting: boolean;
  onConfirm: () => void;
  speedBlocked: boolean;
  blockMessage: string;
  needsLocation: boolean;
  onRequestLocation: () => void;
  error: string;

  // deliver mode
  keyword?: string;
  onKeywordChange?: (s: string) => void;
  useContingency?: boolean;
  onUseContingency?: (v: boolean) => void;
  dni?: string;
  onDniChange?: (s: string) => void;

  // failed / rejected mode
  reason?: string;
  onReasonChange?: (s: string) => void;
  notes?: string;
  onNotesChange?: (s: string) => void;
}

export function DeliveryActionSheet({
  mode,
  open,
  onClose,
  shipment,
  submitting,
  onConfirm,
  speedBlocked,
  blockMessage,
  needsLocation,
  onRequestLocation,
  error,
  // deliver mode
  keyword = "",
  onKeywordChange,
  useContingency = false,
  onUseContingency,
  dni = "",
  onDniChange,
  // failed / rejected mode
  reason = "",
  onReasonChange,
  notes = "",
  onNotesChange,
}: DeliveryActionSheetProps) {
  const keywordRef = useRef<HTMLInputElement>(null);
  const dniRef = useRef<HTMLInputElement>(null);

  const isDeliver = mode === "deliver";
  const isFailed = mode === "failed";
  const isRejected = mode === "rejected";

  // Focus the right input on open
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        if (isDeliver && useContingency) {
          dniRef.current?.focus();
        } else if (isDeliver) {
          keywordRef.current?.focus();
        }
      }, 80);
      return () => clearTimeout(t);
    }
  }, [open, isDeliver, useContingency]);

  if (!shipment) return null;

  const { name } = recipientView(shipment);

  // ── Deliver mode ──────────────────────────────────────────────
  const isLastMile = shipment.delivery_method === "ultima_milla";
  const keywordAttempts = shipment.keyword_attempts ?? 0;
  const locked = keywordAttempts >= 3;

  const deliverCanConfirm = isLastMile
    ? useContingency
      ? !!dni.trim()
      : !locked && !!keyword.trim()
    : !!dni.trim();

  // ── Failed / Rejected mode ────────────────────────────────────
  const requiresNotes = reason === "otro";
  const reasonCanSubmit = !!reason && !(requiresNotes && !notes.trim());

  // ── Mode-specific derived values ──────────────────────────────
  const title = isDeliver
    ? "Confirmar entrega"
    : isFailed
      ? "Marcar como no entregado"
      : "Rechazo por destinatario";

  const description = isDeliver
    ? `Entrega a ${name}`
    : isFailed
      ? `No entrega a ${name}`
      : `${name} rechazó el envío`;

  const canConfirm = isDeliver ? deliverCanConfirm : reasonCanSubmit;

  const confirmLabel = submitting
    ? "Guardando…"
    : isDeliver
      ? "Confirmar entrega"
      : isFailed
        ? "Confirmar"
        : "Confirmar rechazo";

  const confirmClass = isDeliver
    ? "h-14 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-base font-bold w-full"
    : isFailed
      ? "h-14 rounded-xl bg-red-500 hover:bg-red-600 text-white text-base font-bold w-full"
      : "h-14 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-base font-bold w-full";

  const focusRingColor = isFailed
    ? "focus:ring-red-500/20 focus:border-red-500"
    : isRejected
      ? "focus:ring-amber-500/20 focus:border-amber-500"
      : "focus:ring-emerald-500/20 focus:border-emerald-500";

  const reasonLabel = isFailed ? "¿Qué pasó?" : "Motivo del rechazo";

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
    >
      {/* ═══ DELIVER MODE ═══ */}
      {isDeliver && isLastMile && !useContingency && (
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
            onChange={(e) => onKeywordChange?.(e.target.value)}
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

      {isDeliver && isLastMile && useContingency && (
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
            onChange={(e) => onDniChange?.(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ej: 30123456"
            className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </>
      )}

      {isDeliver && !isLastMile && (
        <>
          <label className="block text-xs font-bold text-[var(--text-strong)] uppercase tracking-wider mb-1.5">
            DNI del destinatario
          </label>
          <input
            ref={dniRef}
            value={dni}
            onChange={(e) => onDniChange?.(e.target.value.replace(/\D/g, ""))}
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

      {/* ═══ FAILED / REJECTED MODE ═══ */}
      {(isFailed || isRejected) && (
        <>
          <p className="text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-2">
            {reasonLabel}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {(isFailed ? FAILED_REASONS : REJECTED_REASONS).map((r) => {
              const active = reason === r.id;
              const activeCn = isFailed
                ? "border-red-500 dark:border-red-400 bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/25"
                : "border-amber-500 dark:border-amber-400 bg-amber-50 dark:bg-amber-500/15 text-amber-900 dark:text-amber-300";
              const idleCn =
                "dark:border-gray-600 border-slate-200 bg-transparent dark:text-gray-300 text-slate-700 dark:hover:bg-gray-700/50 hover:bg-slate-50";
              const IconCmp =
                "icon" in r
                  ? (r as (typeof REJECTED_REASONS)[number]).icon
                  : null;

              return (
                <Button
                  key={r.id}
                  variant="outline"
                  onClick={() => onReasonChange?.(r.id)}
                  className={cn(
                    "h-14 rounded-xl border-2 min-h-[44px] transition-all duration-150 active:scale-95",
                    isRejected &&
                      "flex flex-col items-center justify-center gap-0.5 px-2",
                    active ? activeCn : idleCn,
                  )}
                >
                  {IconCmp && <IconCmp className="text-lg" aria-hidden="true" />}
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      isRejected && "text-xs leading-tight text-center",
                    )}
                  >
                    {r.label}
                  </span>
                </Button>
              );
            })}
          </div>

          <label className="block text-xs font-bold dark:text-gray-300 text-slate-700 uppercase tracking-wider mb-1.5">
            Notas {requiresNotes ? "(obligatorio)" : "(opcional)"}
          </label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange?.(e.target.value)}
            placeholder={
              requiresNotes
                ? "Describí el motivo"
                : "Detalle adicional para el supervisor"
            }
            rows={isRejected ? 2 : 3}
            className={cn(
              "w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-[3px] resize-y",
              focusRingColor,
            )}
          />
        </>
      )}

      {/* ═══ ERROR ═══ */}
      {error && (
        <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* ═══ CONFIRM / CANCEL BUTTONS ═══ */}
      <div className="flex flex-col gap-2 mt-5">
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
          disabled={!canConfirm || submitting || speedBlocked}
          className={confirmClass}
        >
          {confirmLabel}
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

      {/* ═══ DELIVER MODE TOGGLE BUTTONS ═══ */}
      {isDeliver && isLastMile && locked && !useContingency && (
        <Button
          variant="outline"
          onClick={() => onUseContingency?.(true)}
          className="mt-3 h-14 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-800 text-base font-bold w-full hover:bg-amber-100"
        >
          Entregar con DNI
        </Button>
      )}
      {isDeliver && isLastMile && useContingency && (
        <Button
          variant="link"
          onClick={() => onUseContingency?.(false)}
          className="mt-3 w-full text-sm"
        >
          Volver a intentar con palabra clave
        </Button>
      )}

      {/* ═══ SPEED BLOCKED ═══ */}
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
