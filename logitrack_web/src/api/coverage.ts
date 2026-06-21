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

/**
 * Ubicación sugerida para una nueva sucursal, derivada de un fragmento del
 * área Voronoi de una sucursal con gap crítico que el radio simulado no llega
 * a cubrir (celda menos círculo de cobertura simulado).
 */
export interface SuggestedLocation {
  lat: number;
  lng: number;
  branch_id: string;
  branch_name: string;
  gap_area_km2: number;
  /** Área real (km²) que aportaría el círculo de cobertura simulado sobre territorio argentino. */
  actual_added_km2: number;
  /** Sucursales existentes cuyas celdas de Voronoi se ven aliviadas por esta sugerencia. */
  affected_branches: string[];
  /** Nombre de la ciudad real más cercana al punto matemático (solo en mathematical_suggestions). */
  city_name?: string;
  /** true cuando el servidor aterrizó esta sugerencia en una ciudad real (Phase 4). */
  is_snapped?: boolean;
  /** Población de la ciudad aterrizda; 0 cuando is_snapped=false. */
  population?: number;
  /** Densidad poblacional (hab./km²) de la celda Voronoi — solo en modo "density". */
  density?: number;
  /** true cuando hay zonas industriales OSM dentro de ~10 km (modo density + prioritize_industrial). */
  has_industrial_zone?: boolean;
  /** Tipo de terreno: "Llano", "Llano-Ventoso", "Semi-montañoso", "Serrano", "Montañoso". */
  terrain_type?: string;
  /** Índice de Viabilidad Logística (1–100) calculado por el backend. */
  score?: number;
}

/** Ciudad candidata que no pasó algún filtro de densidad, población o proximidad. */
export interface RejectedLocation {
  city_name: string;
  lat: number;
  lng: number;
  reject_reason: string;
  /** Índice de Viabilidad Logística (1–100) calculado en el momento del rechazo. */
  score?: number;
}

export interface SimulationResult {
  simulated_area_km2: number;
  cells: SimulationDiagnosis[];
  suggested_locations: SuggestedLocation[];
  /** Sugerencias globales derivadas del vacío total (TierraFértil − ∪ círculos de cobertura).
   *  El backend las devuelve separadas; el cliente las fusiona en `suggested_locations`
   *  al recibir la respuesta para que todo el pipeline (mapa, snap-to-city, descarte) las
   *  trate de forma homogénea. */
  mathematical_suggestions?: SuggestedLocation[];
  /** Voronoi cells with polygon geometry from this diagnosis run. Only present
   *  when branches were excluded — the client uses them to update map shapes. */
  diagram_cells?: CoverageCell[];
  /** Ciudades evaluadas en modo density que no pasaron al menos un filtro. Solo en modo density. */
  rejected_locations?: RejectedLocation[];
}

/**
 * Resultado de "Snap to City" para un punto sugerido: lugar poblado real más
 * cercano (OSM Overpass) dentro del radio de cobertura simulado.
 * `is_snapped = false` cuando no se encontró ningún lugar poblado dentro del
 * radio de búsqueda — el punto geométrico original debe conservarse en ese
 * caso.
 */
export interface SnappedCity {
  lat: number;
  lng: number;
  city_name: string;
  is_snapped: boolean;
  /** Población efectiva de la ciudad elegida (tag OSM o fallback por tipo). 0 / ausente cuando is_snapped=false. */
  population?: number;
  /** Razón por la que no se encontró ciudad. "TIMEOUT" = error de red/API; "NO_RESULTS" = no hay ciudad en el radio. */
  error_reason?: string;
  /**
   * Frontend-only (no proviene del backend): true cuando el usuario "pausó"
   * esta sugerencia para un análisis What-If sin descartarla. Las
   * sugerencias pausadas se ocultan del mapa y se excluyen de la Proyección
   * de Impacto.
   */
  is_paused?: boolean;
}

export interface SnapToCityResponse {
  results: SnappedCity[];
}

/**
 * Compara, para cada sucursal existente, su porcentaje de cobertura actual
 * contra el que tendría si la red incluyera también las sugerencias activas
 * (`ProjectionRequest.suggestions`) — la sección "Proyección de Impacto".
 */
export interface BranchProjection {
  branch_id: string;
  branch_name: string;
  current_coverage_pct: number;
  projected_coverage_pct: number;
}

export interface ProjectionResult {
  branches: BranchProjection[];
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

