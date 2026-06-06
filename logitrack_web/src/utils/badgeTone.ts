import type { CSSProperties } from "react";

/**
 * Estilo de badge "tinte suave" (el mismo look de las prioridades) derivado de
 * un color base sólido.
 * - Modo claro: color sólido + texto blanco (como siempre).
 * - Modo oscuro: tinte translúcido + texto del color aclarado + borde sutil.
 *
 * Usar en cualquier pill/badge de estado que hoy renderice un color sólido,
 * para que en oscuro adopte el estilo elegante consistente con StatusBadge.
 */
export function softBadgeStyle(baseHex: string, dark: boolean): CSSProperties {
  if (!dark) {
    return { background: baseHex, color: "#fff", border: "1px solid transparent" };
  }
  return {
    background: `color-mix(in srgb, ${baseHex} 17%, transparent)`,
    color: `color-mix(in srgb, ${baseHex} 56%, white)`,
    border: `1px solid color-mix(in srgb, ${baseHex} 40%, transparent)`,
  };
}
