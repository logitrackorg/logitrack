import { useState, useEffect, useCallback, useMemo, Suspense, lazy, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  DollarSign,
  BarChart3,
  Clock,
  Undo2,
  TrendingUp,
  Activity,
  Zap,
  Truck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Trophy,
  Settings2,
  RotateCcw,
  X,
} from "lucide-react";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { useMetricPermissions } from "../context/MetricPermissionsContext";
import { useDashboardPrefs } from "../context/DashboardPrefsContext";
import { DashboardCustomizationModal } from "../components/DashboardCustomizationModal";
import type { DashboardMetricPref } from "../api/dashboardPrefs";
import { ReportFilters } from "../components/ReportFilters";
import { PageHeader } from "../components/ui/page-header";
import { defaultRange } from "../utils/dashboard";
import { SkeletonCard } from "../components/ui/skeleton";
import type { ResumenTabRef } from "./reports/ResumenTab";

const ResumenTab = lazy(() => import("./reports/ResumenTab").then(m => ({ default: m.ResumenTab })));
const ChoferesTab = lazy(() => import("./reports/ChoferesTab").then(m => ({ default: m.ChoferesTab })));
const ReclamosTab = lazy(() => import("./reports/ReclamosTab").then(m => ({ default: m.ReclamosTab })));
const FacturacionTab = lazy(() => import("./reports/FacturacionTab").then(m => ({ default: m.FacturacionTab })));
const RankingTab = lazy(() => import("./reports/RankingTab").then(m => ({ default: m.RankingTab })));
const VolumenTab = lazy(() => import("./reports/VolumenTab").then(m => ({ default: m.VolumenTab })));
const TipoEnvioTab = lazy(() => import("./reports/TipoEnvioTab").then(m => ({ default: m.TipoEnvioTab })));
const MetodoEntregaTab = lazy(() => import("./reports/MetodoEntregaTab").then(m => ({ default: m.MetodoEntregaTab })));
const RetornoTab = lazy(() => import("./reports/RetornoTab").then(m => ({ default: m.RetornoTab })));
const ExitoTab = lazy(() => import("./reports/ExitoTab").then(m => ({ default: m.ExitoTab })));
const FatigaTab = lazy(() => import("./reports/FatigaTab").then(m => ({ default: m.FatigaTab })));
const SlaTab = lazy(() => import("./reports/SlaTab"));
const EmpleadoMesTab = lazy(() => import("./reports/EmpleadoMesTab").then(m => ({ default: m.EmpleadoMesTab })));

const tabs = [
  { id: "resumen", label: "Resumen", icon: LayoutDashboard },
  { id: "choferes", label: "Choferes", icon: Users },
  { id: "reclamos", label: "Incidentes", icon: AlertTriangle },
  { id: "facturacion", label: "Facturación", icon: DollarSign },
  { id: "ranking", label: "Ranking", icon: BarChart3 },
  { id: "volumen", label: "Vol. por Ventana", icon: Clock },
  { id: "tipo-envio", label: "Tipo de Envío", icon: Zap },
  { id: "metodo-entrega", label: "Método de Entrega", icon: Truck },
  { id: "retorno", label: "Retorno", icon: Undo2 },
  { id: "exito", label: "Tasa de Éxito", icon: TrendingUp },
  { id: "fatiga", label: "Fatiga", icon: Activity },
  { id: "sla", label: "SLA", icon: ShieldAlert },
  { id: "empleado-mes", label: "Empleado del Mes", icon: Trophy },
];

const tabById = Object.fromEntries(tabs.map((t) => [t.id, t]));

// Default prefs (used while the real prefs are loading from the server).
const defaultPrefs: DashboardMetricPref[] = tabs.map((t, i) => ({
  metric_id: t.id,
  metric_label: t.label,
  sort_order: i,
  is_hidden: false,
}));

