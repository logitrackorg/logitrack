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

const MIN_DENSITY_MAX = 5_000;
const MIN_DENSITY_STEP = 50;

const MAX_DIST_NETWORK_MAX = 2_000;
const MAX_DIST_NETWORK_STEP = 50;

const MIN_SCORE_MAX = 100;
const MIN_SCORE_STEP = 5;

const MAX_SUGG_MAX = 20;
const MAX_SUGG_STEP = 1;

export type TerritoryMode = "national" | "custom";

export type DiagnosisMode = "area" | "density";

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
  isEditingBoundary?: boolean;
  onStartEditBoundary?: () => void;
  onClearBoundary?: () => void;
  /** List of available regions from the backend. */
  regions?: Region[];
  /** Currently selected region ID, or "national" for full Argentina. */
  selectedRegionId?: string;
  /** Called when the user picks a different region from the dropdown. */
  onRegionChange?: (id: string) => void;
  /** Called when the user clicks "Dibujar nueva zona". */
  onStartDrawNewRegion?: () => void;
  /** true cuando la zona seleccionada es propia (editable). */
  canEditSelectedRegion?: boolean;
  /** Called when the user clicks "Editar" on a custom region. */
  onEditRegion?: () => void;
  /** Diagnosis ranking mode: "area" (geographic gaps) or "density" (population density). */
  diagnosisMode?: DiagnosisMode;
  onDiagnosisModeChange?: (mode: DiagnosisMode) => void;
  /** Density-mode ranking criterion. */
  rankingMode?: "population" | "gap_area";
  onRankingModeChange?: (mode: "population" | "gap_area") => void;
  /** Minimum population density filter for density mode (hab./km²). */
  minDensity?: number;
  onMinDensityChange?: (v: number) => void;
  /** When true, candidates near IGN industrial areas get a 1.3× score bonus. */
  prioritizeIndustrial?: boolean;
  onPrioritizeIndustrialChange?: (v: boolean) => void;
  /** When true, mountainous terrain divides the score (discourages Andes candidates). */
  applyTerrainFriction?: boolean;
  onApplyTerrainFrictionChange?: (v: boolean) => void;
  /** true mientras el backend está calculando el diagnóstico — bloquea el panel y cambia el texto del botón. */
  isDiagnosing?: boolean;
  /** Toggles the industrial zones overlay on the map. */
  showIndustrialHeatmap?: boolean;
  onIndustrialHeatmapChange?: (v: boolean) => void;
  /** true while the map is fetching industrial zone polygons (IGN dataset). */
  industrialHeatmapLoading?: boolean;
  /** Result of the last industrial zones fetch. null = not yet loaded. */
  industrialZoneResult?: { count: number; error: boolean } | null;
  /** Toggles visibility of rejected (discarded) city markers on the map. */
  showRejectedOnMap?: boolean;
  onShowRejectedOnMapChange?: (v: boolean) => void;
  /** Max distance (km) a suggestion can be from the nearest existing branch. 0 = no limit. */
  maxDistFromNetwork?: number;
  onMaxDistFromNetworkChange?: (v: number) => void;
  /** Minimum Logistics Viability Score (1–100) a candidate must reach. 0 = no filter. */
  minScore?: number;
  onMinScoreChange?: (v: number) => void;
  /**
   * Total area of the active analysis zone in km² — used to compute adaptive
   * slider bounds (min = 0.1 % of zone, max = 25 % of zone).  Defaults to the
   * national SIM_AREA_MAX when omitted.
   */
  zoneAreaKm2?: number;
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
  isEditingBoundary = false,
  onStartEditBoundary,
  onClearBoundary,
  regions = [],
  selectedRegionId = "national",
  onRegionChange,
  onStartDrawNewRegion,
  canEditSelectedRegion = false,
  onEditRegion,
  diagnosisMode = "area",
  onDiagnosisModeChange,
  rankingMode = "population",
  onRankingModeChange,
  minDensity = 0,
  onMinDensityChange,
  prioritizeIndustrial = false,
  onPrioritizeIndustrialChange,
  applyTerrainFriction = false,
  onApplyTerrainFrictionChange,
  isDiagnosing = false,
  zoneAreaKm2,
  showIndustrialHeatmap = false,
  onIndustrialHeatmapChange,
  industrialHeatmapLoading = false,
  industrialZoneResult = null,
  showRejectedOnMap = true,
  onShowRejectedOnMapChange,
  maxDistFromNetwork = 0,
  onMaxDistFromNetworkChange,
  minScore = 0,
  onMinScoreChange,
}: CoverageSimulatorPanelProps) {
  const isDisabled = disabled || isDiagnosing;

  // Adaptive slider bounds: 0.1 % – 25 % of the active zone area.
  const effectiveZoneArea = zoneAreaKm2 ?? SIM_AREA_MAX;
  const simAreaMin = Math.max(SIM_AREA_MIN, Math.round(effectiveZoneArea * 0.001));
  const simAreaMax = Math.min(SIM_AREA_MAX, Math.round(effectiveZoneArea * 0.25));
  const simAreaStep = Math.max(1, Math.round((simAreaMax - simAreaMin) / 200));

  const [minPopulation, setMinPopulation] = useState(MIN_POP_DEFAULT);
  const [densityInput, setDensityInput] = useState("0");
  const [distInput, setDistInput] = useState("0");
  const [scoreInput, setScoreInput] = useState("0");

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
          {canEditSelectedRegion && (
            <button
              type="button"
              onClick={onEditRegion}
              disabled={isDrawingBoundary || isDisabled}
              title="Editar nombre y forma de esta zona"
              className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-700 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Pencil className="w-3 h-3" /> Editar
            </button>
          )}
          <button
            type="button"
            onClick={onStartDrawNewRegion}
            disabled={isDrawingBoundary || isDisabled}
            title="Dibujar nueva zona personalizada"
            className="shrink-0 flex items-center gap-1 px-2 py-1.5 text-xs rounded-md border border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Pencil className="w-3 h-3" /> Nueva
          </button>
        </div>
      </div>

      {/* Estado del área personalizada (dibujo en progreso / edición / activa) */}
      {territoryMode === "custom" && (
        <div className={`rounded-md px-3 py-2 text-xs ${
          isEditingBoundary
            ? "bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300"
            : isDrawingBoundary
            ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300"
            : hasBoundary
            ? "bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300"
            : "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300"
        }`}>
          {isEditingBoundary ? (
            <>
              <span className="font-semibold">Editando vértices...</span> Arrastrá para mover · clic derecho para eliminar · clic en punto medio para agregar.{" "}
              <span className="opacity-75">Enter confirma · Esc cancela</span>
            </>
          ) : isDrawingBoundary ? (
            <>
              <span className="font-semibold">Dibujando zona...</span> Hacé clic en el mapa para agregar vértices.{" "}
              <span className="opacity-75">Enter cierra · Esc cancela · ⌘Z deshace</span>
            </>
          ) : hasBoundary ? (
            <div className="flex items-center justify-between gap-2">
              <span><span className="font-semibold">Zona activa</span> · {customBoundaryPoints} vértices</span>
              <div className="flex items-center gap-2">
                {onStartEditBoundary && (
                  <button
                    type="button"
                    onClick={onStartEditBoundary}
                    className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:text-violet-600 dark:hover:text-violet-400 cursor-pointer transition-colors"
                    title="Editar vértices de la zona activa"
                  >
                    <Pencil className="w-3 h-3" /> Editar
                  </button>
                )}
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
            </div>
          ) : (
            <span>Cambiá al mapa y hacé clic para comenzar a dibujar la zona.</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-600 dark:text-slate-300">Radio de cobertura</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={simAreaMin}
            max={simAreaMax}
            step={simAreaStep}
            value={areaInput}
            onChange={(e) => setAreaInput(e.target.value)}
            onBlur={() => {
              const raw = Number(areaInput);
              const v = isNaN(raw) ? simAreaMin : Math.max(simAreaMin, Math.min(simAreaMax, raw));
              onAreaChange(v);
              setAreaInput(String(v));
            }}
            disabled={isDisabled}
            className="w-24 text-right text-xs font-mono font-semibold px-1.5 py-0.5 rounded border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-orange-600 dark:text-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400 disabled:opacity-50 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Área de cobertura simulada en kilómetros cuadrados"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">km²</span>
        </div>
      </div>

      <input
        type="range"
        min={simAreaMin}
        max={simAreaMax}
        step={simAreaStep}
        value={areaKm2}
        onChange={(e) => {
          const v = Number(e.target.value);
          onAreaChange(v);
          setAreaInput(String(v));
        }}
        disabled={isDisabled}
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
            disabled={isDisabled}
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
        disabled={isDisabled}
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
            disabled={isDisabled}
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
        disabled={isDisabled}
        className="w-full accent-indigo-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Cantidad máxima de sucursales sugeridas"
      />

      {/* Modo de diagnóstico */}
      <div className="space-y-1.5 pt-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
          Modo de diagnóstico
        </label>
        <div className="flex rounded-md border border-slate-200 dark:border-gray-600 overflow-hidden text-xs font-medium">
          <button
            type="button"
            onClick={() => onDiagnosisModeChange?.("area")}
            disabled={isDisabled}
            className={`flex-1 px-3 py-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed ${
              diagnosisMode === "area"
                ? "bg-orange-500 text-white"
                : "bg-white dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-700"
            }`}
          >
            Cobertura geográfica
          </button>
          <button
            type="button"
            onClick={() => onDiagnosisModeChange?.("density")}
            disabled={isDisabled}
            className={`flex-1 px-3 py-1.5 border-l border-slate-200 dark:border-gray-600 transition-colors cursor-pointer disabled:cursor-not-allowed ${
              diagnosisMode === "density"
                ? "bg-violet-600 text-white"
                : "bg-white dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-700"
            }`}
          >
            Hab. por km²
          </button>
        </div>
        {diagnosisMode === "density" && (
          <>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              Prioriza zonas con más habitantes por km². Ideal para detectar demanda urbana no atendida (ej. AMBA).
            </p>

            {/* Ranking criterion */}
            <div className="mt-2">
              <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">Priorizar por</p>
              <div className="flex rounded-md border border-slate-200 dark:border-gray-600 overflow-hidden text-[11px]">
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onRankingModeChange?.("population")}
                  className={`flex-1 px-2 py-1 transition-colors cursor-pointer disabled:cursor-not-allowed ${
                    rankingMode === "population"
                      ? "bg-violet-600 text-white font-medium"
                      : "bg-white dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-700"
                  }`}
                >
                  Densidad pobl.
                </button>
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onRankingModeChange?.("gap_area")}
                  className={`flex-1 px-2 py-1 border-l border-slate-200 dark:border-gray-600 transition-colors cursor-pointer disabled:cursor-not-allowed ${
                    rankingMode === "gap_area"
                      ? "bg-violet-600 text-white font-medium"
                      : "bg-white dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-700"
                  }`}
                >
                  Área libre
                </button>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                {rankingMode === "population"
                  ? "Primero las zonas con mayor cantidad de habitantes sin cobertura."
                  : "Primero los huecos geográficos más grandes sin cobertura."}
              </p>
            </div>

            {/* Logistic scoring modifiers */}
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">Modificadores de puntuación</p>
              <label className={`flex items-center gap-2 cursor-pointer select-none ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prioritizeIndustrial}
                  disabled={isDisabled}
                  onClick={() => onPrioritizeIndustrialChange?.(!prioritizeIndustrial)}
                  className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed focus:outline-none ${
                    prioritizeIndustrial ? "bg-amber-500" : "bg-slate-300 dark:bg-gray-600"
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${prioritizeIndustrial ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <span className="text-[11px] text-slate-600 dark:text-slate-300">🏭 Priorizar zonas industriales</span>
              </label>
              <label className={`flex items-center gap-2 cursor-pointer select-none ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={applyTerrainFriction}
                  disabled={isDisabled}
                  onClick={() => onApplyTerrainFrictionChange?.(!applyTerrainFriction)}
                  className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed focus:outline-none ${
                    applyTerrainFriction ? "bg-slate-500 dark:bg-slate-400" : "bg-slate-300 dark:bg-gray-600"
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${applyTerrainFriction ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <span className="text-[11px] text-slate-600 dark:text-slate-300">⛰️ Considerar fricción de terreno</span>
              </label>
            </div>

            {/* Minimum density filter */}
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  Mín. hab./km² en zona sin cobertura
                </label>
                <input
                  type="number"
                  min={0}
                  max={MIN_DENSITY_MAX}
                  step={MIN_DENSITY_STEP}
                  value={densityInput}
                  onChange={(e) => {
                    setDensityInput(e.target.value);
                    const v = Math.max(0, Math.min(MIN_DENSITY_MAX, Number(e.target.value) || 0));
                    onMinDensityChange?.(v);
                  }}
                  onBlur={() => {
                    const v = Math.max(0, Math.min(MIN_DENSITY_MAX, Number(densityInput) || 0));
                    setDensityInput(String(v));
                    onMinDensityChange?.(v);
                  }}
                  disabled={isDisabled}
                  className="w-20 text-right text-xs border border-slate-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 disabled:opacity-50"
                />
              </div>
              <input
                type="range"
                min={0}
                max={MIN_DENSITY_MAX}
                step={MIN_DENSITY_STEP}
                value={minDensity}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDensityInput(String(v));
                  onMinDensityChange?.(v);
                }}
                disabled={isDisabled}
                className="w-full h-1.5 accent-violet-600 disabled:opacity-50"
              />
              <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                <span>Sin filtro</span>
                <span>{MIN_DENSITY_MAX.toLocaleString("es-AR")} hab./km²</span>
              </div>
            </div>

            {/* Max distance from network filter */}
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  Dist. máx. a la red logística
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={MAX_DIST_NETWORK_MAX}
                    step={MAX_DIST_NETWORK_STEP}
                    value={distInput}
                    onChange={(e) => {
                      setDistInput(e.target.value);
                      const v = Math.max(0, Math.min(MAX_DIST_NETWORK_MAX, Number(e.target.value) || 0));
                      onMaxDistFromNetworkChange?.(v);
                    }}
                    onBlur={() => {
                      const v = Math.max(0, Math.min(MAX_DIST_NETWORK_MAX, Number(distInput) || 0));
                      setDistInput(String(v));
                      onMaxDistFromNetworkChange?.(v);
                    }}
                    disabled={isDisabled}
                    className="w-16 text-right text-xs border border-slate-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">km</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={MAX_DIST_NETWORK_MAX}
                step={MAX_DIST_NETWORK_STEP}
                value={maxDistFromNetwork}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDistInput(String(v));
                  onMaxDistFromNetworkChange?.(v);
                }}
                disabled={isDisabled}
                className="w-full h-1.5 accent-rose-500 disabled:opacity-50"
              />
              <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                <span>Sin filtro</span>
                <span>{MAX_DIST_NETWORK_MAX.toLocaleString("es-AR")} km</span>
              </div>
            </div>

            {/* Min viability score filter */}
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  Puntuación mínima de viabilidad
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={MIN_SCORE_MAX}
                    step={MIN_SCORE_STEP}
                    value={scoreInput}
                    onChange={(e) => {
                      setScoreInput(e.target.value);
                      const v = Math.max(0, Math.min(MIN_SCORE_MAX, Number(e.target.value) || 0));
                      onMinScoreChange?.(v);
                    }}
                    onBlur={() => {
                      const v = Math.max(0, Math.min(MIN_SCORE_MAX, Number(scoreInput) || 0));
                      setScoreInput(String(v));
                      onMinScoreChange?.(v);
                    }}
                    disabled={isDisabled}
                    className="w-14 text-right text-xs border border-slate-200 dark:border-gray-600 rounded px-1.5 py-0.5 bg-white dark:bg-gray-800 text-slate-700 dark:text-slate-200 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">/100</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={MIN_SCORE_MAX}
                step={MIN_SCORE_STEP}
                value={minScore}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setScoreInput(String(v));
                  onMinScoreChange?.(v);
                }}
                disabled={isDisabled}
                className="w-full h-1.5 accent-emerald-500 disabled:opacity-50"
              />
              <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                <span>Sin filtro</span>
                <span>100/100</span>
              </div>
            </div>
          </>
        )}
      </div>

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
        disabled={isDisabled || (territoryMode === "custom" && !hasBoundary)}
        className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-orange-500 text-white hover:bg-orange-600 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange-500"
      >
        {isDiagnosing ? "Realizando diagnóstico…" : "Confirmar y Diagnosticar"}
      </button>

      <div className="pt-3 border-t border-slate-200 dark:border-gray-700">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
          Capas del mapa
        </p>
        <label className={`flex items-center gap-2 select-none ${industrialHeatmapLoading ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
          <button
            type="button"
            role="switch"
            aria-checked={showIndustrialHeatmap}
            disabled={industrialHeatmapLoading}
            onClick={() => onIndustrialHeatmapChange?.(!showIndustrialHeatmap)}
            className={`relative w-8 h-4 rounded-full transition-colors focus:outline-none ${
              industrialHeatmapLoading
                ? "cursor-not-allowed"
                : "cursor-pointer"
            } ${showIndustrialHeatmap ? "bg-amber-500" : "bg-slate-300 dark:bg-gray-600"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                showIndustrialHeatmap ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-[11px] text-slate-600 dark:text-slate-300">🏭 Zonas industriales</span>
        </label>
        {industrialHeatmapLoading && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 leading-tight flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            Calculando zonas industriales…
          </p>
        )}
        {showIndustrialHeatmap && !industrialHeatmapLoading && industrialZoneResult && (
          <p className={`text-[10px] mt-1 leading-tight ${industrialZoneResult.error ? "text-rose-500 dark:text-rose-400" : industrialZoneResult.count === 0 ? "text-slate-400 dark:text-slate-500" : "text-emerald-600 dark:text-emerald-400"}`}>
            {industrialZoneResult.error
              ? "⚠ No se pudieron cargar las zonas industriales."
              : industrialZoneResult.count === 0
                ? "Sin zonas industriales (IGN) en esta área. Zoom in o cambia la zona."
                : `✓ ${industrialZoneResult.count} zona${industrialZoneResult.count !== 1 ? "s" : ""} industrial${industrialZoneResult.count !== 1 ? "es" : ""} (IGN) encontrada${industrialZoneResult.count !== 1 ? "s" : ""}. Zoom in para ver el detalle.`}
          </p>
        )}
        <label className="flex items-center gap-2 cursor-pointer select-none mt-1.5">
          <button
            type="button"
            role="switch"
            aria-checked={showRejectedOnMap}
            onClick={() => onShowRejectedOnMapChange?.(!showRejectedOnMap)}
            className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer focus:outline-none ${
              showRejectedOnMap ? "bg-slate-400 dark:bg-slate-500" : "bg-slate-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                showRejectedOnMap ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-[11px] text-slate-600 dark:text-slate-300">🚫 Ciudades descartadas en mapa</span>
        </label>
      </div>
    </div>
  );
}