  /**
   * Evalúa un radio de cobertura simulado (km²) contra el área Voronoi real de cada sucursal.
   * excludedBranchIds: IDs de sucursales a excluir del cálculo (simulación de cierre).
   * customBoundingArea: polígono dibujado por el usuario — recorta el diagnóstico a esa zona.
   */
  diagnose: (
    areaKm2: number,
    excludedBranchIds?: string[],
    customBoundingArea?: LatLng[],
    includeInactive?: boolean,
    maxSuggestions?: number,
    snapToCities?: boolean,
    mode?: "area" | "density",
    density?: {
      minPopulation?: number;
      minDensity?: number;
      rankingMode?: "population" | "gap_area";
      excludedCities?: string[];
      additionalSites?: LatLng[];
      prioritizeIndustrial?: boolean;
      applyTerrainFriction?: boolean;
      maxDistFromNetwork?: number;
      minScore?: number;
    },
  ) =>
    api
      .post<SimulationResult>("/coverage/diagnose", {
        area_km2: areaKm2,
        ...(excludedBranchIds?.length ? { excluded_branch_ids: excludedBranchIds } : {}),
        ...(customBoundingArea?.length ? { custom_bounding_area: customBoundingArea } : {}),
        ...(includeInactive ? { include_inactive: true } : {}),
        ...(maxSuggestions && maxSuggestions > 0 ? { max_suggestions: maxSuggestions } : {}),
        ...(snapToCities ? { snap_to_cities: true } : {}),
        ...(mode && mode !== "area" ? { mode } : {}),
        ...(density && Object.keys(density).length > 0
          ? {
              density: {
                ...(density.minPopulation && density.minPopulation > 0 ? { min_population: density.minPopulation } : {}),
                ...(density.minDensity && density.minDensity > 0 ? { min_density: density.minDensity } : {}),
                ...(density.rankingMode && density.rankingMode !== "population" ? { ranking_mode: density.rankingMode } : {}),
                ...(density.excludedCities?.length ? { excluded_cities: density.excludedCities } : {}),
                ...(density.additionalSites?.length ? { additional_sites: density.additionalSites } : {}),
                ...(density.prioritizeIndustrial ? { prioritize_industrial: true } : {}),
                ...(density.applyTerrainFriction ? { apply_terrain_friction: true } : {}),
                ...(density.maxDistFromNetwork && density.maxDistFromNetwork > 0 ? { max_dist_from_network_km: density.maxDistFromNetwork } : {}),
                ...(density.minScore && density.minScore > 0 ? { min_score: density.minScore } : {}),
              },
            }
          : {}),
      })
      .then((r) => r.data),

  /**
   * "Aterrizar sugerencias en ciudades reales": resuelve cada punto
   * geométrico sugerido al lugar poblado real más cercano dentro de
   * `radiusKm` (la zona de cobertura simulada). Devuelve un resultado por
   * punto, en el mismo orden.
   */
  /**
   * blacklistedCities: nombres de ciudades a excluir de la selección en este reintento
   * (ciudades descartadas por el usuario en reintentos anteriores).
   */
  snapToCity: (points: LatLng[], radiusKm: number, minPopulation = 0, blacklistedCities?: string[]) =>
    api
      .post<SnapToCityResponse>("/coverage/snap-to-city", {
        points,
        radius_km: radiusKm,
        min_population: minPopulation,
        ...(blacklistedCities?.length ? { blacklisted_cities: blacklistedCities } : {}),
      })
      .then((r) => r.data.results),

  /**
   * "Proyección de Impacto": recalcula el diagrama de Voronoi incluyendo las
   * sugerencias activas y devuelve, para cada sucursal existente, su
   * cobertura actual vs. proyectada con el mismo área simulada.
   */
  project: (areaKm2: number, suggestions: LatLng[], customBoundingArea?: LatLng[]) =>
    api
      .post<ProjectionResult>("/coverage/project", {
        area_km2: areaKm2,
        suggestions,
        ...(customBoundingArea?.length ? { custom_bounding_area: customBoundingArea } : {}),
      })
      .then((r) => r.data),

  /**
   * Returns OSM industrial-zone centroids inside the given bounding box as
   * [lat, lng] pairs for the leaflet.heat layer. Empty array when the bbox is
   * too large or Overpass is unreachable. Results are cached 15 min server-side.
   * bbox format: "minLon,minLat,maxLon,maxLat" (Leaflet getBounds order).
   */
  getIndustrialHeatmap: (bbox: string) =>
    api
      .get<[number, number][]>("/coverage/industrial-heatmap", { params: { bbox } })
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
