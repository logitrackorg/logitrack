import type { VehicleStatus } from "../api/vehicles";

export const vehicleStatusLabel = (status: VehicleStatus): string => {
  switch (status) {
    case "disponible":    return "Disponible";
    case "en_carga":      return "En carga";
    case "mantenimiento": return "En mantenimiento";
    case "en_transito":   return "En tránsito";
    case "inactivo":      return "Inactivo";
    default:              return status;
  }
};

export const vehicleStatusColor = (status: VehicleStatus): string => {
  switch (status) {
    case "disponible":    return "#10b981";
    case "en_carga":      return "#f59e0b";
    case "mantenimiento": return "#f97316";
    case "en_transito":   return "#3b82f6";
    case "inactivo":      return "#6b7280";
    default:              return "#6b7280";
  }
};
