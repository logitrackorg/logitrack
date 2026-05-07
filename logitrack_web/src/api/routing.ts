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
  max_shipments_per_driver: number;
  max_weight_kg_per_driver: number;
}

export type DispatchRule = "sla_forced" | "consolidation";

export interface LastMileAssignment {
  driver_id: string;
  driver_name?: string;
  shipments: string[];           // tracking IDs nuevos
  total_weight_kg: number;       // peso de los NUEVOS envíos
  existing_count: number;        // ya en ruta del día
  existing_weight_kg: number;
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
}

export interface VehicleLoad {
  vehicle_id: string;
  license_plate: string;
  capacity_kg: number;
  existing_weight_kg: number;
}

export interface RoutingPlan {
  branch_id: string;
  generated_at: string;
  last_mile: LastMileAssignment[];
  inter_branch: InterBranchAssignment[];
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

export const routingApi = {
  generate: (branchId: string) =>
    api.post<RoutingPlan>("/routing/plan", { branch_id: branchId }).then((r) => r.data),
  apply: (branchId: string, plan: RoutingPlan) =>
    api
      .post<ApplyPlanResponse>("/routing/apply", { branch_id: branchId, plan })
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
