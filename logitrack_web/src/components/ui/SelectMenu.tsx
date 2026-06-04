import { cn } from "@/lib/utils";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };
export type SelectGroup = { label: string; options: SelectOption[] };

interface SelectMenuProps {
  value: string;
  onChange: (value: string) => void;
  /** Opciones planas (sin agrupar). Usar esto o `groups`. */
  options?: SelectOption[];
  /** Opciones agrupadas (como optgroup). Usar esto o `options`. */
  groups?: SelectGroup[];
  /** Texto de la opción vacía (value === ""). Si no se pasa, no hay opción vacía. */
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Clases extra para el trigger (ej. ancho: "w-[220px]"). */
  className?: string;
}

type Item =
  | { kind: "group"; label: string }
  | { kind: "option"; value: string; label: string };

/**
 * Dropdown propio (reemplazo del <select> nativo) totalmente themeado para
 * modo claro/oscuro. El popup nativo de macOS no se puede estilar, por eso
 * usamos este. Soporta opciones planas o agrupadas, teclado y click-afuera.
 */
export function SelectMenu({
  value,
  onChange,
  options,
  groups,
  placeholder,
  ariaLabel,
  disabled,
  size = "md",
  className = "",
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Lista renderizable (grupos + opciones) y lista plana de opciones (para teclado).
  const { items, flatOptions } = useMemo(() => {
    const items: Item[] = [];
    const flat: SelectOption[] = [];
    if (placeholder !== undefined) {
      items.push({ kind: "option", value: "", label: placeholder });
      flat.push({ value: "", label: placeholder });
    }
    if (groups) {
      for (const g of groups) {
        if (g.options.length === 0) continue;
        items.push({ kind: "group", label: g.label });
        for (const o of g.options) {
          items.push({ kind: "option", value: o.value, label: o.label });
          flat.push(o);
        }
      }
    } else if (options) {
      for (const o of options) {
        items.push({ kind: "option", value: o.value, label: o.label });
        flat.push(o);
      }
    }
    return { items, flatOptions: flat };
  }, [groups, options, placeholder]);

  const selected = flatOptions.find((o) => o.value === value);
  const selectedLabel = selected?.label ?? placeholder ?? "";

  // Cerrar al click afuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Al abrir, posicionar el índice activo en la opción seleccionada.
  useEffect(() => {
    if (open) {
      const idx = flatOptions.findIndex((o) => o.value === value);
      setActiveIdx(idx >= 0 ? idx : 0);
    }
  }, [open, value, flatOptions]);

  const commit = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flatOptions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = flatOptions[activeIdx];
      if (opt) commit(opt.value);
    }
  };

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          "inline-flex items-center justify-between w-full gap-2 px-3",
          "rounded-[10px] border text-sm font-medium",
          "border-blue-200 hover:border-blue-400 focus:border-blue-500",
          "focus:ring-[3px] focus:ring-blue-500/20",
          "transition-[border-color,box-shadow] duration-150",
          size === "sm" ? "h-9" : "h-10",
          disabled && "opacity-60 cursor-not-allowed",
          !disabled && "cursor-pointer",
        )}
        style={{
          background: "var(--bg-card)",
          color: selected || value === "" ? "var(--text-primary)" : "var(--text-muted)",
          minWidth: 0,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabel}
        </span>
        <ChevronDown
          size={16}
          style={{
            flexShrink: 0,
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          id={listId}
          tabIndex={-1}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "100%",
            maxWidth: "min(360px, 90vw)",
            maxHeight: 300,
            overflowY: "auto",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "var(--shadow-lg)",
            padding: 6,
            zIndex: 80,
          }}
        >
          {items.map((it, i) => {
            if (it.kind === "group") {
              return (
                <div
                  key={`g-${i}`}
                  style={{
                    padding: "8px 10px 4px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  {it.label}
                </div>
              );
            }
            const optIdx = flatOptions.findIndex((o) => o.value === it.value);
            const isSelected = it.value === value;
            const isActive = optIdx === activeIdx;
            return (
              <div
                key={`o-${it.value}-${i}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(optIdx)}
                onClick={() => commit(it.value)}
                className={cn(
                  "flex items-center justify-between gap-2 px-[10px] py-2",
                  "rounded-lg text-sm cursor-pointer whitespace-nowrap",
                  (isActive || isSelected) ? "bg-blue-50" : "bg-transparent",
                  isSelected ? "text-blue-600 font-semibold" : "text-[var(--text-primary)] font-medium",
                )}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                {isSelected && <Check size={15} style={{ flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
