import type { CSSProperties } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

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
      className="theme-toggle"
      style={{
        position: "relative",
        width: trackW,
        height: trackH,
        borderRadius: 999,
        border: "1px solid var(--theme-toggle-border)",
        background: isDark
          ? "linear-gradient(135deg, #1e293b, #0b1220)"
          : "linear-gradient(135deg, #dbeafe, #bae6fd)",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        transition: "background 0.7s ease, border-color 0.7s ease",
        overflow: "hidden",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Estrellas (modo oscuro) */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: isDark ? 1 : 0,
          transition: "opacity 0.7s ease",
          pointerEvents: "none",
        }}
      >
        <span style={dot(34, 8, 2)} />
        <span style={dot(40, 18, 1.5)} />
        <span style={dot(28, 20, 1.5)} />
      </span>

      {/* Íconos fijos a los lados (atenuados, decorativos) */}
      <Sun
        size={compact ? 13 : 15}
        aria-hidden
        style={{
          position: "absolute",
          left: pad + 2,
          top: "50%",
          transform: "translateY(-50%)",
          color: "#f59e0b",
          opacity: isDark ? 0.35 : 0,
          transition: "opacity 0.7s ease",
        }}
      />
      <Moon
        size={compact ? 12 : 14}
        aria-hidden
        style={{
          position: "absolute",
          right: pad + 3,
          top: "50%",
          transform: "translateY(-50%)",
          color: "#cbd5e1",
          opacity: isDark ? 0 : 0.45,
          transition: "opacity 0.7s ease",
        }}
      />

      {/* Thumb deslizante con cross-fade + giro entre sol y luna */}
      <span
        style={{
          position: "absolute",
          top: pad,
          left: pad,
          width: thumb,
          height: thumb,
          borderRadius: "50%",
          background: isDark
            ? "linear-gradient(135deg, #475569, #1e293b)"
            : "linear-gradient(135deg, #fde047, #f59e0b)",
          boxShadow: isDark
            ? "0 1px 4px rgba(0,0,0,0.6)"
            : "0 1px 4px rgba(234,179,8,0.55)",
          transform: `translateX(${isDark ? travel : 0}px)`,
          transition:
            "transform 0.65s cubic-bezier(0.34,1.4,0.64,1), background 0.7s ease, box-shadow 0.7s ease",
          display: "grid",
          placeItems: "center",
        }}
      >
        {/* Sol */}
        <span
          style={{
            gridArea: "1 / 1",
            display: "flex",
            transition: "opacity 0.5s ease, transform 0.65s cubic-bezier(0.34,1.4,0.64,1)",
            opacity: isDark ? 0 : 1,
            transform: isDark ? "rotate(-90deg) scale(0.4)" : "rotate(0deg) scale(1)",
          }}
        >
          <Sun size={compact ? 14 : 16} color="#fff" />
        </span>
        {/* Luna */}
        <span
          style={{
            gridArea: "1 / 1",
            display: "flex",
            transition: "opacity 0.5s ease, transform 0.65s cubic-bezier(0.34,1.4,0.64,1)",
            opacity: isDark ? 1 : 0,
            transform: isDark ? "rotate(0deg) scale(1)" : "rotate(90deg) scale(0.4)",
          }}
        >
          <Moon size={compact ? 13 : 15} color="#e2e8f0" fill="#e2e8f0" />
        </span>
      </span>
    </button>
  );
}

function dot(left: number, top: number, size: number): CSSProperties {
  return {
    position: "absolute",
    left,
    top,
    width: size,
    height: size,
    borderRadius: "50%",
    background: "#e2e8f0",
    opacity: 0.8,
  };
}
