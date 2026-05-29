import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
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
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
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

  const h = size === "sm" ? 36 : 40;

  const triggerStyle: CSSProperties = {
    height: h,
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "0 12px",
    borderRadius: 10,
    border: `1px solid ${focus ? "var(--brand)" : hover ? "var(--border-strong)" : "var(--border)"}`,
    background: "var(--bg-card)",
    color: selected || value === "" ? "var(--text-primary)" : "var(--text-muted)",
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: focus ? "0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent)" : "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
    width: "100%",
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
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={triggerStyle}
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  fontSize: 14,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  color: isSelected ? "var(--brand)" : "var(--text-primary)",
                  fontWeight: isSelected ? 600 : 500,
                  background: isActive
                    ? isSelected
                      ? "var(--brand-tint)"
                      : "var(--bg-hover)"
                    : isSelected
                    ? "var(--brand-tint)"
                    : "transparent",
                }}
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
