import { Truck } from "lucide-react";
import type { VehicleStatusResponse } from "../../../api/vehicles";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";

interface VehicleCardProps {
  assignedVehicle: VehicleStatusResponse | null;
  loadingVehicle: boolean;
  onShowDetail: () => void;
}

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  auto: "Auto",
  furgoneta: "Furgoneta",
  camion: "Camión",
  motocicleta: "Motocicleta",
  camion_grande: "Camión grande",
};

function statusPillClasses(status: string): string {
  switch (status) {
    case "disponible":
      return "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400";
    case "en_carga":
      return "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400";
    case "en_transito":
      return "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-400";
    case "mantenimiento":
      return "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400";
    case "inactivo":
      return "dark:bg-gray-700/50 bg-gray-100 dark:bg-gray-500/20 dark:text-gray-400 text-gray-600";
    default:
      return "dark:bg-gray-700/50 bg-slate-100 dark:bg-slate-500/20 dark:text-gray-400 text-slate-600 dark:text-slate-400";
  }
}

export function VehicleCard({ assignedVehicle, loadingVehicle, onShowDetail }: VehicleCardProps) {
  return (
    <Card className="mb-4 cursor-default">
      <CardHeader className="pb-3">
        <CardTitle>Vehículo asignado</CardTitle>
      </CardHeader>
      <CardContent>
        {loadingVehicle ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3.5 w-40" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ) : assignedVehicle ? (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Truck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p
                  onClick={onShowDetail}
                  className="text-base font-bold text-[var(--text-heading)] m-0 cursor-pointer underline decoration-dotted underline-offset-2 transition-colors duration-200 hover:text-[var(--brand)] truncate"
                >
                  {assignedVehicle.license_plate}
                </p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                  {VEHICLE_TYPE_LABELS[assignedVehicle.type] ?? assignedVehicle.type}
                  {" · "}
                  {assignedVehicle.capacity_kg} kg
                </p>
              </div>
              <div
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${statusPillClasses(assignedVehicle.status)}`}
              >
                {assignedVehicle.status_label}
              </div>
            </div>
            <div className="border-t border-[var(--border)] pt-2.5">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[var(--text-secondary)]">ID: </span>
                  <span className="font-semibold text-[var(--text-strong)]">#{assignedVehicle.id}</span>
                </div>
                {assignedVehicle.updated_by && (
                  <div>
                    <span className="text-[var(--text-secondary)]">Por: </span>
                    <span className="font-semibold text-[var(--text-strong)]">{assignedVehicle.updated_by}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <div className="w-12 h-12 rounded-full dark:bg-gray-700/50 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Truck className="w-10 h-10 text-[var(--text-muted)]" />
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] m-0">
              Sin vehículo asignado
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
