/**
 * WCAG 2.1 contrast ratio utilities.
 *
 * All input hex colors must be in #RRGGBB format (lowercase or uppercase).
 */

/** Parse a #RRGGBB hex string into [R, G, B] in the 0–255 range. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = hex.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!match) {
    throw new Error(`Invalid hex color: ${hex}. Expected #RRGGBB format.`);
  }
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** sRGB channel → linear value (WCAG formula). */
function linearize(channel: number): number {
  const v = channel / 255;
  if (v <= 0.04045) {
    return v / 12.92;
  }
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Relative luminance per WCAG 2.1 definition.
 *
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * where each channel is first linearized from sRGB.
 */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * WCAG 2.1 contrast ratio between two hex colors.
 *
 * Formula: (L1 + 0.05) / (L2 + 0.05) where L1 >= L2.
 * Result is rounded to 2 decimal places.
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const raw = (lighter + 0.05) / (darker + 0.05);
  return Math.round(raw * 100) / 100;
}

/**
 * Return the WCAG 2.1 AA/AAA level for a foreground/background pair.
 *
 * - AAA: ratio >= 7
 * - AA:  ratio >= 4.5
 * - FAIL: ratio < 4.5
 */
export function getWCAGLevel(fg: string, bg: string): 'AAA' | 'AA' | 'FAIL' {
  const ratio = contrastRatio(fg, bg);
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'FAIL';
}
