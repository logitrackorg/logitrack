import { forwardRef, useEffect, useRef, useState, useCallback, useImperativeHandle } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ArrowRight, Package, Truck, CheckCircle2, AlertCircle,
  AlertTriangle, Box, Clock, FileEdit, Building2,
  PackageCheck, Navigation, XCircle, RefreshCw, ThumbsDown, Ban, Undo2, HelpCircle,
  CreditCard, PackageOpen, Warehouse,
} from "lucide-react";
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from "recharts";
import { shipmentApi, type Stats, type CancellationStats, type AvgTimePerStatus, type ShipmentStatus } from "../../api/shipments";
import { type Branch } from "../../api/branches";
import { fmtDateTime } from "../../utils/date";
import { StatusBadge, STATUS_BADGE_CONFIG } from "../../components/StatusBadge";
import { shipmentStatusLabelOverride } from "../../utils/shipmentStatus";
import { Card } from "../../components/ui/card";
import { GradientCard, GradientCardIcon, GradientCardLabel, GradientCardValue } from "../../components/ui/gradient-card";
import { StatCard } from "../../components/ui/stat-card";
import { Gauge } from "../../components/charts/Gauge";
import { Doughnut, type DoughnutDataItem } from "../../components/charts/Doughnut";
import { Sparkline } from "../../components/charts/Sparkline";
import { toDateInput } from "../../utils/dashboard";
import { SkeletonCard } from "../../components/ui/skeleton";
import { exportToPDF, exportToExcel } from "../../utils/exportHelpers";

const statusConfig: Record<ShipmentStatus, { label: string; tone: "default" | "success" | "warning" | "danger" | "info" }> = {
  draft: { label: "Borradores", tone: "default" },
  at_origin_hub: { label: "En sucursal de origen", tone: "warning" },
  loaded: { label: "Cargado en vehículo", tone: "info" },
  in_transit: { label: "En tránsito", tone: "info" },
  at_hub: { label: "En sucursal", tone: "info" },
  out_for_delivery: { label: "Última milla", tone: "warning" },
  delivery_failed: { label: "Entrega fallida", tone: "danger" },
  redelivery_scheduled: { label: "Reentrega programada", tone: "warning" },
  no_entregado: { label: "No entregados", tone: "danger" },
  rechazado: { label: "Rechazados", tone: "danger" },
  delivered: { label: "Entregados", tone: "success" },
  ready_for_pickup: { label: "Listos para retiro", tone: "info" },
  ready_for_return: { label: "Listos para devolución", tone: "warning" },
  returned: { label: "Devueltos", tone: "default" },
  cancelled: { label: "Cancelados", tone: "danger" },
  lost: { label: "Extraviados", tone: "danger" },
  destroyed: { label: "Daño total", tone: "danger" },
  expired: { label: "Borrador expirado", tone: "default" },
  pending_payment: { label: "Pago pendiente", tone: "warning" },
};

const BRANCH_COLORS = ["#2563eb","#f97316","#22c55e","#ef4444","#8b5cf6","#06b6d4","#ec4899","#84cc16"];
const TOOLTIP_STYLE = { fontSize:12, borderRadius:10, border:"1px solid #e2e8f0", boxShadow:"0 8px 24px rgba(0,0,0,0.1)", padding:"10px 14px", background:"rgba(255,255,255,0.97)" };
const thClass = "px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider";
const tdClass = "px-4 py-3 text-slate-700";

function toDateLabel(v: string) {
  return new Date(v+"T12:00:00").toLocaleDateString("es-AR",{day:"2-digit",month:"short"});
}

const statusIconMap: Record<ShipmentStatus, React.ReactNode> = {
  draft: <FileEdit className="w-3.5 h-3.5" />,
  at_origin_hub: <Building2 className="w-3.5 h-3.5" />,
  loaded: <PackageCheck className="w-3.5 h-3.5" />,
  in_transit: <Navigation className="w-3.5 h-3.5" />,
  at_hub: <Warehouse className="w-3.5 h-3.5" />,
  out_for_delivery: <Truck className="w-3.5 h-3.5" />,
  delivery_failed: <XCircle className="w-3.5 h-3.5" />,
  redelivery_scheduled: <RefreshCw className="w-3.5 h-3.5" />,
  no_entregado: <AlertCircle className="w-3.5 h-3.5" />,
  rechazado: <ThumbsDown className="w-3.5 h-3.5" />,
  delivered: <CheckCircle2 className="w-3.5 h-3.5" />,
  ready_for_pickup: <PackageOpen className="w-3.5 h-3.5" />,
  ready_for_return: <Undo2 className="w-3.5 h-3.5" />,
  returned: <Undo2 className="w-3.5 h-3.5" />,
  cancelled: <Ban className="w-3.5 h-3.5" />,
  lost: <HelpCircle className="w-3.5 h-3.5" />,
  destroyed: <AlertTriangle className="w-3.5 h-3.5" />,
  expired: <Clock className="w-3.5 h-3.5" />,
  pending_payment: <CreditCard className="w-3.5 h-3.5" />,
};

