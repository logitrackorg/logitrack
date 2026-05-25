import { useEffect, useState, useCallback } from "react";
import { Activity, TrendingDown, Users2 } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  supervisorFatigueApi,
  type FatigueHistoryResponse,
  type DriverRankingItem,
} from "../../api/supervisorFatigue";
import { Card } from "../../components/ui/card";
import { Skeleton } from "../../utils/dashboard";

interface FatigaTabProps {
  branchId: string;
}

function fmtDay(dateStr: string): string {
  // YYYY-MM-DD → DD/MM
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

function riskBadge(level: string): { bg: string; text: string; label: string } {
  switch (level) {
    case "verde":
      return { bg: "bg-emerald-100", text: "text-emerald-700", label: "Bajo" };
    case "amarillo":
      return { bg: "bg-amber-100", text: "text-amber-700", label: "Medio" };
    case "rojo":
      return { bg: "bg-rose-100", text: "text-rose-700", label: "Alto" };
    default:
      return { bg: "bg-slate-100", text: "text-slate-500", label: "Sin datos" };
  }
}

const RISK_COLORS = {
  verde: "#10b981",
  amarillo: "#f59e0b",
  rojo: "#ef4444",
  salteado: "#94a3b8",
};

export default function FatigaTab({ branchId }: FatigaTabProps) {
  const [data, setData] = useState<FatigueHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    supervisorFatigueApi
      .getHistory(branchId || undefined)
      .then(setData)
      .catch(() => setError("No se pudieron cargar los datos de fatiga."))
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-slate-500">
        <Activity className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        <p>{error}</p>
        <button
          onClick={load}
          className="mt-3 text-sm text-blue-600 hover:underline cursor-pointer"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!data || data.daily_metrics.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500">
        <Activity className="w-10 h-10 mx-auto mb-3 text-slate-300" />
        <p className="font-medium">Sin datos de fatiga disponibles</p>
        <p className="text-sm mt-1">
          Los datos aparecerán aquí cuando los choferes completen sus check-ins.
        </p>
      </div>
    );
  }

  const chartData = data.daily_metrics.map((m) => ({
    fecha: fmtDay(m.date),
    Verde: m.verde,
    Amarillo: m.amarillo,
    Rojo: m.rojo,
    Salteado: m.salteado,
    sueno: m.avg_horas_sueno,
    riesgo: m.avg_risk_score,
  }));

  return (
    <div className="space-y-6">
      {/* Distribución de riesgo por día */}
      <Card>
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-800 text-sm">
            Distribución de riesgo de la flota por día
          </h3>
        </div>
        <div className="p-5">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="fecha"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              />
              <Bar dataKey="Verde" stackId="a" fill={RISK_COLORS.verde} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Amarillo" stackId="a" fill={RISK_COLORS.amarillo} />
              <Bar dataKey="Rojo" stackId="a" fill={RISK_COLORS.rojo} />
              <Bar dataKey="Salteado" stackId="a" fill={RISK_COLORS.salteado} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Tendencias de sueño */}
      <Card>
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-800 text-sm">
            Tendencia de horas de sueño promedio de la flota
          </h3>
        </div>
        <div className="p-5">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="fecha"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 12]}
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                unit="h"
              />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line
                type="monotone"
                dataKey="sueno"
                name="Prom. horas sueño"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3, fill: "#6366f1" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Ranking de conductores */}
      <Card>
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <Users2 className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-800 text-sm">
            Ranking de conductores por riesgo promedio
          </h3>
        </div>
        {data.driver_ranking.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Sin datos de conductores.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-5 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    #
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Conductor
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Riesgo prom.
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Nivel
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Sueño prom.
                  </th>
                  <th className="text-center px-4 py-3 font-medium text-slate-500 text-xs uppercase tracking-wide">
                    Check-ins
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.driver_ranking.map((item: DriverRankingItem, idx: number) => {
                  const badge = riskBadge(item.risk_level);
                  return (
                    <tr
                      key={item.driver_id}
                      className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors"
                    >
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{item.full_name}</div>
                        <div className="text-xs text-slate-400">{item.username}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-semibold text-slate-700">{item.avg_risk_score}</span>
                        <span className="text-xs text-slate-400 ml-0.5">/100</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-slate-700">
                        {item.avg_horas_sueno > 0 ? `${item.avg_horas_sueno}h` : "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-500">{item.total_checkins}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
