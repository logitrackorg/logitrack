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
  },
);

export type LastMilePackingStrategy = "balanced" | "maximize_capacity";

export type RouteMode = "ventanas" | "segura" | "costo";

export interface RecomputeLastMileRequest {
  vehicle_id: string;
  shipment_ids: string[];
  mode: RouteMode;
}

export interface RoutingConfig {
  sla_force_horizon_hours: number;
  priority_force_threshold: number;
  min_fill_rate: number;
  min_fill_last_mile_rate: number;
  min_fill_inter_branch_rate: number;
  enforce_time_windows: boolean;
  morning_window_start_hour: number;
  morning_window_end_hour: number;
  afternoon_window_start_hour: number;
  afternoon_window_end_hour: number;
  service_time_minutes: number;
  avg_speed_kmh: number;
  last_mile_packing_strategy: LastMilePackingStrategy;
  inter_branch_dispatch_hour: number;
  inter_branch_avg_speed_kmh: number;
  inter_branch_stop_minutes: number;
  planning_horizon_days: number;
  backhaul_enabled: boolean;
  keep_one_vehicle_per_branch: boolean;
}

export type DispatchRule = "sla_forced" | "consolidation" | "manual";

export interface RouteStop {
  tracking_id: string;
  sequence: number;            // 1-based
  arrival_min: number;          // minutos desde departure_min; -1 si unsequenced o manual
  unsequenced?: boolean;        // del backend: el envío no tiene coords, no entró al solver
  manual?: boolean;             // cliente-side: el operador lo asignó manualmente (post-VRP)
  time_window?: "morning" | "afternoon" | "flexible" | "";
  weight_kg: number;
  within_window?: boolean;       // false = arribo fuera de ventana (solo en modo blando); omitido en stops manuales
  window_deviation_min?: number; // positivo=tarde, negativo=temprano (en minutos)
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface LastMileAssignment {
  vehicle_id: string;
  license_plate: string;
  capacity_kg: number;
  driver_id?: string;
  driver_name?: string;
  shipments: string[];
  total_weight_kg: number;
  existing_weight_kg: number;
  existing_shipments?: string[];
  // Estado de aplicación del ítem.
  applied_shipments?: string[];
  applied?: boolean;
  applied_at?: string;
  applied_by?: string;
  // Runtime-only: el vehículo ya está en viaje — card informativa.
  in_transit?: boolean;
  // Campos VRP: presentes cuando el scheduler pudo optimizar el orden de paradas.
  suggested_departure_min?: number; // minutos desde medianoche (hora local)
  ordered_stops?: RouteStop[];
  window_coverage?: number;         // 0.0 – 1.0
  route_mode?: RouteMode;
  // Geometría real del trayecto (vía calles, OSRM). Cuando está presente, el
  // mapa la usa para dibujar la polyline. Ausente → fallback a líneas rectas.
  polyline_coords?: LatLng[];
}

export interface AssignmentStop {
  branch_id: string;
  shipments: string[];
  total_weight_kg: number;
  pickup_shipments?: string[];
  pickup_weight_kg?: number;
  estimated_arrival_min?: number; // minutos desde medianoche (hora local)
}

export interface InterBranchAssignment {
  vehicle_id: string;
  license_plate: string;
  destination_branch: string;    // primera parada (primary)
  rule: DispatchRule;
  shipments: string[];           // todos los tracking IDs (primary + additional)
  total_weight_kg: number;       // peso total (todas las paradas)
  capacity_kg: number;
  existing_weight_kg: number;
  existing_shipments?: string[];
  // Multi-hop: paradas adicionales (hops 2 y 3). Máximo 2.
  additional_stops?: AssignmentStop[];
  // Pickups cross-branch en la primary stop (envíos at_hub que se recogen al pasar)
  primary_pickup_shipments?: string[];
  primary_pickup_weight_kg?: number;
  // Estado de aplicación del ítem.
  applied_shipments?: string[];
  applied?: boolean;
  applied_at?: string;
  applied_by?: string;
  // Runtime-only: el vehículo ya está en viaje — card informativa.
  in_transit?: boolean;
  // Schedule inter-sucursal: calculados por scheduleInterBranchAssignments.
  estimated_departure_min?: number;       // minutos desde medianoche (hora local)
  primary_estimated_arrival_min?: number;
  estimated_arrival_min?: number;         // última parada
  // Backhaul: carga de retorno al origen (si el dispatch es un round-trip).
  backhaul?: { shipments: string[]; total_weight_kg: number; fill_rate_pct: number };
}

export interface UnassignedShipment {
  tracking_id: string;
  destination: string;
  reason: string;
  weight_kg: number;
  priority: string;
}

export interface VehicleLoad {
  vehicle_id: string;
  license_plate: string;
  mode: "ultima_milla" | "inter_sucursal";
  capacity_kg: number;
  existing_weight_kg: number;
  existing_shipments?: string[];
}

export interface IncomingVehicle {
  vehicle_id: string;
  license_plate: string;
  origin_branch: string;
  shipments: string[];
  total_weight_kg: number;
  capacity_kg: number;
}

export interface RoutingPlan {
  branch_id: string;
  generated_at: string;
  last_mile: LastMileAssignment[];
  inter_branch: InterBranchAssignment[];
  incoming_vehicles?: IncomingVehicle[];
  unassigned: UnassignedShipment[];
  vehicle_loads: VehicleLoad[];
  config_snapshot: RoutingConfig;
}

export interface ApplyResultItem {
  tracking_id: string;
  target: string;
  status: "applied" | "skipped" | "failed";
  error?: string;
}

export interface ApplyPlanResponse {
  applied_count: number;
  failed_count: number;
  items: ApplyResultItem[];
}

export type PlanStatus = "pending" | "applying" | "applied" | "expired";

export interface GlobalPlanLog {
  total_candidates: number;
  total_assigned: number;
  total_unassigned: number;
  total_branches: number;
}

export interface BranchPlan {
  branch_id: string;
  plan: RoutingPlan;
}

export interface EmptyMoveSuggestion {
  vehicle_id: string;
  license_plate: string;
  capacity_kg: number;
  from_branch_id: string;
  to_branch_id: string;
  distance_km: number;
  unserved_shipments: number;
  reason: string;
}

export interface ConsolidationDispatch {
  from_branch_id: string;
  vehicle_id: string;
  license_plate: string;
  total_weight_kg: number;
  capacity_kg: number;
}

export interface ConsolidationOpportunity {
  destination_branch_id: string;
  dispatches: ConsolidationDispatch[];
  total_weight_kg: number;
  avg_fill_rate_pct: number;
}

export interface NetworkMetrics {
  total_shipments_assigned: number;
  total_shipments_unassigned: number;
  total_vehicles_dispatched: number;
  idle_vehicles_count: number;
  avg_vehicle_utilization_pct: number;
  branches_with_unserved_demand: number;
}

export interface NetworkInsights {
  empty_moves?: EmptyMoveSuggestion[];
  consolidation_opportunities?: ConsolidationOpportunity[];
  metrics?: NetworkMetrics;
}

export interface GlobalRoutingPlan {
  id: string;
  plan_date: string;       // YYYY-MM-DD
  status: PlanStatus;
  branch_plans: BranchPlan[];
  generated_at: string;
  applied_at?: string;
  applied_by?: string;
  log: GlobalPlanLog;
  insights?: NetworkInsights;
  /** HorizonOffset: 0=hoy (aplicable), 1/2=pronóstico read-only */
  horizon_offset?: number;
  /** IsForecast: true cuando horizon_offset > 0. No se puede aplicar. */
  is_forecast?: boolean;
}

export const routingApi = {
  /** Obtiene el plan del día desde el servidor (generado por cron o regenerate). */
  getTodayPlan: () =>
    api.get<GlobalRoutingPlan>("/routing/plan/today").then((r) => r.data),

  /** Obtiene el horizonte de planes: hoy + pronósticos. */
  getHorizonPlans: () =>
    api.get<GlobalRoutingPlan[]>("/routing/plan/horizon").then((r) => r.data),

  /** Regenera el plan del día para la sucursal del usuario (operator/supervisor). */
  regenerate: () =>
    api.post<GlobalRoutingPlan>("/routing/regenerate").then((r) => r.data),

  /** Genera el plan global de toda la red. Solo admin. Devuelve métricas. */
  regenerateGlobal: () =>
    api.post<{ plan_date: string; status: string; log: GlobalPlanLog; generated_at: string }>("/routing/regenerate/global").then((r) => r.data),

  /**
   * Aplica el plan de ruteo con granularidad configurable:
   * - `vehicleId` → solo ese despacho inter-sucursal
   * - `driverId`  → solo esa ruta de última milla
   * - ninguno     → todos los ítems pendientes de la sucursal
   * - `plan`      → plan editado en cliente (drag-and-drop, legacy)
   */
  apply: (branchId: string, opts?: { plan?: RoutingPlan; vehicleId?: string; driverId?: string }) =>
    api
      .post<ApplyPlanResponse>("/routing/apply", {
        branch_id: branchId,
        ...(opts?.plan ? { plan: opts.plan } : {}),
        ...(opts?.vehicleId ? { vehicle_id: opts.vehicleId } : {}),
        ...(opts?.driverId ? { driver_id: opts.driverId } : {}),
      })
      .then((r) => r.data),

  getConfig: () => api.get<RoutingConfig>("/routing/config").then((r) => r.data),
  updateConfig: (cfg: RoutingConfig) =>
    api.patch<RoutingConfig>("/routing/config", cfg).then((r) => r.data),

  /** Recalcula el orden de paradas y horario sugerido para una asignación de última milla. */
  recomputeLastMile: (req: RecomputeLastMileRequest) =>
    api.post<LastMileAssignment>("/routing/last-mile/recompute", req).then((r) => r.data),
};

// Diccionario de etiquetas para los códigos de razón devueltos por el backend.
export const REASON_LABELS: Record<string, string> = {
  // Generate
  sin_choferes_disponibles: "No hay choferes disponibles en la sucursal",
  sin_capacidad_en_choferes: "Los choferes ya están al tope de su capacidad",
  choferes_ya_iniciaron_ruta: "Los choferes de la sucursal ya iniciaron su ruta del día",
  sin_vehiculos_disponibles: "No hay vehículos disponibles en la sucursal",
  sin_vehiculos_para_destino: "No hay vehículos elegibles para este destino",
  esperando_consolidacion: "Esperando consolidación con otros envíos al mismo destino",
  sobrepeso_excede_vehiculo: "Excede capacidad del vehículo más grande",
  ruta_ya_iniciada: "El chofer ya inició su ruta del día",
  chofer_inicio_ruta: "El chofer ya está en ruta — reasignalo a otro o regenerá",
  vehiculo_en_viaje: "El vehículo ya está en viaje — reasignalo a otro o regenerá",
  consolidado_en_viaje_multi_hop: "Consolidado en un viaje multi-hop que pasa por este destino",
  tramo_subutilizado: "El tramo final no alcanza el % mínimo de carga — esperando más envíos",
  sin_vehiculos_ultima_milla_disponibles: "No hay vehículos de última milla disponibles",
  ventana_horaria_inviable: "No se puede cumplir la ventana horaria del envío",
  ventana_horaria_vencida: "Ventana horaria vencida para hoy — programado para mañana",
  reteniendo_ultimo_vehiculo_sucursal: "Se retiene el último vehículo de la sucursal (balanceo de flota)",
  // Apply
  envio_no_encontrado: "Envío no encontrado",
  envio_no_pertenece_a_sucursal: "El envío ya no pertenece a esta sucursal",
  vehiculo_no_encontrado: "Vehículo no encontrado",
  vehiculo_no_pertenece_a_sucursal: "El vehículo no pertenece a esta sucursal",
  vehiculo_no_disponible: "El vehículo cambió de estado y no está disponible",
  vehiculo_destino_diferente: "El vehículo ya tiene otro destino seteado",
  capacidad_excedida: "Se excedió la capacidad del vehículo",
  error_seteando_destino: "No se pudo setear el destino del vehículo",
};

// Traduce un código de razón (snake_case) a texto en español.
// Para códigos compuestos como "estado_cambio:loaded", muestra el detalle.
export function reasonLabel(code: string): string {
  if (code.startsWith("estado_cambio:")) {
    const newStatus = code.split(":")[1] ?? "?";
    return `El estado del envío cambió a "${newStatus}"`;
  }
  return REASON_LABELS[code] ?? code;
}

export const DISPATCH_RULE_LABELS: Record<DispatchRule, string> = {
  sla_forced: "SLA crítico",
  consolidation: "Consolidación",
  manual: "Asignación manual",
};

export interface InterBranchTrip {
  id: string;
  kind: "inter_branch" | "last_mile";
  vehicle_id: string;
  license_plate: string;
  origin_branch_id: string;
  destination_branch_id?: string;
  shipment_ids: string[];
  status: "pendiente" | "en_transito" | "completado" | "cancelado";
  stops?: {
    branch_id: string;
    shipment_ids: string[];
    pickup_shipment_ids?: string[];
    completed_at?: string;
  }[];
  created_at: string;
  started_at?: string;
}

export const tripsApi = {
  getByID: (id: string) =>
    api.get<InterBranchTrip>(`/inter-branch-trips/${id}`).then((r) => r.data),
};
