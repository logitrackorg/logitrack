import { useSearchParams } from "react-router-dom";
import { RoutingConfig } from "./RoutingConfig";
import { BranchGraphAdmin } from "./BranchGraphAdmin";

// AdminRoutingHub agrupa configuración de ruteo + grafo de sucursales en tabs.
// Tab activo en URL (?tab=config|graph) — bookmarkable.
export function AdminRoutingHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "config";

  const setTab = (t: string) => setSearchParams({ tab: t });

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 pt-5 pb-0">
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-3 flex gap-0">
          <TabButton active={tab === "config"} onClick={() => setTab("config")}>
            Parámetros
          </TabButton>
          <TabButton active={tab === "graph"} onClick={() => setTab("graph")}>
            Grafo de sucursales
          </TabButton>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {tab === "config" && <RoutingConfig />}
        {tab === "graph" && <BranchGraphAdmin embedded />}
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
