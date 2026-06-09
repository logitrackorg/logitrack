/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { organizationApi, type OrganizationBranding } from "../api/organizationApi";

/**
 * Convierte un color hex a un objeto HSL { h, s, l }.
 * Retorna null si el formato es inválido.
 */
function hexToHSL(hex: string): { h: number; s: number; l: number } | null {
  const match = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!match) return null;

  const r = parseInt(match[1].slice(0, 2), 16) / 255;
  const g = parseInt(match[1].slice(2, 4), 16) / 255;
  const b = parseInt(match[1].slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Genera un string hex desde HSL. */
function hslToHex(h: number, s: number, l: number): string {
  const a = (s * Math.min(l, 100 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.min(Math.max(color / 100, 0), 1))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Genera la paleta completa para un color primario: 10 tonos (50-950).
 * Usa el algoritmo de Tailwind para generar sombras desde un color base (~500).
 */
function generatePalette(hex: string): Record<string, string> {
  const hsl = hexToHSL(hex);
  if (!hsl) return {};

  const palette: Record<string, string> = {};

  // El color base se usa como el tono 500
  palette["500"] = hex;

  // Generar tonos más claros (50-400)
  const steps = [
    { key: "50",  l: 96, s: Math.max(hsl.s * 0.5, 20) },
    { key: "100", l: 90, s: Math.max(hsl.s * 0.6, 30) },
    { key: "200", l: 82, s: Math.max(hsl.s * 0.75, 40) },
    { key: "300", l: 70, s: hsl.s },
    { key: "400", l: 58, s: hsl.s },
  ];

  // Generar tonos más oscuros (600-950)
  const darkSteps = [
    { key: "600", l: Math.max(hsl.l - 8, 5) },
    { key: "700", l: Math.max(hsl.l - 16, 5) },
    { key: "800", l: Math.max(hsl.l - 24, 3) },
    { key: "900", l: Math.max(hsl.l - 32, 3) },
    { key: "950", l: Math.max(hsl.l - 40, 2) },
  ];

  for (const step of steps) {
    palette[step.key] = hslToHex(hsl.h, step.s, step.l);
  }
  for (const step of darkSteps) {
    palette[step.key] = hslToHex(hsl.h, hsl.s, step.l);
  }

  return palette;
}

/**
 * Inyecta las CSS custom properties en el :root del documento.
 * Los tokens semánticos (estados, superficies, texto, bordes) no se tocan.
 */
/** Tokens that may be overridden by org config. Cleared on reset. */
const ORG_TOKEN_KEYS = [
  "--brand-50", "--brand-100", "--brand-200", "--brand-300", "--brand-400",
  "--brand-500", "--brand-600", "--brand-700", "--brand-800", "--brand-900", "--brand-950",
  "--brand", "--brand-strong", "--brand-tint", "--brand-tint-border",
  "--accent-50", "--accent-100", "--accent-200", "--accent-300", "--accent-400",
  "--accent-500", "--accent-600", "--accent-700", "--accent-800", "--accent-900", "--accent-950",
  "--accent", "--accent-hover", "--accent-tint", "--accent-tint-border", "--accent-foreground",
  "--sidebar-bg", "--sidebar-hover", "--sidebar-border",
  "--text-heading",
  "--ring",
  "--fc-button-bg-color", "--fc-button-border-color",
  "--fc-button-hover-bg-color", "--fc-button-active-bg-color", "--fc-highlight-color",
];

function clearOrgTokens(root: HTMLElement) {
  for (const token of ORG_TOKEN_KEYS) {
    root.style.removeProperty(token);
  }
}

function injectThemeTokens(config: OrganizationBranding | null) {
  const root = document.documentElement;

  // Always clear stale org overrides first — fallback to index.css defaults
  clearOrgTokens(root);

  if (!config) return;

  // --brand palette
  const brandHex = config.primary_color || "";
  if (brandHex && hexToHSL(brandHex)) {
    const palette = generatePalette(brandHex);
    for (const [key, val] of Object.entries(palette)) {
      root.style.setProperty(`--brand-${key}`, val);
    }
    root.style.setProperty("--brand", brandHex);
    root.style.setProperty("--brand-strong", palette["700"] || brandHex);
    root.style.setProperty("--brand-tint", `${brandHex}14`);
    root.style.setProperty("--brand-tint-border", `${brandHex}34`);

    // Sidebar item hover → brand color
    root.style.setProperty("--sidebar-hover", brandHex);

    // Focus rings (shadcn --ring token)
    root.style.setProperty("--ring", brandHex);

    // FullCalendar navigation buttons
    root.style.setProperty("--fc-button-bg-color", brandHex);
    root.style.setProperty("--fc-button-border-color", brandHex);
    root.style.setProperty("--fc-button-hover-bg-color", palette["600"] || brandHex);
    root.style.setProperty("--fc-button-active-bg-color", palette["700"] || brandHex);
    root.style.setProperty("--fc-highlight-color", `${brandHex}1a`);

    // Heading text → brand-800 tone
    root.style.setProperty("--text-heading", palette["800"] || brandHex);
  }

  // --accent palette
  const accentHex = config.accent_color || "";
  if (accentHex && hexToHSL(accentHex)) {
    const palette = generatePalette(accentHex);
    for (const [key, val] of Object.entries(palette)) {
      root.style.setProperty(`--accent-${key}`, val);
    }
    root.style.setProperty("--accent", accentHex);
    root.style.setProperty("--accent-hover", palette["600"] || accentHex);
    root.style.setProperty("--accent-tint", `${accentHex}14`);
    root.style.setProperty("--accent-tint-border", `${accentHex}34`);
    root.style.setProperty("--accent-foreground", "#ffffff");
  }

  // --sidebar color + border derivado
  if (config.sidebar_color) {
    const sidebarHSL = hexToHSL(config.sidebar_color);
    root.style.setProperty("--sidebar-bg", config.sidebar_color);
    if (sidebarHSL) {
      // Borde del sidebar: 10% más oscuro que el fondo
      root.style.setProperty(
        "--sidebar-border",
        hslToHex(sidebarHSL.h, sidebarHSL.s, Math.max(sidebarHSL.l - 10, 0))
      );
    }
  }
}

/** Context shape: exposed only for potential consumer components. */
interface OrganizationThemeCtx {
  config: OrganizationBranding | null;
  loading: boolean;
  refreshTheme: () => Promise<void>;
  resetTheme: () => void;
}

const Ctx = createContext<OrganizationThemeCtx>({
  config: null,
  loading: true,
  refreshTheme: async () => {},
  resetTheme: () => {},
});

export function OrganizationThemeProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<OrganizationBranding | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAndInject = async () => {
    setLoading(true);
    try {
      const cfg = await organizationApi.getPublic();
      if (cfg && Object.keys(cfg).length > 0) {
        setConfig(cfg);
        injectThemeTokens(cfg);
      } else {
        setConfig(null);
        injectThemeTokens(null);
      }
    } catch {
      setConfig(null);
      injectThemeTokens(null);
    } finally {
      setLoading(false);
    }
  };

  const resetTheme = () => {
    clearOrgTokens(document.documentElement);
    setConfig(null);
  };

  useEffect(() => {
    fetchAndInject();
  }, []);

  return (
    <Ctx.Provider value={{ config, loading, refreshTheme: fetchAndInject, resetTheme }}>
      {children}
    </Ctx.Provider>
  );
}

/** Hook para consumir la config de la organización. */
export function useOrganizationTheme() {
  return useContext(Ctx);
}
