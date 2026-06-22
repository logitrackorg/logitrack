import { useState } from "react";
import { isLeaf, type PreFilterCtx, type PreFilterNode } from "../utils/claimPreFilter";
import type { DamageSubtype } from "../utils/claimDecisionTree";

export interface PreFilterContinueOpts {
  prefillDamageSubtypes?: DamageSubtype[];
  noteMessage?: string;
}

interface Props {
  /** Nodo inicial ya resuelto por el padre — nunca un leaf. */
  startNode: PreFilterNode;
  ctx: PreFilterCtx;
  onContinue(opts: PreFilterContinueOpts): void;
  onResolved(message: string): void;
  onBack(): void;
}

/**
 * Wizard de pre-filtro para el formulario público.
 * El padre obtiene el primer paso con getPreFilterRoot() y, si es un leaf,
 * lo maneja él mismo. Solo monta este componente cuando el primer paso
 * es un nodo (tiene preguntas para el usuario).
 */
export function ClaimPreFilter({ startNode, ctx, onContinue, onResolved, onBack }: Props) {
  const [node, setNode] = useState<PreFilterNode>(startNode);

  const handleAnswer = (value: string) => {
    const next = node.next(value, ctx);
    if (isLeaf(next)) {
      if (next.kind === 'redirect') {
        // not_delivered → delay: el padre cambia categoría y reinicia
        onContinue({});
        return;
      }
      if (next.kind === 'resolved') {
        onResolved(next.message);
        return;
      }
      onContinue({
        prefillDamageSubtypes: next.prefillDamageSubtypes,
        noteMessage: next.noteMessage,
      });
      return;
    }
    setNode(next);
  };

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 p-4 space-y-3">
      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{node.question}</p>
      <div className="flex flex-col gap-2">
        {node.options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleAnswer(opt.value)}
            className="text-left text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            {opt.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline"
      >
        ← Volver a elegir motivo
      </button>
    </div>
  );
}
