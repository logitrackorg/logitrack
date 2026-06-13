import { useEffect, useMemo, useState, useCallback } from "react";
import { MapPin, AlertTriangle, CheckCircle2, Lightbulb, RefreshCw } from "lucide-react";
import {
  coverageApi,
  type CoverageDiagram,
  type CoverageCell,
  GAP_STYLE,
} from "../../api/coverage";
import { VoronoiCoverageMap } from "../../components/VoronoiCoverageMap";
import { Card } from "../../components/ui/card";
import { SkeletonCard } from "../../components/ui/skeleton";

function formatKm2(v: number): string {
  return `${Math.round(v).toLocaleString("es-AR")} km²`;
}

/** Severidad más alta primero, para ordenar la lista de zonas. */
const SEVERITY_RANK: Record<string, number> = { critico: 3, moderado: 2, leve: 1, "": 0 };

export function CoberturaTab() {
  const [diagram, setDiagram] = useState<CoverageDiagram | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    coverageApi
      .getDiagram()
      .then(setDiagram)
      .catch(() => setError("No se pudo calcular la cobertura en este momento."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const gaps = useMemo<CoverageCell[]>(() => {
    if (!diagram) return [];
    return [...diagram.cells]
      .filter((c) => c.is_gap)
      .sort(
        (a, b) =>
          (SEVERITY_RANK[b.gap_severity] ?? 0) - (SEVERITY_RANK[a.gap_severity] ?? 0) ||
          b.area_km2 - a.area_km2
      );
  }, [diagram]);

  const severityCounts = useMemo(() => {
    const counts = { critico: 0, moderado: 0, leve: 0 };
    gaps.forEach((g) => {
      if (g.gap_severity === "critico") counts.critico++;
      else if (g.gap_severity === "moderado") counts.moderado++;
      else if (g.gap_severity === "leve") counts.leve++;
    });
    return counts;
  }, [gaps]);

  if (loading) return <SkeletonCard className="h-[600px]" />;

  if (error) {
    return (
      <Card variant="muted" className="flex flex-col items-center justify-center h-[400px] gap-3">
        <AlertTriangle className="w-10 h-10 text-amber-500" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      </Card>
    );
  }

  if (!diagram || diagram.branch_count < 3) {
    return (
      <Card variant="muted" className="flex flex-col items-center justify-center h-[400px] gap-2 text-center px-6">
        <MapPin className="w-10 h-10 text-slate-300" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          No hay suficientes sucursales activas para calcular la cobertura
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Se necesitan al menos 3 sucursales con coordenadas para construir el diagrama de cobertura.
        </p>
      </Card>
    );
  }

  const coveredCount = diagram.branch_count - diagram.gap_count;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Mapa — ocupa 2/3 en desktop, ancho completo en mobile/tablet */}
      <Card className="lg:col-span-2 overflow-hidden !cursor-default p-0">
        <div className="h-[420px] sm:h-[520px] lg:h-[640px] w-full">
          <VoronoiCoverageMap
            cells={diagram.cells}
            highlightedBranchId={highlighted}
            onSelectBranch={(id) => setHighlighted(id)}
          />
        </div>
      </Card>

      {/* Panel: situación actual + recomendaciones */}
      <div className="flex flex-col gap-4">
        <Card variant="muted" className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white mb-3">
            <MapPin className="w-4 h-4 text-blue-600" /> Situación actual
          </h3>
          <SituationSummary
            covered={coveredCount}
            total={diagram.branch_count}
            gapCount={diagram.gap_count}
            severity={severityCounts}
            threshold={diagram.threshold_km2}
          />
        </Card>

        <Card variant="muted" className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white mb-3">
            <Lightbulb className="w-4 h-4 text-amber-500" /> Recomendaciones
          </h3>
          <Recommendations gaps={gaps} highlighted={highlighted} onHighlight={setHighlighted} />
        </Card>
      </div>
    </div>
  );
}

function SituationSummary({
  covered,
  total,
  gapCount,
  severity,
  threshold,
}: {
  covered: number;
  total: number;
  gapCount: number;
  severity: { critico: number; moderado: number; leve: number };
  threshold: number;
}) {
  if (gapCount === 0) {
    return (
      <div className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
        <p>
          La red de <strong>{total}</strong> sucursales cubre adecuadamente el territorio. No se
          detectan zonas con cobertura insuficiente según el umbral de {formatKm2(threshold)} por
          sucursal.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
      <p>
        De <strong>{total}</strong> sucursales activas, <strong>{covered}</strong> tienen cobertura
        adecuada y <strong className="text-rose-600 dark:text-rose-400">{gapCount}</strong> presentan
        un área de servicio mayor al umbral de {formatKm2(threshold)}.
      </p>
      <div className="flex flex-wrap gap-2">
        {severity.critico > 0 && (
          <SeverityPill count={severity.critico} severity="critico" />
        )}
        {severity.moderado > 0 && (
          <SeverityPill count={severity.moderado} severity="moderado" />
        )}
        {severity.leve > 0 && <SeverityPill count={severity.leve} severity="leve" />}
      </div>
    </div>
  );
}

function SeverityPill({
  count,
  severity,
}: {
  count: number;
  severity: "critico" | "moderado" | "leve";
}) {
  const s = GAP_STYLE[severity];
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.badge}`}>
      {count} {s.label.toLowerCase()}
      {count > 1 ? "s" : ""}
    </span>
  );
}

function Recommendations({
  gaps,
  highlighted,
  onHighlight,
}: {
  gaps: CoverageCell[];
  highlighted: string | null;
  onHighlight: (id: string) => void;
}) {
  if (gaps.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No hay acciones pendientes. Mantené el monitoreo de cobertura a medida que cambie la demanda.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {gaps.map((g) => {
        const s = g.gap_severity ? GAP_STYLE[g.gap_severity] : null;
        const isActive = g.branch_id === highlighted;
        return (
          <li key={g.branch_id}>
            <button
              onClick={() => onHighlight(g.branch_id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                isActive
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                  : "border-slate-200 dark:border-gray-700 hover:bg-slate-100 dark:hover:bg-gray-700/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {g.branch_name}
                </span>
                {s && (
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
                    {s.label}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cobertura de {formatKm2(g.area_km2)}. Evaluar abrir una sucursal cerca de{" "}
                {g.suggestion
                  ? `${g.suggestion.lat.toFixed(3)}, ${g.suggestion.lng.toFixed(3)}`
                  : "el centro de la zona"}{" "}
                para reducir el área de servicio.
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
