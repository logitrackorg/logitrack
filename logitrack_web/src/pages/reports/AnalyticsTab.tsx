import { useEffect, useState } from "react";
import {
    Globe,
    MessageSquare,
    MousePointerClick,
    Users,
    ExternalLink,
    RefreshCw,
    TrendingUp,
    Eye,
} from "lucide-react";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
} from "recharts";
import { Card } from "../../components/ui/card";
import { umamiApi, type UmamiPageviewPoint } from "../../api/umami";

interface EventCount {
    event: string;
    count: number;
}

const ACTION_LABELS: Record<string, string> = {
    file_claim: "📋 Hacer un reclamo",
    reschedule: "📅 Reprogramar entrega",
    pickup: "📦 Retirar por sucursal",
    cancel: "❌ Rechazar/Cancelar envío",
    respond_claim: "✏️ Responder reclamo",
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
    damage: "📦 Daño / Faltante",
    delay: "🕐 Demora en entrega",
    not_delivered: "🚫 No lo recibí",
    //missing: "🔍 Extravío",
    bad_treatment: "😡 Maltrato del personal",
    wrong_data: "📝 Datos incorrectos",
    other: "❓ Otro",
};

function StatBox({
    label,
    value,
    icon,
    color = "blue",
}: {
    label: string;
    value: number | string;
    icon: React.ReactNode;
    color?: "blue" | "violet" | "emerald" | "amber";
}) {
    const colors = {
        blue: "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
        violet: "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400",
        emerald: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400",
        amber: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
    };
    return (
        <Card className="p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
                {icon}
            </div>
            <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{label}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-gray-100 tabular-nums">{value}</p>
            </div>
        </Card>
    );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
    const pct = max > 0 ? (value / max) * 100 : 0;
    return (
        <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 dark:text-slate-300 w-48 shrink-0 truncate">{label}</span>
            <div className="flex-1 bg-slate-100 dark:bg-gray-700 rounded-full h-2">
                <div
                    className="bg-violet-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums w-8 text-right">
                {value}
            </span>
        </div>
    );
}

// Formatea "2026-06-15" -> "15/06" para el eje X.
function formatDayLabel(iso: string): string {
    const parts = iso.slice(5).split("-"); // ["06", "15"]
    if (parts.length !== 2) return iso;
    return `${parts[1]}/${parts[0]}`;
}

// Tooltip personalizado — más prolijo que el default de recharts y respeta dark mode.
function ChartTooltip({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: { value: number }[];
    label?: string;
}) {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-lg text-xs">
            <p className="text-slate-500 dark:text-slate-400 mb-0.5">{label ? formatDayLabel(label) : ""}</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{payload[0].value} visitas</p>
        </div>
    );
}

// Gráfico de tendencia de visitas por día, usando recharts (ya instalado en el proyecto).
function PageviewsChart({ data }: { data: UmamiPageviewPoint[] }) {
    if (data.length === 0) {
        return (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">
                Sin datos de visitas todavía.
            </p>
        );
    }

    return (
        <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                        <linearGradient id="umamiPageviewsGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-slate-100 dark:stroke-gray-700" />
                    <XAxis
                        dataKey="x"
                        tickFormatter={formatDayLabel}
                        tick={{ fontSize: 11 }}
                        className="fill-slate-400 dark:fill-slate-500"
                        interval={Math.max(0, Math.floor(data.length / 6) - 1)}
                        axisLine={false}
                        tickLine={false}
                    />
                    <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11 }}
                        className="fill-slate-400 dark:fill-slate-500"
                        width={32}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                        type="monotone"
                        dataKey="y"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#umamiPageviewsGradient)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

