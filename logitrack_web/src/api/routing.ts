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

export interface RoutingConfig {
  sla_force_horizon_hours: number;
  priority_force_threshold: number;
  min_fill_rate: number;
  enforce_time_windows: boolean;
}

export type DispatchRule = "sla_forced" | "consolidation";

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

export interface LastMileAssignment {
  driver_id: string;
  driver_name?: string;
  shipments: string[];           // tracking IDs nuevos (en el orden de ordered_stops)
  total_weight_kg: number;       // peso de los NUEVOS envíos
  existing_count: number;        // ya en ruta del día
  existing_weight_kg: number;
  existing_shipments?: string[]; // tracking IDs ya en out_for_delivery / delivery_failed
  // Campos VRP (presentes solo cuando OptimizedBy=vrp).
  ordered_stops?: RouteStop[];
  total_distance_km?: number;
  total_duration_min?: number;
  departure_min?: number;        // minutos desde medianoche (base para arrival_min)
  optimized_by?: "vrp" | "greedy";
  // Estado de aplicación del ítem.
  applied_shipments?: string[];
  applied?: boolean;
  applied_at?: string;
  applied_by?: string;
  // Runtime-only: el chofer ya inició su ruta del día — card informativa.
  route_started?: boolean;
}

export interface InterBranchAssignment {
  vehicle_id: string;
  license_plate: string;
  destination_branch: string;
  rule: DispatchRule;
  shipments: string[];           // tracking IDs nuevos
  total_weight_kg: number;       // peso de los NUEVOS envíos
  capacity_kg: number;
  existing_weight_kg: number;    // ya cargado en el vehículo
  existing_shipments?: string[]; // tracking IDs ya cargados en el vehículo (status loaded)
  // Estado de aplicación del ítem.
  applied_shipments?: string[];
  applied?: boolean;
  applied_at?: string;
  applied_by?: string;
  // Runtime-only: el vehículo ya está en viaje — card informativa.
  in_transit?: boolean;
}

export interface UnassignedShipment {
  tracking_id: string;
  destination: string;
  reason: string;
  weight_kg: number;
  priority: string;
}

export interface BlockedDriver {
  driver_id: string;
  driver_name?: string;
  reason: string;
}

export interface DriverLoad {
  driver_id: string;
  driver_name?: string;
  existing_count: number;
  existing_weight_kg: number;
  existing_shipments?: string[];
}

export interface VehicleLoad {
  vehicle_id: string;
  license_plate: string;
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
  blocked_drivers: BlockedDriver[];
  driver_loads: DriverLoad[];
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

export interface GlobalRoutingPlan {
  id: string;
  plan_date: string;       // YYYY-MM-DD
  status: PlanStatus;
  branch_plans: BranchPlan[];
  generated_at: string;
  applied_at?: string;
  applied_by?: string;
  log: GlobalPlanLog;
}

export const routingApi = {
  /** Obtiene el plan del día desde el servidor (generado por cron o regenerate). */
  getTodayPlan: () =>
    api.get<GlobalRoutingPlan>("/routing/plan/today").then((r) => r.data),

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
  ventana_horaria_inviable: "No se puede cumplir la ventana horaria del envío",
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
};
