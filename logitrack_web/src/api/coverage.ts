import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export interface LatLng {
  lat: number;
  lng: number;
}

export type GapSeverity = "" | "leve" | "moderado" | "critico";

export interface CoverageCell {
  branch_id: string;
  branch_name: string;
  province: string;
  site: LatLng;
  /**
   * Geometría de la celda recortada contra el contorno real de Argentina: un
   * anillo cerrado por fragmento de territorio desconectado (p.ej. continente
   * + Tierra del Fuego).
   */
  polygon: LatLng[][];
  area_km2: number;
  is_gap: boolean;
  gap_severity: GapSeverity;
  /** Ubicación sugerida para una nueva sucursal (centroide de la celda) — solo en gaps. */
  suggestion?: LatLng | null;
}

export interface CoverageDiagram {
  cells: CoverageCell[];
  threshold_km2: number;
  total_area_km2: number;
  branch_count: number;
  gap_count: number;
  computed_at: string;
}

export interface BranchRecommendation {
  branch_id: string;
  branch_name: string;
  area_km2: number;
  is_gap: boolean;
  gap_severity: GapSeverity;
}

/** Diagnóstico del simulador para una sucursal: cobertura simulada vs. área Voronoi real. */
export interface SimulationDiagnosis {
  branch_id: string;
  branch_name: string;
  voronoi_area_km2: number;
  coverage_percentage: number;
  deficit_km2: number;
  is_gap: boolean;
  severity: GapSeverity;
}

export interface SimulationResult {
  simulated_area_km2: number;
  cells: SimulationDiagnosis[];
}

export const coverageApi = {
  getDiagram: () =>
    api.get<CoverageDiagram>("/coverage/diagram").then((r) => r.data),

  /** Sucursal óptima para una coordenada, con info de cobertura. Devuelve null si no hay sucursales. */
  branchForPoint: (lat: number, lng: number) =>
    api
      .get<{ branch_id: string | null } & Partial<BranchRecommendation>>("/coverage/branch-for", {
        params: { lat, lng },
      })
      .then((r) =>
        r.data.branch_id ? (r.data as BranchRecommendation) : null
      ),

  /** Evalúa un radio de cobertura simulado (km²) contra el área Voronoi real de cada sucursal. */
  diagnose: (areaKm2: number) =>
    api
      .get<SimulationResult>("/coverage/diagnose", { params: { area_km2: areaKm2 } })
      .then((r) => r.data),
};

// Paleta por severidad de gap (consistente con StatusBadge/PriorityBadge del sistema).
export const GAP_STYLE: Record<
  Exclude<GapSeverity, "">,
  { stroke: string; fill: string; badge: string; label: string }
> = {
  leve: {
    stroke: "#f59e0b",
    fill: "rgba(245,158,11,0.18)",
    badge: "bg-amber-100 text-amber-800",
    label: "Leve",
  },
  moderado: {
    stroke: "#f97316",
    fill: "rgba(249,115,22,0.22)",
    badge: "bg-orange-100 text-orange-800",
    label: "Moderado",
  },
  critico: {
    stroke: "#ef4444",
    fill: "rgba(239,68,68,0.28)",
    badge: "bg-rose-100 text-rose-800",
    label: "Crítico",
  },
};

// Estilo de celda bien cubierta (sin gap).
export const COVERED_STYLE = {
  stroke: "#10b981",
  fill: "rgba(16,185,129,0.12)",
};
