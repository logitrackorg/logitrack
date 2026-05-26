import { useState, useEffect, useCallback, Suspense, lazy, useRef } from "react";
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
} from "lucide-react";
import { branchApi, type Branch } from "../api/branches";
import { useAuth } from "../context/AuthContext";
import { ReportFilters } from "../components/ReportFilters";
import { PageHeader } from "../components/ui/page-header";
import { defaultRange, Skeleton } from "../utils/dashboard";
import type { ResumenTabRef } from "./reports/ResumenTab";

const ResumenTab = lazy(() => import("./reports/ResumenTab"));
const ChoferesTab = lazy(() => import("./reports/ChoferesTab"));
const ReclamosTab = lazy(() => import("./reports/ReclamosTab"));
const FacturacionTab = lazy(() => import("./reports/FacturacionTab"));
const RankingTab = lazy(() => import("./reports/RankingTab"));
const VolumenTab = lazy(() => import("./reports/VolumenTab"));
const TipoEnvioTab = lazy(() => import("./reports/TipoEnvioTab"));
const MetodoEntregaTab = lazy(() => import("./reports/MetodoEntregaTab"));
const RetornoTab = lazy(() => import("./reports/RetornoTab"));
const ExitoTab = lazy(() => import("./reports/ExitoTab"));
const FatigaTab = lazy(() => import("./reports/FatigaTab"));

const tabs = [
  { id: "resumen", label: "Resumen", icon: LayoutDashboard },
  { id: "choferes", label: "Choferes", icon: Users },
  { id: "reclamos", label: "Reclamos", icon: AlertTriangle },
  { id: "facturacion", label: "Facturación", icon: DollarSign },
  { id: "ranking", label: "Ranking", icon: BarChart3 },
  { id: "volumen", label: "Vol. por Ventana", icon: Clock },
  { id: "tipo-envio", label: "Tipo de Envío", icon: Zap },
  { id: "metodo-entrega", label: "Método de Entrega", icon: Truck },
  { id: "retorno", label: "Retorno", icon: Undo2 },
  { id: "exito", label: "Tasa de Éxito", icon: TrendingUp },
  { id: "fatiga", label: "Fatiga", icon: Activity },
];

const VALID_TABS = new Set(tabs.map((t) => t.id));

export function DashboardHost() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, hasRole } = useAuth();

  const rawTab = searchParams.get("tab") || "resumen";
  const activeTab = VALID_TABS.has(rawTab) ? rawTab : "resumen";

  const setTab = (t: string) => setSearchParams({ tab: t });

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

  const sharedProps = {
    dateFrom,
    dateTo,
    branchId: effectiveBranch,
    branches,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header + tab bar (sticky) */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-3 flex gap-0 overflow-x-auto scroll-smooth scrollbar-hide">
          {tabs.map((t) => {
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
      </div>

      {/* Contenido del tab activo */}
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div key={activeTab} className="animate-fade-in">
          <Suspense fallback={<Skeleton className="h-96" />}>
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
      className={`h-11 px-4 flex items-center gap-2 text-sm border-b-2 transition-all duration-200 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/50 focus-visible:ring-inset rounded-t-md ${
        active
          ? "border-[#2563eb] text-[#2563eb] font-semibold bg-blue-50/50"
          : "border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50/60 font-medium"
      }`}
    >
      {children}
    </button>
  );
}
