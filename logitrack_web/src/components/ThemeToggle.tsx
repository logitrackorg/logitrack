import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { cn } from "@/lib/utils";

/**
 * Switch deslizante de tema (sol ↔ luna).
 * El "thumb" se desliza y debajo asoma el ícono del modo contrario.
 * Accesible: role="switch" + aria-checked + label.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  const trackW = compact ? 48 : 54;
  const trackH = compact ? 26 : 30;
  const pad = 3;
  const thumb = trackH - pad * 2;
  const travel = trackW - thumb - pad * 2;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "Activar modo claro" : "Activar modo oscuro"}
      title={isDark ? "Modo claro" : "Modo oscuro"}
      onClick={toggleTheme}
      className={cn(
        "relative rounded-full border border-[var(--theme-toggle-border)] cursor-pointer p-0 shrink-0 overflow-hidden",
        "bg-gradient-to-br from-blue-100 to-sky-200 dark:from-slate-800 dark:to-[#0b1220]",
        "transition-colors duration-400 ease",
        "[-webkit-tap-highlight-color:transparent]",
        compact ? "w-12 h-[26px]" : "w-[54px] h-[30px]",
      )}
    >
      {/* Estrellas (modo oscuro) */}
      <span
        aria-hidden
        className="absolute inset-0 opacity-0 dark:opacity-100 transition-opacity duration-400 ease pointer-events-none"
      >
        <span aria-hidden className="absolute rounded-full bg-slate-200 opacity-80" style={{ left: 34, top: 8, width: 2, height: 2 }} />
        <span aria-hidden className="absolute rounded-full bg-slate-200 opacity-80" style={{ left: 40, top: 18, width: 1.5, height: 1.5 }} />
        <span aria-hidden className="absolute rounded-full bg-slate-200 opacity-80" style={{ left: 28, top: 20, width: 1.5, height: 1.5 }} />
      </span>

      {/* Íconos fijos a los lados (atenuados, decorativos) */}
      <Sun
        size={compact ? 13 : 15}
        aria-hidden
        className="absolute left-[5px] top-1/2 -translate-y-1/2 text-[var(--accent)] opacity-0 dark:opacity-[0.35] transition-opacity duration-400 ease"
      />
      <Moon
        size={compact ? 12 : 14}
        aria-hidden
        className="absolute right-[6px] top-1/2 -translate-y-1/2 text-[var(--brand)] opacity-[0.45] dark:opacity-0 transition-opacity duration-400 ease"
      />

      {/* Thumb deslizante con cross-fade + giro entre sol y luna */}
      <span
        style={{
          transform: `translateX(${isDark ? travel : 0}px)`,
          transition: "transform 0.45s cubic-bezier(0.34,1.4,0.64,1), background 0.4s ease, box-shadow 0.4s ease",
        }}
        className={cn(
          "absolute top-[3px] left-[3px] rounded-full grid place-items-center",
          "bg-gradient-to-br from-yellow-300 to-amber-500 dark:from-slate-600 dark:to-slate-800",
          "shadow-[0_1px_4px_rgba(234,179,8,0.55)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.6)]",
          compact ? "w-5 h-5" : "w-6 h-6",
        )}
      >
        {/* Sol */}
        <span
          style={{ transition: "opacity 0.4s ease, transform 0.45s cubic-bezier(0.34,1.4,0.64,1)" }}
          className="[grid-area:1/1] flex opacity-100 dark:opacity-0 rotate-0 dark:-rotate-90 scale-100 dark:scale-[0.4]"
        >
          <Sun size={compact ? 14 : 16} color="#fff" />
        </span>
        {/* Luna */}
        <span
          style={{ transition: "opacity 0.4s ease, transform 0.45s cubic-bezier(0.34,1.4,0.64,1)" }}
          className="[grid-area:1/1] flex opacity-0 dark:opacity-100 rotate-90 dark:rotate-0 scale-[0.4] dark:scale-100"
        >
          <Moon size={compact ? 13 : 15} color="var(--brand)" fill="var(--brand)" />
        </span>
      </span>
    </button>
  );
}
