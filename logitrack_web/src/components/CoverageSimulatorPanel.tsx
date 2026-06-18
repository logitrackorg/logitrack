import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { Region } from "../api/regions";

export const SIM_AREA_MIN = 50;
export const SIM_AREA_MAX = 1_000_000;
export const SIM_AREA_STEP = 1_000;
export const SIM_AREA_DEFAULT = 500_000;

const MIN_POP_MAX = 500_000;
const MIN_POP_STEP = 10_000;
const MIN_POP_DEFAULT = 0;

const MAX_SUGG_MAX = 20;
const MAX_SUGG_STEP = 1;

export type TerritoryMode = "national" | "custom";

interface CoverageSimulatorPanelProps {
  areaKm2: number;
  onAreaChange: (areaKm2: number) => void;
  onConfirm: (areaKm2: number, minPopulation: number) => void;
  onMinPopulationChange?: (minPopulation: number) => void;
  /** Maximum number of mathematical suggestions (0 = no limit). */
  maxSuggestions?: number;
  onMaxSuggestionsChange?: (n: number) => void;
  scopeLabel: string;
  disabled?: boolean;
  /** Current territory mode — used to show the drawing-in-progress indicator. */
  territoryMode?: TerritoryMode;
  customBoundaryPoints?: number;
  isDrawingBoundary?: boolean;
  onClearBoundary?: () => void;
  /** List of available regions from the backend. */
  regions?: Region[];
  /** Currently selected region ID, or "national" for full Argentina. */
  selectedRegionId?: string;
  /** Called when the user picks a different region from the dropdown. */
  onRegionChange?: (id: string) => void;
  /** Called when the user clicks "Dibujar nueva zona". */
  onStartDrawNewRegion?: () => void;
}

