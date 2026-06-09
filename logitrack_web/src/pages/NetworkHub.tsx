import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NetworkPlanView } from "./NetworkPlanView";
import { RollingPlanView } from "./RollingPlanView";
import { RoutingMetrics } from "./RoutingMetrics";

// NetworkHub consolida las 3 vistas de gestión cross-branch en una pantalla
// con tabs. Tab activo en URL (?tab=today|rolling|metrics) — bookmarkable.
export function NetworkHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasRole } = useAuth();
  const tab = searchParams.get("tab") || "today";

  const setTab = (t: string) => setSearchParams({ tab: t });


  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header + tab bar (sticky) */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 pt-5 pb-0">
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-3 flex gap-0">
          <TabButton active={tab === "today"} onClick={() => setTab("today")}>
            Hoy
          </TabButton>
          <TabButton active={tab === "rolling"} onClick={() => setTab("rolling")}>
            Próximos días
          </TabButton>
          {hasRole("admin") && (
            <TabButton active={tab === "metrics"} onClick={() => setTab("metrics")}>
              Métricas históricas
            </TabButton>
          )}
        </div>
      </div>

      {/* Contenido del tab activo (embedded — sin header propio) */}
      <div className="max-w-7xl mx-auto p-6">
        {tab === "today" && <NetworkPlanView embedded />}
        {tab === "rolling" && <RollingPlanView embedded />}
        {tab === "metrics" && hasRole("admin") && <RoutingMetrics embedded />}
        {tab === "metrics" && !hasRole("admin") && (
          <div className="text-sm text-slate-600">Las métricas históricas son admin-only.</div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-11 px-5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-[var(--brand)] text-[var(--brand)]"
          : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
      }`}
    >
      {children}
    </button>
  );
}
