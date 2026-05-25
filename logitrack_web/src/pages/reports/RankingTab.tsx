import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { BarChart3, Trophy, Medal, Award, ArrowUpDown, ArrowUp, ArrowDown, Inbox } from "lucide-react";
import { reportsApi, type BranchRankingItem } from "../../api/reports";
import { Card } from "../../components/ui/card";
import { StatCard } from "../../components/ui/stat-card";
import { ReportExport } from "../../components/ReportExport";
import { Skeleton } from "../../utils/dashboard";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

interface RankingTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

type SortKey = "volume_confirmed" | "success_rate" | "composite_score" | "branch_name";

const MEDAL_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-900" },
  2: { bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-700" },
  3: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-900" },
};

function MedalIcon({ position }: { position: number }) {
  if (position === 1) return <Trophy className="w-5 h-5 text-amber-500" />;
  if (position === 2) return <Medal className="w-5 h-5 text-slate-400" />;
  if (position === 3) return <Award className="w-5 h-5 text-orange-600" />;
  return null;
}

function successBadge(rate: number | null): { bg: string; text: string; label: string } {
  if (rate === null) return { bg: "bg-slate-100", text: "text-slate-600", label: "—" };
  if (rate > 90) return { bg: "bg-emerald-100", text: "text-emerald-700", label: `${rate.toFixed(1)}%` };
  if (rate >= 70) return { bg: "bg-amber-100", text: "text-amber-700", label: `${rate.toFixed(1)}%` };
  return { bg: "bg-rose-100", text: "text-rose-700", label: `${rate.toFixed(1)}%` };
}

function SortHeader({
  label,
  sortField,
  sortKey,
  sortDir,
  toggleSort,
}: {
  label: string;
  sortField: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  toggleSort: (key: SortKey) => void;
}) {
  const active = sortKey === sortField;
  return (
    <th
      className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors text-right"
      onClick={() => toggleSort(sortField)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDir === "desc" ? (
            <ArrowDown className="w-3 h-3" />
          ) : (
            <ArrowUp className="w-3 h-3" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40" />
        )}
      </span>
    </th>
  );
}

export default function RankingTab({ dateFrom, dateTo, branchId }: RankingTabProps) {
  const [ranking, setRanking] = useState<BranchRankingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("volume_confirmed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const params: { date_from?: string; date_to?: string; branch_id?: string } = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (branchId) params.branch_id = branchId;

    reportsApi
      .branchRanking(params)
      .then((data) => {
        setRanking(data.ranking);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [dateFrom, dateTo, branchId]);

  const sorted = useMemo(() => {
    const copy = [...ranking];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "volume_confirmed":
          cmp = a.volume_confirmed - b.volume_confirmed;
          break;
        case "success_rate":
          cmp = (a.success_rate ?? -1) - (b.success_rate ?? -1);
          break;
        case "composite_score":
          cmp = a.composite_score - b.composite_score;
          break;
        case "branch_name":
          cmp = a.branch_name.localeCompare(b.branch_name);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [ranking, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const topBranch = ranking.length > 0 ? ranking[0] : null;
  const totalVolume = ranking.reduce((s, r) => s + r.volume_confirmed, 0);
  const avgSuccess = ranking.length > 0
    ? ranking.reduce((s, r) => s + (r.success_rate ?? 0), 0) / ranking.filter((r) => r.success_rate !== null).length
    : null;

  const exportPDF = useCallback(async () => {
    setExporting(true);
    await exportToPDF(contentRef, `ranking_sucursales_${new Date().toISOString().slice(0, 10)}.pdf`);
    setExporting(false);
  }, []);

  const exportExcel = useCallback(() => {
    const rows = sorted.map((r, i) => ({
      Posición: i + 1,
      Sucursal: r.branch_name,
      "Vol. Confirmados": r.volume_confirmed,
      Entregados: r.delivered,
      "Tasa Éxito (%)": r.success_rate !== null ? r.success_rate.toFixed(1) : "\u2014",
      "Score Compuesto": r.composite_score.toFixed(2),
    }));
    exportToExcel([{ name: "Ranking Sucursales", data: rows }], `ranking_sucursales_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [sorted]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Ranking de Sucursales</h2>
        </div>
        <ReportExport
          onExportPDF={exportPDF}
          onExportExcel={exportExcel}
          loading={exporting}
        />
      </div>

      <div ref={contentRef}>
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <Card className="p-10 text-center">
            <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá de nuevo más tarde.</p>
          </Card>
        ) : ranking.length === 0 ? (
          <Card className="p-10 text-center">
            <Inbox className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No hay datos para el período seleccionado.</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <StatCard
                label="Total envíos confirmados"
                value={totalVolume}
                icon={<BarChart3 className="w-4 h-4" />}
                tone="default"
              />
              <StatCard
                label="Éxito promedio"
                value={avgSuccess !== null ? `${avgSuccess.toFixed(1)}%` : "—"}
                icon={<Trophy className="w-4 h-4" />}
                tone={avgSuccess !== null && avgSuccess > 90 ? "success" : avgSuccess !== null && avgSuccess >= 70 ? "warning" : "danger"}
              />
              <StatCard
                label="Mejor sucursal"
                value={topBranch?.branch_name ?? "—"}
                hint={topBranch ? `${topBranch.volume_confirmed} envíos · ${(topBranch.success_rate ?? 0).toFixed(1)}% éxito` : undefined}
                icon={<Medal className="w-4 h-4" />}
                tone="success"
              />
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/30 text-left border-b border-slate-100">
                      <th className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider w-12">
                        #
                      </th>
                      <th
                        className="px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors"
                        onClick={() => toggleSort("branch_name")}
                      >
                        <span className="inline-flex items-center gap-1">
                          Sucursal
                          {sortKey === "branch_name" ? (
                            sortDir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </span>
                      </th>
                      <SortHeader label="Vol. Confirmados" sortField="volume_confirmed" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
                      <SortHeader label="Tasa Entrega" sortField="success_rate" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
                      <SortHeader label="Score Compuesto" sortField="composite_score" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const pos = i + 1;
                      const medal = MEDAL_COLORS[pos];
                      const badge = successBadge(r.success_rate);
                      return (
                        <tr
                          key={r.branch_id}
                          className={`border-b border-slate-100 transition-colors ${
                            medal ? `${medal.bg} ${medal.border} border-l-4` : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-5 py-3">
                            <span className="inline-flex items-center justify-center gap-1">
                              {pos <= 3 ? (
                                <MedalIcon position={pos} />
                              ) : (
                                <span className="text-sm font-semibold text-slate-400 tabular-nums">{pos}</span>
                              )}
                            </span>
                          </td>
                          <td className={`px-5 py-3 font-medium ${medal ? medal.text : "text-slate-700"}`}>
                            {r.branch_name}
                          </td>
                          <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">
                            {r.volume_confirmed}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-slate-900 font-semibold text-right tabular-nums">
                            {r.composite_score.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
