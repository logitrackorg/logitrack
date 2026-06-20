import { useEffect, useState } from "react";
import {
    Globe,
    MessageSquare,
    MousePointerClick,
    Users,
    ExternalLink,
    RefreshCw,
    TrendingUp,
} from "lucide-react";
import { Card } from "../../components/ui/card";

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

export function AnalyticsTab() {
    const [events, setEvents] = useState<EventCount[]>([]);
    const [claimTypes, setClaimTypes] = useState<EventCount[]>([]);
    const [totalOpened, setTotalOpened] = useState(0);
    const [totalAuth, setTotalAuth] = useState(0);
    const [totalClaims, setTotalClaims] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const fetchData = async () => {
        setLoading(true);
        setError("");
        try {
            const token = localStorage.getItem("token");
            const res = await fetch("/api/v1/analytics/chatbot", {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error("error");
            const data = await res.json();

            setTotalOpened(data.total_opened ?? 0);
            setTotalAuth(data.total_auth ?? 0);
            setTotalClaims(data.total_claims ?? 0);

            // Convertir actions map a array ordenado
            const actionsArr = Object.entries(data.actions as Record<string, number>)
                .map(([event, count]) => ({ event, count }))
                .sort((a, b) => b.count - a.count);
            setEvents(actionsArr);

            // Convertir claim_types map a array ordenado
            const claimArr = Object.entries(data.claim_types as Record<string, number>)
                .map(([event, count]) => ({ event, count }))
                .sort((a, b) => b.count - a.count);
            setClaimTypes(claimArr);

            setLastRefresh(new Date());
        } catch {
            setError("No se pudieron cargar los datos de analytics.");
        } finally {
            setLoading(false);
        }
    };

    /* const fetchData = async () => {
       setLoading(true);
       setError("");
       try {
         // Usar la API de PostHog para obtener eventos
         const headers = {
           Authorization: `Bearer ${POSTHOG_API_KEY}`,
           "Content-Type": "application/json",
         };
   
         // Obtener conteo de eventos de los últimos 30 días
         const since = new Date();
         since.setDate(since.getDate() - 30);
         const sinceStr = since.toISOString().slice(0, 10);
   
         const res = await fetch(
           `${POSTHOG_HOST}/api/projects/@current/events/?event=chatbot_option_selected&after=${sinceStr}&limit=1000`,
           { headers }
         );
   
         if (!res.ok) throw new Error("No se pudieron cargar los datos de PostHog");
   
         const data = await res.json();
         const results = data.results ?? [];
   
         // Contar por acción
         const actionCounts: Record<string, number> = {};
         for (const ev of results) {
           const action = ev.properties?.action as string;
           if (action) actionCounts[action] = (actionCounts[action] ?? 0) + 1;
         }
         setEvents(
           Object.entries(actionCounts)
             .map(([event, count]) => ({ event, count }))
             .sort((a, b) => b.count - a.count)
         );
   
         // Claim types
         const claimRes = await fetch(
           `${POSTHOG_HOST}/api/projects/@current/events/?event=chatbot_claim_type_selected&after=${sinceStr}&limit=1000`,
           { headers }
         );
         const claimData = await claimRes.json();
         const claimResults = claimData.results ?? [];
         const claimCounts: Record<string, number> = {};
         for (const ev of claimResults) {
           const ct = ev.properties?.claim_type as string;
           if (ct) claimCounts[ct] = (claimCounts[ct] ?? 0) + 1;
         }
         setClaimTypes(
           Object.entries(claimCounts)
             .map(([event, count]) => ({ event, count }))
             .sort((a, b) => b.count - a.count)
         );
   
         // Totales
         const openedRes = await fetch(
           `${POSTHOG_HOST}/api/projects/@current/events/?event=chatbot_opened&after=${sinceStr}&limit=1`,
           { headers }
         );
         const openedData = await openedRes.json();
         setTotalOpened(openedData.count ?? 0);
   
         const authRes = await fetch(
           `${POSTHOG_HOST}/api/projects/@current/events/?event=chatbot_authenticated&after=${sinceStr}&limit=1`,
           { headers }
         );
         const authData = await authRes.json();
         setTotalAuth(authData.count ?? 0);
   
         const claimSubmitRes = await fetch(
           `${POSTHOG_HOST}/api/projects/@current/events/?event=chatbot_claim_submitted&after=${sinceStr}&limit=1`,
           { headers }
         );
         const claimSubmitData = await claimSubmitRes.json();
         setTotalClaims(claimSubmitData.count ?? 0);
   
         setLastRefresh(new Date());
       } catch (e) {
         setError("No se pudieron cargar los datos. Verificá la conexión con PostHog.");
       } finally {
         setLoading(false);
       }
     };*/

    useEffect(() => {
        fetchData();
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
                        onClick={fetchData}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
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
                <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        Visitas — Página pública
                    </h3>
                </div>
                <Card className="p-5 flex items-center justify-between">
                    <div>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Las métricas de visitas están disponibles en el dashboard de Umami.
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            Umami registra visitas, países, dispositivos y páginas más vistas de la página pública de seguimiento.
                        </p>
                    </div>
                    <a
                        href="https://cloud.umami.is"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-semibold transition-colors ml-4"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Abrir Umami
                    </a>
                </Card>
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
                                value={totalClaims}
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