export interface ResumenTabRef {
  exportPDF: () => Promise<void>;
  exportExcel: () => void;
}

interface ResumenTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
  onRefresh?: () => void;
  lastRefresh?: Date | null;
  isRefreshing?: boolean;
  branches?: Branch[];
}

const ResumenTab = forwardRef<ResumenTabRef, ResumenTabProps>(function ResumenTab(props, ref) {
  const { dateFrom, dateTo, branchId, onRefresh, branches = [] } = props;
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllStatuses, setShowAllStatuses] = useState(false);
  const [cancellationData, setCancellationData] = useState<CancellationStats | null>(null);
  const [avgTimeData, setAvgTimeData] = useState<AvgTimePerStatus | null>(null);
  const [sparklineData, setSparklineData] = useState<Record<string,{x:string;y:number}[]>>({});
  const navigate = useNavigate();
  const dashboardRef = useRef<HTMLDivElement>(null);

  const fetchDashboard = useCallback((showLoading: boolean) => {
    if (showLoading) setLoading(true);
    const params: { date_from: string; date_to: string; branch_id?: string } = { date_from: dateFrom, date_to: dateTo };
    if (branchId) params.branch_id = branchId;
    Promise.all([
      shipmentApi.stats(params),
      shipmentApi.cancellationStats(params),
      shipmentApi.avgTimePerStatus({ date_from: dateFrom, date_to: dateTo }),
    ]).then(([s, cs, avg]) => {
      setStats(s); setCancellationData(cs); setAvgTimeData(avg);
      if (showLoading) setLoading(false);
      onRefresh?.();
    }).catch(() => {
      if (showLoading) setLoading(false);
    });
  }, [dateFrom, dateTo, branchId, onRefresh]);

  useEffect(() => {
    fetchDashboard(true);
    const interval = setInterval(() => fetchDashboard(false), 60000);
    let visibilityTimeout: ReturnType<typeof setTimeout>;
    const onVisibleDebounced = () => {
      if (!document.hidden) {
        clearTimeout(visibilityTimeout);
        visibilityTimeout = setTimeout(() => fetchDashboard(false), 300);
      }
    };
    document.addEventListener("visibilitychange", onVisibleDebounced);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisibleDebounced); clearTimeout(visibilityTimeout); };
  }, [fetchDashboard]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      try {
        const results = await Promise.all(Array.from({length:7}, (_,i) => {
          const d = new Date(now); d.setDate(d.getDate()-(6-i));
          const p: { date_from: string; date_to: string; branch_id?: string } = { date_from: toDateInput(d), date_to: toDateInput(d) };
          if (branchId) p.branch_id = branchId;
          return shipmentApi.stats(p);
        }));
        setSparklineData({
          total: results.map((s,i) => ({ x:String(i), y:s.total })),
          inProgress: results.map((s,i) => ({ x:String(i), y:(s.by_status?.in_transit??0)+(s.by_status?.out_for_delivery??0)+(s.by_status?.loaded??0) })),
          delivered: results.map((s,i) => ({ x:String(i), y:s.by_status?.delivered??0 })),
          issues: results.map((s,i) => ({ x:String(i), y:(s.by_status?.delivery_failed??0)+(s.by_status?.lost??0)+(s.by_status?.destroyed??0) })),
        });
      } catch { /* non-critical */ }
    })();
  }, [branchId]);

  const totalShipments = stats?.total??0;
  const inProgress = (stats?.by_status?.in_transit??0)+(stats?.by_status?.out_for_delivery??0)+(stats?.by_status?.loaded??0);
  const delivered = stats?.by_status?.delivered??0;
  const issues = (stats?.by_status?.delivery_failed??0)+(stats?.by_status?.lost??0)+(stats?.by_status?.destroyed??0);

  const chartData: {date:string;creados:number;entregados:number}[] = [];
  if (dateFrom && dateTo) {
    const cur = new Date(dateFrom+"T00:00:00"), end = new Date(dateTo+"T00:00:00");
    while (cur <= end) {
      const k = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
      chartData.push({ date:k, creados: stats?.by_day?.[k]??0, entregados: stats?.by_day_delivered?.[k]??0 });
      cur.setDate(cur.getDate()+1);
    }
  }

  const doughnutItems: DoughnutDataItem[] = stats?.by_branch
    ? Object.entries(stats.by_branch).map(([id,count],i)=>({ name:branches.find(b=>b.id===id)?.name??id, value:count, color:BRANCH_COLORS[i%BRANCH_COLORS.length] }))
    : [];
  const doughnutTotal = stats?.by_branch ? Object.values(stats.by_branch).reduce((a,b)=>a+b,0) : 0;

  const handleExportPDF = useCallback(async () => {
    await exportToPDF(dashboardRef, `dashboard_${new Date().toISOString().slice(0,10)}.pdf`);
  }, []);

  const handleExportExcel = useCallback(() => {
    const statusRows = Object.entries(stats?.by_status??{}).map(([s,c])=>({Estado:statusConfig[s as ShipmentStatus]?.label??s,Cantidad:c}));
    const dailyRows = chartData.map(d=>({Fecha:d.date,Creados:d.creados,Entregados:d.entregados}));
    exportToExcel([
      { name: "Distribucion por estado", data: statusRows },
      { name: "Tendencia diaria", data: dailyRows },
    ], `dashboard_${new Date().toISOString().slice(0,10)}.xlsx`);
  }, [stats, chartData]);

  useImperativeHandle(ref, () => ({
    exportPDF: handleExportPDF,
    exportExcel: handleExportExcel,
  }), [handleExportPDF, handleExportExcel]);

  const renderKpiCards = () => loading ? (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <SkeletonCard className="h-28" /><SkeletonCard className="h-28" /><SkeletonCard className="h-28" /><SkeletonCard className="h-28" />
    </div>
  ) : (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <GradientCard tone="brand" className="hover:shadow-[0_8px_24px_rgba(37,99,235,0.3)] transition-shadow duration-200">
        <div className="flex items-start gap-3">
          <GradientCardIcon><Box className="w-5 h-5" /></GradientCardIcon>
          <div className="flex-1 min-w-0">
            <GradientCardLabel>Total de envíos</GradientCardLabel>
            <GradientCardValue className="mt-1">{totalShipments}</GradientCardValue>
            {sparklineData.total?.length>0 && <Sparkline data={sparklineData.total} color="rgba(255,255,255,0.7)" width={100} height={28} />}
          </div>
        </div>
      </GradientCard>
      <StatCard label="En curso" value={inProgress} hint="Cargado en vehículo + en tránsito + última milla" icon={<Truck className="w-4 h-4"/>} tone="info" accentColor="#3b82f6"
        extra={sparklineData.inProgress?.length>0 ? <Sparkline data={sparklineData.inProgress} color="#3b82f6" width={100} height={28} /> : undefined} />
      <StatCard label="Entregados" value={delivered} hint="Completados con éxito" icon={<CheckCircle2 className="w-4 h-4"/>} tone="success" accentColor="#10b981"
        onClick={()=>navigate(`/kpi-detail?kpi=delivered&date_from=${dateFrom}&date_to=${dateTo}${branchId?`&branch_id=${branchId}`:""}`)}
        extra={sparklineData.delivered?.length>0 ? <Sparkline data={sparklineData.delivered} color="#10b981" width={100} height={28} /> : undefined} />
      <StatCard label="Problemas" value={issues} hint="Fallidos + extraviados + dañados" icon={<AlertCircle className="w-4 h-4"/>} tone="danger" accentColor="#ef4444"
        onClick={()=>navigate(`/kpi-detail?kpi=issues&date_from=${dateFrom}&date_to=${dateTo}${branchId?`&branch_id=${branchId}`:""}`)}
        extra={sparklineData.issues?.length>0 ? <Sparkline data={sparklineData.issues} color="#ef4444" width={100} height={28} /> : undefined} />
    </div>
  );

  const renderOperationMetrics = () => !loading && stats && (stats.success_rate!=null||stats.avg_cycle_time_hours!=null) ? (
    <div className="bg-gradient-to-br from-slate-50 to-white rounded-xl border border-slate-200 px-5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 shrink-0">Métricas de operación</span>
        {stats.success_rate!=null&&<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-sm text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />Tasa de éxito: <strong className="tab-nums">{stats.success_rate.toFixed(1)}%</strong></span>}
        {stats.avg_cycle_time_hours!=null&&<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-sm text-blue-700"><Clock className="w-3.5 h-3.5 shrink-0" />Ciclo promedio: <strong className="tab-nums">{stats.avg_cycle_time_hours.toFixed(1)} h</strong></span>}
        {stats.open_incidents>0&&<span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-3 py-1 text-sm text-rose-700"><AlertCircle className="w-3.5 h-3.5 shrink-0" />Incidentes abiertos: <strong className="tab-nums">{stats.open_incidents}</strong></span>}
      </div>
    </div>
  ) : null;

  const renderGaugeDoughnutSection = () => !loading && stats && (stats.avg_cycle_time_hours!=null||Object.keys(stats.by_branch??{}).length>0) ? (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {stats.avg_cycle_time_hours!=null&&<Card>
        <div className="px-5 pt-5 pb-3 flex items-center gap-2 border-b border-slate-100">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-emerald-500 to-emerald-300" />
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">Ciclo promedio</h2>
        </div>
        <div className="p-5 flex items-center justify-center">
          <Gauge value={stats.avg_cycle_time_hours} min={0} max={72} thresholds={[{value:24,color:"#22c55e"},{value:48,color:"#f97316"},{value:72,color:"#ef4444"}]} label="Ciclo promedio" unit="h" />
        </div>
      </Card>}
      {doughnutItems.length>0&&<Card>
        <div className="px-5 pt-5 pb-3 flex items-center gap-2 border-b border-slate-100">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-600 to-emerald-500" />
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">Distribución por sucursal</h2>
        </div>
        <div className="p-5 flex items-center justify-center">
          <Doughnut data={doughnutItems} centerLabel="Total" centerValue={doughnutTotal} />
        </div>
      </Card>}
    </div>
  ) : null;

  const renderStatusSection = () => (
    <Card>
      <div className="px-5 pt-5 pb-3 flex items-baseline justify-between border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-600 to-blue-950" />
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">Distribución por estado</h2>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-500 hidden sm:block">Click en una tarjeta para filtrar</p>
          <button onClick={()=>setShowAllStatuses(!showAllStatuses)}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50 rounded">
            {showAllStatuses?"Solo con datos":"Mostrar todos"}
          </button>
        </div>
      </div>
      <div className="px-5 pb-5">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {Array.from({length:10}).map((_,i)=><SkeletonCard key={i} className="h-16" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {(Object.keys(statusConfig)as ShipmentStatus[]).filter(s=>showAllStatuses||(stats?.by_status?.[s]??0)>0).map(s=>{
              const cfg = statusConfig[s];
              return <StatCard key={s} label={cfg.label} value={stats?.by_status?.[s]??0} tone={cfg.tone}
                icon={statusIconMap[s]??<Package className="w-3.5 h-3.5"/>}
                accentColor={STATUS_BADGE_CONFIG[s]?.bg} onClick={()=>navigate(`/?status=${s}`)} className="!p-3" />;
            })}
          </div>
        )}
      </div>
    </Card>
  );

  const renderBarChart = () => (
    <Card>
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-blue-600 to-emerald-500" />
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">Envíos creados vs entregados por día</h2>
        </div>
      </div>
      <div className="p-5">
        {loading ? <SkeletonCard className="h-56 w-full" />
        : chartData.length===0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <LayoutDashboard className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm text-slate-500 mb-1">No hay datos en este rango</p>
            <p className="text-xs text-slate-400">Ajustá las fechas para ver el gráfico</p>
          </div>
        ) : (
          <div className="rounded-xl bg-white border border-slate-100 p-4">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} barCategoryGap="18%" margin={{top:8,right:8,left:-10,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{fontSize:10,fill:"#94a3b8",fontWeight:500}} tickFormatter={v=>String(v).slice(5)}
                  interval={Math.max(0,Math.floor(chartData.length/12))} axisLine={{stroke:"#e2e8f0"}} tickLine={false} />
                <YAxis tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l)=>toDateLabel(l as string)} formatter={(v, n) => [v, n]} />
                <Bar dataKey="creados" fill="#2563eb" radius={[3,3,0,0]} name="Creados" maxBarSize={32} />
                <Bar dataKey="entregados" fill="#10b981" radius={[3,3,0,0]} name="Entregados" maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-5 mt-3 pt-3 border-t border-slate-100">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                <span className="inline-block w-2 h-2 rounded-sm bg-blue-600" /> Creados
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" /> Entregados
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );

  const renderCancellationChart = () => {
    if (loading) return <Card><div className="px-5 pt-5 pb-4"><SkeletonCard className="h-20 w-full" /></div></Card>;
    const sortedDays = cancellationData?.by_day ? Object.entries(cancellationData.by_day).sort(([a],[b])=>a.localeCompare(b)) : [];
    const lineData = sortedDays.map(([date,count])=>({date,cancelaciones:count}));
    const noData = !cancellationData||cancellationData.total===0||!lineData.some(d=>d.cancelaciones>0);
    if (noData) return (
      <Card>
        <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-rose-500 to-rose-300" />
            <h2 className="text-base font-semibold text-slate-900 tracking-tight">Cancelaciones</h2>
          </div>
        </div>
        <div className="px-5 pb-5"><p className="text-xs text-slate-400 text-center py-4">Sin cancelaciones en el período</p></div>
      </Card>
    );
    const maxVal = Math.max(...lineData.map(d=>d.cancelaciones),1);
    const peakEntry = [...lineData].sort((a,b)=>b.cancelaciones-a.cancelaciones)[0];
    const CustomPeakDot = (props:{cx?:number;cy?:number;payload?:{date:string;cancelaciones:number}}) => {
      const {cx,cy,payload}=props;
      if (!payload||!cx||!cy) return null;
      if (payload.date!==peakEntry?.date||payload.cancelaciones===0) return <circle cx={cx} cy={cy} r={2} fill="#ef4444" />;
      return <g><circle cx={cx} cy={cy} r={8} fill="#fee2e2" stroke="#ef4444" strokeWidth={1.5} /><text x={cx} y={cy+4} textAnchor="middle" fontSize={11} fill="#dc2626" fontWeight="bold">⚠</text></g>;
    };
    return (
      <Card>
        <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-rose-500 to-rose-300" />
            <h2 className="text-base font-semibold text-slate-900 tracking-tight">Cancelaciones</h2>
          </div>
          <span className="text-xs text-slate-500">Total: <strong className="text-red-600 tabular-nums">{cancellationData!.total}</strong></span>
        </div>
        <div className="px-5 pb-5 space-y-4">
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={lineData} margin={{top:4,right:4,bottom:0,left:-20}}>
                <defs><linearGradient id="cancelGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                </linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{fontSize:10,fill:"#94a3b8"}} tickFormatter={(v:string)=>v.slice(5)}
                  interval={Math.max(0,Math.floor(lineData.length/8))} axisLine={false} tickLine={false} />
                <YAxis domain={[0,maxVal+1]} allowDecimals={false} tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{fontSize:12,borderRadius:8,border:"1px solid #e2e8f0",boxShadow:"0 4px 12px rgba(0,0,0,0.08)",padding:"8px 12px",background:"rgba(255,255,255,0.97)"}}
                  formatter={(v)=>[v,"Cancelaciones"]} labelFormatter={(v)=>toDateLabel(v as string)} />
                <Area type="monotone" dataKey="cancelaciones" stroke="#ef4444" strokeWidth={2} fill="url(#cancelGrad)" dot={<CustomPeakDot/>} activeDot={{r:5,fill:"#ef4444"}} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>
    );
  };

  const renderAvgTimeChart = () => (
    <Card>
      <div className="px-5 pt-5 pb-4 flex items-center gap-2 border-b border-slate-100">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-amber-500 to-amber-300" />
        <h2 className="text-base font-semibold text-slate-900 tracking-tight">Tiempo promedio por estado</h2>
      </div>
      {loading ? <div className="p-5"><SkeletonCard className="h-48 w-full" /></div>
      : !avgTimeData||avgTimeData.length===0 ? <div className="p-5"><p className="text-xs text-slate-400 text-center py-8">Sin datos suficientes para calcular tiempos promedio</p></div>
      : <div className="p-5">
        <div className="rounded-xl bg-white border border-slate-100 p-4">
          <ResponsiveContainer width="100%" height={Math.max(180,avgTimeData.length*44)}>
            <BarChart data={avgTimeData.map(i=>({...i,label:STATUS_BADGE_CONFIG[i.status]?.label??i.status}))}
              layout="vertical" margin={{top:4,right:48,bottom:4,left:120}} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{fontSize:10,fill:"#94a3b8"}} axisLine={false} tickLine={false} unit="h" />
              <YAxis type="category" dataKey="label" tick={{fontSize:11,fill:"#475569",fontWeight:500}} axisLine={false} tickLine={false} width={120} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v)=>[`${Number(v).toFixed(1)}h`,"Promedio"]} labelFormatter={(l)=>l} />
              <Bar dataKey="avg_hours" name="Tiempo promedio" radius={[0,4,4,0]} maxBarSize={28}
                shape={(p: { x?: number; y?: number; width?: number; height?: number; payload?: { is_bottleneck?: boolean; avg_hours?: number } })=>{const x=p.x??0,y=p.y??0,width=p.width??0,height=p.height??0,payload=p.payload; const fill=payload?.is_bottleneck?"#f59e0b":"#1e3a5f";
                  return <g><rect x={x} y={y} width={width} height={height} rx={4} fill={fill} /><text x={x+width+6} y={y+height/2+4} fontSize={11} fill="#475569" fontWeight={600} textAnchor="start">{Number(payload?.avg_hours??0).toFixed(1)}h</text></g>;}}>
                {avgTimeData.map((e)=><Cell key={e.status} fill={e.is_bottleneck?"#f59e0b":"#1e3a5f"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>}
    </Card>
  );

  const renderRecentShipments = () => (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-gradient-to-b from-slate-400 to-slate-300" />
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">Envíos recientes</h2>
        </div>
        <button onClick={()=>navigate("/")}
          className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50 rounded">
          Ver todos <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
      {loading ? <div className="p-5 space-y-3">{Array.from({length:3}).map((_,i)=><SkeletonCard key={i} className="h-10 w-full" />)}</div>
      : (stats?.recent_shipments?.length??0)===0 ? (
        <div className="p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3"><Package className="w-6 h-6 text-slate-400" /></div>
          <p className="text-sm font-semibold text-slate-600 mb-1">Sin envíos recientes</p>
          <p className="text-xs text-slate-400">Los envíos aparecerán acá a medida que se creen.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-slate-50 text-left border-b border-slate-100">
                <th className={thClass}>ID de seguimiento</th><th className={thClass}>Destinatario</th>
                <th className={thClass}>Destino</th><th className={thClass}>Estado</th><th className={thClass}>Creado</th>
              </tr>
            </thead>
            <tbody>{(stats?.recent_shipments??[]).map((s,i)=>(
              <tr key={s.tracking_id} onClick={()=>navigate(`/shipments/${s.tracking_id}`)}
                className={`border-b border-slate-100 cursor-pointer transition-all ${i%2===0?"bg-white":"bg-slate-50/20"} hover:bg-blue-50/70 hover:shadow-[0_1px_4px_rgba(37,99,235,0.08)]`}>
                <td className={tdClass}><code className="text-xs font-mono text-blue-950 font-semibold bg-slate-50 px-1.5 py-0.5 rounded">{s.tracking_id}</code></td>
                <td className={tdClass}>{s.recipient.name}</td>
                <td className={`${tdClass} text-slate-500`}>{s.recipient.address.city}</td>
                <td className={tdClass}><StatusBadge status={s.status} label={shipmentStatusLabelOverride(s)} /></td>
                <td className={`${tdClass} text-slate-400`}>{fmtDateTime(s.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <div ref={dashboardRef}>
      <div className="space-y-6">
        {renderKpiCards()}
        {renderOperationMetrics()}
        {renderGaugeDoughnutSection()}
        {renderStatusSection()}
        {renderBarChart()}
        {renderCancellationChart()}
        {renderAvgTimeChart()}
        {renderRecentShipments()}
      </div>
    </div>
  );
});

export default ResumenTab;
