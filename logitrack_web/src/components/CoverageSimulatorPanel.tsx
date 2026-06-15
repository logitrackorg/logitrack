import { Target } from "lucide-react";

export const SIM_AREA_MIN = 10_000;
export const SIM_AREA_MAX = 3_000_000;
export const SIM_AREA_STEP = 10_000;
export const SIM_AREA_DEFAULT = 500_000;

interface CoverageSimulatorPanelProps {
  /** Área simulada en km² — estado "instantáneo" que sigue al slider sin llamar al servidor. */
  areaKm2: number;
  /** Se llama en cada movimiento del slider; solo actualiza la previsualización local. */
  onAreaChange: (areaKm2: number) => void;
  /** Se llama al confirmar, con el valor final del slider, para disparar el recálculo en el backend. */
  onConfirm: (areaKm2: number) => void;
  /** A qué sucursal(es) se aplica el círculo de previsualización. */
  scopeLabel: string;
}

/**
 * Panel con slider para previsualizar un radio de cobertura (en km²) sobre el
 * mapa de Voronoi mediante un círculo naranja punteado. El slider actualiza la
 * UI al instante (sin tocar el servidor); el botón "Confirmar y Diagnosticar"
 * dispara el recálculo real (Voronoi + recorte) con el valor elegido.
 */
export function CoverageSimulatorPanel({
  areaKm2,
  onAreaChange,
  onConfirm,
  scopeLabel,
}: CoverageSimulatorPanelProps) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
        <Target className="w-4 h-4 text-orange-500" /> Simulador de cobertura
      </h3>

      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-300">Radio de prueba</span>
        <span className="font-mono font-semibold text-orange-600 dark:text-orange-400">
          {areaKm2.toLocaleString("es-AR")} km²
        </span>
      </div>

      <input
        type="range"
        min={SIM_AREA_MIN}
        max={SIM_AREA_MAX}
        step={SIM_AREA_STEP}
        value={areaKm2}
        onChange={(e) => onAreaChange(Number(e.target.value))}
        className="w-full accent-orange-500 cursor-pointer"
        aria-label="Área de cobertura simulada en kilómetros cuadrados"
      />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Previsualizando sobre: <strong>{scopeLabel}</strong>
      </p>

      <button
        onClick={() => onConfirm(areaKm2)}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-orange-500 text-white hover:bg-orange-600 cursor-pointer transition-colors"
      >
        Confirmar y Diagnosticar
      </button>
    </div>
  );
}
