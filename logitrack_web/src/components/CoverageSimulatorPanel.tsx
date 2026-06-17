import { useState } from "react";
import { Eye, EyeOff, Globe, Pencil, Trash2 } from "lucide-react";

export const SIM_AREA_MIN = 100;
export const SIM_AREA_MAX = 1_000_000;
export const SIM_AREA_STEP = 1_000;
export const SIM_AREA_DEFAULT = 500_000;

const MIN_POP_MAX = 500_000;
const MIN_POP_STEP = 10_000;
const MIN_POP_DEFAULT = 0;

export type TerritoryMode = "national" | "custom";

interface CoverageSimulatorPanelProps {
  /** Área simulada en km² — estado "instantáneo" que sigue al slider sin llamar al servidor. */
  areaKm2: number;
  /** Se llama en cada movimiento del slider; solo actualiza la previsualización local. */
  onAreaChange: (areaKm2: number) => void;
  /** Se llama al confirmar con el área y la población mínima elegidas. */
  onConfirm: (areaKm2: number, minPopulation: number) => void;
  /**
   * Notifica al padre en cada movimiento del slider de población mínima, no
   * solo al confirmar. Necesario para que "Reintentar sugerencias pendientes"
   * use el valor actual del slider y no el de la última confirmación.
   */
  onMinPopulationChange?: (minPopulation: number) => void;
  /** A qué sucursal(es) se aplica el círculo de previsualización. */
  scopeLabel: string;
  /** Bloquea el slider y el botón de confirmación (p.ej. mientras se geocodifican sugerencias). */
  disabled?: boolean;
  /** Lista de sucursales disponibles para la simulación de cierre. */
  branches?: Array<{ id: string; label: string }>;
  /** IDs de sucursales actualmente "cerradas" en la simulación. */
  hiddenBranchIds?: string[];
  /** Toggle de visibilidad de una sucursal. */
  onToggleBranch?: (id: string) => void;
  /** Restaura todas las sucursales ocultas. */
  onRestoreAllBranches?: () => void;
  /** Modo de territorio: "national" = Argentina completa, "custom" = área dibujada. */
  territoryMode?: TerritoryMode;
  /** Notifica al padre cuando el usuario cambia el modo de territorio. */
  onTerritoryModeChange?: (mode: TerritoryMode) => void;
  /** Cantidad de vértices del polígono personalizado actualmente dibujado (0 = no dibujado). */
  customBoundaryPoints?: number;
  /** true cuando el usuario está en proceso de dibujar el polígono en el mapa. */
  isDrawingBoundary?: boolean;
  /** Limpia el polígono personalizado y reactiva el modo de dibujo. */
  onClearBoundary?: () => void;
}

export function CoverageSimulatorPanel({
  areaKm2,
  onAreaChange,
  onConfirm,
  onMinPopulationChange,
  scopeLabel,
  disabled = false,
  branches,
  hiddenBranchIds,
  onToggleBranch,
  onRestoreAllBranches,
  territoryMode = "national",
  onTerritoryModeChange,
  customBoundaryPoints = 0,
  isDrawingBoundary = false,
  onClearBoundary,
}: CoverageSimulatorPanelProps) {
  const [minPopulation, setMinPopulation] = useState(MIN_POP_DEFAULT);

  const hasBoundary = customBoundaryPoints >= 3;

  return (
    <div className="space-y-3">
      {/* Toggle Territorio Nacional / Área Personalizada */}
      <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-gray-600 text-xs font-medium">
        <button
          type="button"
          onClick={() => onTerritoryModeChange?.("national")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 transition-colors cursor-pointer ${
            territoryMode === "national"
              ? "bg-slate-700 text-white"
              : "bg-white dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-700"
          }`}
        >
          <Globe className="w-3 h-3" /> Territorio Nacional
        </button>
        <button
          type="button"
          onClick={() => onTerritoryModeChange?.("custom")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 transition-colors cursor-pointer border-l border-slate-200 dark:border-gray-600 ${
            territoryMode === "custom"
              ? "bg-blue-600 text-white"
              : "bg-white dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-700"
          }`}
        >
          <Pencil className="w-3 h-3" /> Área Personalizada
        </button>
      </div>

      {/* Estado del área personalizada */}
      {territoryMode === "custom" && (
        <div className={`rounded-md px-3 py-2 text-xs ${
          isDrawingBoundary
            ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300"
            : hasBoundary
            ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
            : "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300"
        }`}>
          {isDrawingBoundary ? (
            <>
              <span className="font-semibold">Dibujando área...</span> Hacé clic en el mapa para agregar vértices.{" "}
              <span className="opacity-75">Enter cierra · Esc cancela · ⌘Z deshace</span>
            </>
          ) : hasBoundary ? (
            <div className="flex items-center justify-between gap-2">
              <span><span className="font-semibold">Área activa</span> · {customBoundaryPoints} vértices</span>
              <button
                type="button"
                onClick={onClearBoundary}
                className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer transition-colors"
                title="Limpiar área y volver a dibujar"
              >
                <Trash2 className="w-3 h-3" /> Limpiar
              </button>
            </div>
          ) : (
            <span>Cambiá al mapa y hacé clic para comenzar a dibujar el área.</span>
          )}
        </div>
      )}

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
        disabled={disabled}
        className="w-full accent-orange-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Área de cobertura simulada en kilómetros cuadrados"
      />

      <div className="flex items-center justify-between text-sm pt-1">
        <span className="text-slate-600 dark:text-slate-300">Población mínima requerida</span>
        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
          {minPopulation === 0 ? "Sin filtro" : minPopulation.toLocaleString("es-AR")}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={MIN_POP_MAX}
        step={MIN_POP_STEP}
        value={minPopulation}
        onChange={(e) => {
          const v = Number(e.target.value);
          setMinPopulation(v);
          onMinPopulationChange?.(v);
        }}
        disabled={disabled}
        className="w-full accent-slate-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Población mínima requerida para ciudades candidatas"
      />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Previsualizando sobre: <strong>{scopeLabel}</strong>
        {territoryMode === "custom" && hasBoundary && (
          <span className="ml-1 text-blue-600 dark:text-blue-400">(área personalizada)</span>
        )}
      </p>

      <button
        onClick={() => onConfirm(areaKm2, minPopulation)}
        disabled={disabled || (territoryMode === "custom" && !hasBoundary)}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-orange-500 text-white hover:bg-orange-600 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange-500"
      >
        Confirmar y Diagnosticar
      </button>

      {branches && branches.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-gray-700 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Simular cierre de sucursal
            </p>
            {(hiddenBranchIds ?? []).length > 0 && (
              <button
                type="button"
                onClick={onRestoreAllBranches}
                className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Restaurar todas
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {branches.map((b) => {
              const isHidden = (hiddenBranchIds ?? []).includes(b.id);
              return (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span className={`text-xs truncate ${isHidden ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200"}`}>
                    {b.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleBranch?.(b.id)}
                    disabled={disabled}
                    title={isHidden ? "Restaurar sucursal" : "Simular cierre"}
                    aria-label={isHidden ? `Restaurar sucursal ${b.label}` : `Simular cierre de ${b.label}`}
                    className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                  >
                    {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {(hiddenBranchIds ?? []).length > 0 && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {(hiddenBranchIds ?? []).length === 1
                ? "1 sucursal excluida del cálculo."
                : `${(hiddenBranchIds ?? []).length} sucursales excluidas del cálculo.`}{" "}
              Confirmá el diagnóstico para recalcular.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
