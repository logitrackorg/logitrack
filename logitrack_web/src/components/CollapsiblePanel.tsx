import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface CollapsiblePanelProps {
  /** Título del panel (icono + texto), siempre visible junto al botón de expandir/contraer. */
  title: ReactNode;
  /** Estado inicial del panel. Por defecto, abierto. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Panel lateral colapsable: encabezado con título + flecha que alterna la
 * visibilidad del contenido. Pensado para usarse dentro de un <Card> existente
 * (no agrega fondo ni bordes propios).
 */
export function CollapsiblePanel({ title, defaultOpen = true, children }: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex items-center justify-between w-full gap-2 text-sm font-semibold text-slate-900 dark:text-white cursor-pointer"
      >
        <span className="flex items-center gap-2">{title}</span>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>
      {isOpen && <div className="mt-3">{children}</div>}
    </div>
  );
}