export function DashboardHost() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, hasRole } = useAuth();
  const { hasMetricPermission } = useMetricPermissions();
  const { prefs, wasResetByAdmin, clearResetFlag } = useDashboardPrefs();
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [resetDetailsOpen, setResetDetailsOpen] = useState(false);

  const activePrefs = prefs ?? defaultPrefs;

  const visibleTabs = useMemo(() => {
    const prefsSet = new Set(activePrefs.map((p) => p.metric_id));
    const fromPrefs = activePrefs
      .filter((p) => !p.is_hidden && hasMetricPermission(p.metric_id))
      .map((p) => tabById[p.metric_id])
      .filter((t): t is (typeof tabs)[0] => t !== undefined);
    // Metrics newly granted by admin that aren't in the user's saved prefs yet
    const newlyGranted = tabs.filter(
      (t) => hasMetricPermission(t.id) && !prefsSet.has(t.id),
    );
    return [...fromPrefs, ...newlyGranted];
  }, [activePrefs, hasMetricPermission]);
  const rawTab = searchParams.get("tab") || "resumen";
  // If the requested tab is not visible, fall back to the first visible one.
  const activeTab = visibleTabs.find((t) => t.id === rawTab)?.id ?? visibleTabs[0]?.id ?? "resumen";

  const setTab = (t: string) => setSearchParams({ tab: t });

  // Sync URL when permissions change and the active tab disappears.
  useEffect(() => {
    if (rawTab !== activeTab) {
      setSearchParams({ tab: activeTab }, { replace: true });
    }
  }, [activeTab, rawTab, setSearchParams]);

  const range = defaultRange();
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");

  const isSupervisor = hasRole("supervisor") && !hasRole("manager", "admin");
  const supervisorBranch = isSupervisor ? (user?.branch_id ?? "") : "";
  const effectiveBranch = isSupervisor ? supervisorBranch : selectedBranch;

  useEffect(() => {
    branchApi.list("activo").then(setBranches);
  }, []);

  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => {
      setLastRefresh(new Date());
      setIsRefreshing(false);
    }, 500);
  }, []);

  const resumenTabRef = useRef<ResumenTabRef>(null);

  // ── Scroll arrows + drag-to-scroll para el tab bar ───────────────────────
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const dragIsDown = useRef(false);
  const dragStartX = useRef(0);
  const dragScrollLeft = useRef(0);

  const checkScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    checkScroll();
    el?.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el?.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  const scrollTabs = (dir: "left" | "right") => {
    tabsRef.current?.scrollBy({ left: dir === "left" ? -240 : 240, behavior: "smooth" });
  };
  // ──────────────────────────────────────────────────────────────────────────

  const sharedProps = {
    dateFrom,
    dateTo,
    branchId: effectiveBranch,
    branches,
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gray-950">
      {/* Header + tab bar (sticky) */}
      <div className="bg-white dark:bg-gray-900 border-b border-slate-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-0">
          <PageHeader
            icon={<LayoutDashboard className="h-6 w-6" />}
            title="Dashboard"
            description="Vista consolidada de la operación logística"
            actions={
              <ReportFilters
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                selectedBranch={effectiveBranch}
                onBranchChange={setSelectedBranch}
                branches={branches}
                isSupervisor={isSupervisor}
                showExport={activeTab === "resumen"}
                onExportPDF={() => resumenTabRef.current?.exportPDF()}
                onExportExcel={() => resumenTabRef.current?.exportExcel()}
                showAutoRefresh={activeTab === "resumen"}
                lastRefresh={lastRefresh}
                isRefreshing={isRefreshing}
              />
            }
          />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-3 relative flex items-end">
          {/* Flecha izquierda */}
          <button
            aria-label="Desplazar pestañas a la izquierda"
            onClick={() => scrollTabs("left")}
            className={`shrink-0 mr-1 h-9 w-7 flex items-center justify-center rounded-md text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-100 hover:bg-slate-100 dark:hover:bg-gray-700 transition-all cursor-pointer ${canScrollLeft ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Contenedor de tabs con scroll */}
          <div
            ref={tabsRef}
            className="flex gap-0 overflow-x-auto scroll-smooth scrollbar-hide flex-1 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={(e) => {
              dragIsDown.current = true;
              dragStartX.current = e.pageX - (tabsRef.current?.offsetLeft ?? 0);
              dragScrollLeft.current = tabsRef.current?.scrollLeft ?? 0;
            }}
            onMouseLeave={() => { dragIsDown.current = false; }}
            onMouseUp={() => { dragIsDown.current = false; }}
            onMouseMove={(e) => {
              if (!dragIsDown.current) return;
              e.preventDefault();
              const x = e.pageX - (tabsRef.current?.offsetLeft ?? 0);
              const walk = (x - dragStartX.current) * 1.5;
              if (tabsRef.current) tabsRef.current.scrollLeft = dragScrollLeft.current - walk;
            }}
          >
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              return (
                <TabButton
                  key={t.id}
                  active={activeTab === t.id}
                  onClick={() => setTab(t.id)}
                >
                  <Icon className="w-4 h-4" />
                  <span>{t.label}</span>
                </TabButton>
              );
            })}
          </div>

          {/* Flecha derecha */}
          <button
            aria-label="Desplazar pestañas a la derecha"
            onClick={() => scrollTabs("right")}
            className={`shrink-0 ml-1 h-9 w-7 flex items-center justify-center rounded-md text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-100 hover:bg-slate-100 dark:hover:bg-gray-700 transition-all cursor-pointer ${canScrollRight ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Personalizar pestañas */}
          <button
            aria-label="Personalizar pestañas del dashboard"
            title="Personalizar pestañas"
            onClick={() => setCustomizerOpen(true)}
            className="shrink-0 ml-1 h-9 w-8 flex items-center justify-center rounded-md text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-100 hover:bg-slate-100 dark:hover:bg-gray-700 transition-all cursor-pointer"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <DashboardCustomizationModal
        open={customizerOpen}
        onClose={() => setCustomizerOpen(false)}
      />

      {/* Admin reset banner */}
      {wasResetByAdmin && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div className="flex items-center gap-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
            <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="flex-1 text-sm text-amber-800 dark:text-amber-300">
              Tu configuración fue reseteda a valores por defecto por el administrador
            </p>
            <button
              onClick={() => setResetDetailsOpen(true)}
              className="shrink-0 text-sm font-medium text-amber-700 dark:text-amber-400 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200 cursor-pointer transition-colors"
            >
              Ver detalles
            </button>
          </div>
        </div>
      )}

      {/* Admin reset details modal */}
      {resetDetailsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setResetDetailsOpen(false); }}
        >
          <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                  <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <h2 className="text-base font-semibold text-slate-800 dark:text-gray-100">
                  Configuración restablecida
                </h2>
              </div>
              <button
                onClick={() => setResetDetailsOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-600 dark:text-gray-300">
              Un administrador restableció tu configuración del dashboard a los valores por
              defecto. El orden y la visibilidad de las pestañas fueron restaurados.
            </p>
            <p className="text-sm text-slate-600 dark:text-gray-300">
              Podés volver a personalizar tu dashboard en cualquier momento usando el
              botón <span className="inline-flex items-center gap-1 font-medium">de configuración <Settings2 className="w-3.5 h-3.5 inline" /></span> en la barra de pestañas.
            </p>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => {
                  setResetDetailsOpen(false);
                  clearResetFlag();
                }}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 cursor-pointer transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contenido del tab activo */}
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div key={activeTab} className="animate-fade-in">
          <Suspense fallback={<SkeletonCard className="h-96" />}>
            {activeTab === "resumen" && (
              <ResumenTab
                ref={resumenTabRef}
                {...sharedProps}
                onRefresh={onRefresh}
                lastRefresh={lastRefresh}
                isRefreshing={isRefreshing}
              />
            )}
            {activeTab === "choferes" && <ChoferesTab {...sharedProps} />}
            {activeTab === "reclamos" && <ReclamosTab {...sharedProps} />}
            {activeTab === "facturacion" && <FacturacionTab {...sharedProps} />}
            {activeTab === "ranking" && <RankingTab {...sharedProps} />}
            {activeTab === "volumen" && <VolumenTab {...sharedProps} />}
            {activeTab === "tipo-envio" && <TipoEnvioTab {...sharedProps} />}
            {activeTab === "metodo-entrega" && <MetodoEntregaTab {...sharedProps} />}
            {activeTab === "retorno" && <RetornoTab {...sharedProps} />}
            {activeTab === "exito" && <ExitoTab {...sharedProps} />}
            {activeTab === "fatiga" && <FatigaTab branchId={effectiveBranch} />}
            {activeTab === "sla" && <SlaTab branchId={effectiveBranch} />}
            {activeTab === "empleado-mes" && <EmpleadoMesTab branchId={effectiveBranch} />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-11 px-4 flex items-center gap-2 text-sm border-b-2 transition-all duration-200 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/50 focus-visible:ring-inset rounded-t-md ${
        active
          ? "border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-semibold bg-blue-50/50 dark:bg-blue-900/20"
          : "border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-gray-600 hover:bg-slate-50/60 dark:hover:bg-gray-700/40 font-medium"
      }`}
    >
      {children}
    </button>
  );
}