export function AnalyticsTab() {
    const [events, setEvents] = useState<EventCount[]>([]);
    const [claimTypes, setClaimTypes] = useState<EventCount[]>([]);
    const [totalOpened, setTotalOpened] = useState(0);
    const [totalAuth, setTotalAuth] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const EXCLUDED_CLAIM_TYPES = ["missing"]; // agregá acá cualquier otro que quieras ocultar

    // ── Umami: visitas a la página pública ──
    const [umamiVisits, setUmamiVisits] = useState<number | null>(null);
    const [umamiVisitors, setUmamiVisitors] = useState<number | null>(null);
    const [umamiPageviews, setUmamiPageviews] = useState<UmamiPageviewPoint[]>([]);
    const [umamiLoading, setUmamiLoading] = useState(true);
    const [umamiError, setUmamiError] = useState("");

    const fetchUmamiData = async () => {
        setUmamiLoading(true);
        setUmamiError("");
        try {
            const [stats, pv] = await Promise.all([
                umamiApi.getStats(),
                umamiApi.getPageviews(30),
            ]);
            setUmamiVisits(stats.visits ?? 0);
            setUmamiVisitors(stats.visitors ?? 0);
            setUmamiPageviews(pv.pageviews ?? []);
        } catch {
            setUmamiError("No se pudieron cargar las métricas de Umami.");
        } finally {
            setUmamiLoading(false);
        }
    };

    const fetchData = async () => {
        setLoading(true);
        setError("");
        try {
            const token = localStorage.getItem("token");
            const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080/api/v1";
            const res = await fetch(`${apiBase}/analytics/chatbot`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error("error");
            const data = await res.json();

            setTotalOpened(data.total_opened ?? 0);
            setTotalAuth(data.total_auth ?? 0);

            // Convertir actions map a array ordenado
            const actionsArr = Object.entries(data.actions as Record<string, number>)
                .map(([event, count]) => ({ event, count }))
                .sort((a, b) => b.count - a.count);
            setEvents(actionsArr);

            // Convertir claim_types map a array ordenado
            
            const claimArr = Object.entries(data.claim_types as Record<string, number>)
                .map(([event, count]) => ({ event, count }))
                .filter(({ event, count }) => count > 0 && !EXCLUDED_CLAIM_TYPES.includes(event))
                .sort((a, b) => b.count - a.count);
            setClaimTypes(claimArr);

            setLastRefresh(new Date());
        } catch {
            setError("No se pudieron cargar los datos de analytics.");
        } finally {
            setLoading(false);
        }
    };

    const refreshAll = () => {
        fetchData();
        fetchUmamiData();
    };

    useEffect(() => {
        fetchData();
        fetchUmamiData();
    }, []);

    const maxAction = events[0]?.count ?? 1;
    const maxClaim = claimTypes[0]?.count ?? 1;

    const conversionRate =
        totalOpened > 0 ? ((totalAuth / totalOpened) * 100).toFixed(1) : "—";

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-gray-100">
                        Analytics & Chatbot
                    </h2>
                    {lastRefresh && (
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                            · Actualizado {lastRefresh.toLocaleTimeString("es-AR")}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={refreshAll}
                        disabled={loading || umamiLoading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading || umamiLoading ? "animate-spin" : ""}`} />
                        Actualizar
                    </button>
                    <a
                        href="https://app.posthog.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-colors"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir PostHog
                    </a>
                </div>
            </div>

            {/* Sección Umami */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-600" />
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            Visitas — Página pública (últimos 30 días)
                        </h3>
                    </div>
                    <a
                        href="https://cloud.umami.is"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-semibold transition-colors"
                    >
                        <ExternalLink className="w-3 h-3" />
                        Abrir Umami
                    </a>
                </div>

                {umamiError && (
                    <Card className="p-4 text-center">
                        <p className="text-sm text-rose-600">{umamiError}</p>
                    </Card>
                )}

                {umamiLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {[1, 2].map((i) => (
                            <Card key={i} className="p-4 h-20 animate-pulse bg-slate-100 dark:bg-gray-800" />
                        ))}
                    </div>
                ) : (
                    !umamiError && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <StatBox
                                    label="Visitas totales"
                                    value={umamiVisits ?? "—"}
                                    icon={<Eye className="w-5 h-5" />}
                                    color="blue"
                                />
                                <StatBox
                                    label="Visitantes únicos"
                                    value={umamiVisitors ?? "—"}
                                    icon={<Users className="w-5 h-5" />}
                                    color="violet"
                                />
                            </div>
                            <Card className="p-5">
                                <div className="flex items-center gap-2 mb-3">
                                    <TrendingUp className="w-4 h-4 text-blue-600" />
                                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Tendencia de visitas por día
                                    </h4>
                                </div>
                                <PageviewsChart data={umamiPageviews} />
                            </Card>
                        </>
                    )
                )}
            </div>

            {/* Sección chatbot */}
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-violet-600" />
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        Interacciones del Chatbot — Últimos 30 días
                    </h3>
                </div>

                {error && (
                    <Card className="p-4 text-center">
                        <p className="text-sm text-rose-600">{error}</p>
                    </Card>
                )}

                {loading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[1, 2, 3].map((i) => (
                            <Card key={i} className="p-4 h-20 animate-pulse bg-slate-100 dark:bg-gray-800" />
                        ))}
                    </div>
                ) : (
                    <>
                        {/* KPIs */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <StatBox
                                label="Chatbot abierto"
                                value={totalOpened}
                                icon={<MessageSquare className="w-5 h-5" />}
                                color="blue"
                            />
                            <StatBox
                                label="Autenticaciones"
                                value={totalAuth}
                                icon={<Users className="w-5 h-5" />}
                                color="violet"
                            />
                            <StatBox
                                label="Reclamos enviados"
                                value={claimTypes.reduce((sum, { count }) => sum + count, 0)}
                                icon={<TrendingUp className="w-5 h-5" />}
                                color="amber"
                            />
                            <StatBox
                                label="Tasa de conversión"
                                value={`${conversionRate}%`}
                                icon={<MousePointerClick className="w-5 h-5" />}
                                color="emerald"
                            />
                        </div>

                        {/* Opciones más usadas */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <Card className="p-5 space-y-4">
                                <div className="flex items-center gap-2">
                                    <MousePointerClick className="w-4 h-4 text-violet-600" />
                                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Opciones más usadas
                                    </h4>
                                </div>
                                {events.length === 0 ? (
                                    <p className="text-sm text-slate-400 dark:text-slate-500">
                                        Sin datos aún. Interactuá con el chatbot para ver métricas.
                                    </p>
                                ) : (
                                    <div className="space-y-3">
                                        {events.map(({ event, count }) => (
                                            <BarRow
                                                key={event}
                                                label={ACTION_LABELS[event] ?? event}
                                                value={count}
                                                max={maxAction}
                                            />
                                        ))}
                                    </div>
                                )}
                            </Card>

                            <Card className="p-5 space-y-4">
                                <div className="flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-amber-600" />
                                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                        Tipos de reclamos
                                    </h4>
                                </div>
                                {claimTypes.length === 0 ? (
                                    <p className="text-sm text-slate-400 dark:text-slate-500">
                                        Sin reclamos registrados aún.
                                    </p>
                                ) : (
                                    <div className="space-y-3">
                                        {claimTypes.map(({ event, count }) => (
                                            <BarRow
                                                key={event}
                                                label={CLAIM_TYPE_LABELS[event] ?? event}
                                                value={count}
                                                max={maxClaim}
                                            />
                                        ))}
                                    </div>
                                )}
                            </Card>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