export function CoverageSimulatorPanel({
  areaKm2,
  onAreaChange,
  onConfirm,
  onMinPopulationChange,
  maxSuggestions = 0,
  onMaxSuggestionsChange,
  scopeLabel,
  disabled = false,
  territoryMode = "national",
  customBoundaryPoints = 0,
  isDrawingBoundary = false,
  onClearBoundary,
  regions = [],
  selectedRegionId = "national",
  onRegionChange,
  onStartDrawNewRegion,
}: CoverageSimulatorPanelProps) {
  const [minPopulation, setMinPopulation] = useState(MIN_POP_DEFAULT);

  // Draft strings for the number inputs — decoupled from the controlled slider
  // values so the user can type freely without React reverting partial input.
  const [areaInput, setAreaInput] = useState(() => String(areaKm2));
  const [popInput, setPopInput] = useState(() => String(MIN_POP_DEFAULT));
  const [maxSugInput, setMaxSugInput] = useState(() => String(maxSuggestions));

  const hasBoundary = customBoundaryPoints >= 3;
  const predefined = regions.filter((r) => r.type === "predefined");
  const custom = regions.filter((r) => r.type === "custom");

  return (
    <div className="space-y-3">
      {/* Selector de zona de análisis */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Zona de análisis
        </label>
        <div className="flex gap-1.5">
          <select
            value={selectedRegionId}
            onChange={(e) => onRegionChange?.(e.target.value)}
            disabled={isDrawingBoundary}
            className="flex-1 text-xs px-2 py-1.5 rounded-md border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <option value="national">Nacional (Completo)</option>
            {predefined.length > 0 && (
              <optgroup label="Zonas Predefinidas">
                {predefined.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </optgroup>
            )}
            {custom.length > 0 && (
              <optgroup label="Mis Zonas">
                {custom.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            onClick={onStartDrawNewRegion}
            disabled={isDrawingBoundary || disabled}
            title="Dibujar nueva zona personalizada"
            className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-xs rounded-md border border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Pencil className="w-3 h-3" /> Nueva
          </button>
        </div>
      </div>

      {/* Estado del área personalizada (dibujo en progreso / activa) */}
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
              <span className="font-semibold">Dibujando zona...</span> Hacé clic en el mapa para agregar vértices.{" "}
              <span className="opacity-75">Enter cierra · Esc cancela · ⌘Z deshace</span>
            </>
          ) : hasBoundary ? (
            <div className="flex items-center justify-between gap-2">
              <span><span className="font-semibold">Zona activa</span> · {customBoundaryPoints} vértices</span>
              {selectedRegionId === "national" && (
                <button
                  type="button"
                  onClick={onClearBoundary}
                  className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer transition-colors"
                  title="Limpiar zona activa"
                >
                  <Trash2 className="w-3 h-3" /> Limpiar
                </button>
              )}
            </div>
          ) : (
            <span>Cambiá al mapa y hacé clic para comenzar a dibujar la zona.</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-600 dark:text-slate-300">Radio de prueba</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={SIM_AREA_MIN}
            max={SIM_AREA_MAX}
            step={SIM_AREA_STEP}
            value={areaInput}
            onChange={(e) => setAreaInput(e.target.value)}
            onBlur={() => {
              const raw = Number(areaInput);
              const v = isNaN(raw) ? SIM_AREA_MIN : Math.max(SIM_AREA_MIN, Math.min(SIM_AREA_MAX, raw));
              onAreaChange(v);
              setAreaInput(String(v));
            }}
            disabled={disabled}
            className="w-24 text-right text-xs font-mono font-semibold px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-orange-600 dark:text-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Área de cobertura simulada en kilómetros cuadrados"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">km²</span>
        </div>
      </div>

      <input
        type="range"
        min={SIM_AREA_MIN}
        max={SIM_AREA_MAX}
        step={SIM_AREA_STEP}
        value={areaKm2}
        onChange={(e) => {
          const v = Number(e.target.value);
          onAreaChange(v);
          setAreaInput(String(v));
        }}
        disabled={disabled}
        className="w-full accent-orange-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Área de cobertura simulada en kilómetros cuadrados"
      />

      <div className="flex items-center justify-between gap-2 text-sm pt-1">
        <span className="text-slate-600 dark:text-slate-300">Población mínima requerida</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={MIN_POP_MAX}
            step={MIN_POP_STEP}
            value={popInput}
            onChange={(e) => setPopInput(e.target.value)}
            onBlur={() => {
              const raw = Number(popInput);
              const v = isNaN(raw) ? 0 : Math.max(0, Math.min(MIN_POP_MAX, raw));
              setMinPopulation(v);
              setPopInput(String(v));
              onMinPopulationChange?.(v);
            }}
            disabled={disabled}
            placeholder="0"
            className="w-24 text-right text-xs font-mono font-semibold px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Población mínima requerida para ciudades candidatas"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">hab.</span>
        </div>
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
          setPopInput(String(v));
          onMinPopulationChange?.(v);
        }}
        disabled={disabled}
        className="w-full accent-slate-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Población mínima requerida para ciudades candidatas"
      />

      <div className="flex items-center justify-between gap-2 text-sm pt-1">
        <span className="text-slate-600 dark:text-slate-300">Máx. sucursales sugeridas</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={MAX_SUGG_MAX}
            step={MAX_SUGG_STEP}
            value={maxSugInput}
            onChange={(e) => setMaxSugInput(e.target.value)}
            onBlur={() => {
              const raw = Number(maxSugInput);
              const v = isNaN(raw) ? 0 : Math.max(0, Math.min(MAX_SUGG_MAX, Math.round(raw)));
              onMaxSuggestionsChange?.(v);
              setMaxSugInput(String(v));
            }}
            disabled={disabled}
            placeholder="0"
            className="w-16 text-right text-xs font-mono font-semibold px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Cantidad máxima de sucursales sugeridas (0 = sin límite)"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 w-14">
            {maxSuggestions === 0 ? "sin límite" : "máx."}
          </span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={MAX_SUGG_MAX}
        step={MAX_SUGG_STEP}
        value={maxSuggestions}
        onChange={(e) => {
          const v = Number(e.target.value);
          onMaxSuggestionsChange?.(v);
          setMaxSugInput(String(v));
        }}
        disabled={disabled}
        className="w-full accent-indigo-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Cantidad máxima de sucursales sugeridas"
      />

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Previsualizando sobre: <strong>{scopeLabel}</strong>
        {territoryMode === "custom" && hasBoundary && selectedRegionId !== "national" && (
          <span className="ml-1 text-blue-600 dark:text-blue-400">
            ({regions.find((r) => r.id === selectedRegionId)?.name ?? "zona personalizada"})
          </span>
        )}
        {territoryMode === "custom" && hasBoundary && selectedRegionId === "national" && (
          <span className="ml-1 text-blue-600 dark:text-blue-400">(zona dibujada)</span>
        )}
      </p>

      <button
        onClick={() => onConfirm(areaKm2, minPopulation)}
        disabled={disabled || (territoryMode === "custom" && !hasBoundary)}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-orange-500 text-white hover:bg-orange-600 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange-500"
      >
        Confirmar y Diagnosticar
      </button>
    </div>
  );
}
