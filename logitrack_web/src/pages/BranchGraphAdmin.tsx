import { useEffect, useState } from "react";
import { GitBranch, RefreshCw, AlertCircle, CheckCircle2, Eye, EyeOff, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { branchGraphApi, type BranchEdge } from "../api/branchGraph";
import { branchApi, type Branch } from "../api/branches";

function branchLabel(id: string, branches: Branch[]): string {
  return branches.find((b) => b.id === id)?.name ?? id;
}

function fmtHours(h: number): string {
  if (h < 1) return `${(h * 60).toFixed(0)} min`;
  return `${h.toFixed(1)} h`;
}

export function BranchGraphAdmin({ embedded = false }: { embedded?: boolean } = {}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [edges, setEdges] = useState<BranchEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showNewEdge, setShowNewEdge] = useState(false);
  const [newEdge, setNewEdge] = useState({ from: "", to: "", distance: "", transit: "" });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [g, b] = await Promise.all([branchGraphApi.getGraph(), branchApi.listActive()]);
      setEdges(g.edges);
      setBranches(b);
    } catch {
      setError("No se pudo cargar el grafo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleDerive = async () => {
    setDeriving(true);
    setError("");
    setSuccess("");
    try {
      const resp = await branchGraphApi.derive();
      setSuccess(`Auto-derive completado: ${resp.edges_processed} aristas procesadas.`);
      await load();
    } catch {
      setError("Error al derivar el grafo.");
    } finally {
      setDeriving(false);
    }
  };

  const handleCreateEdge = async () => {
    if (!newEdge.from || !newEdge.to || newEdge.from === newEdge.to) {
      setError("Elegí sucursales de origen y destino distintas.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      await branchGraphApi.create({
        from_branch_id: newEdge.from,
        to_branch_id: newEdge.to,
        distance_km: newEdge.distance ? parseFloat(newEdge.distance) : 0,
        avg_transit_hours: newEdge.transit ? parseFloat(newEdge.transit) : 0,
      });
      setSuccess("Arista creada.");
      setNewEdge({ from: "", to: "", distance: "", transit: "" });
      setShowNewEdge(false);
      await load();
    } catch {
      setError("Error al crear la arista.");
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (edge: BranchEdge) => {
    try {
      await branchGraphApi.setEnabled(edge.from_branch_id, edge.to_branch_id, !edge.enabled);
      setEdges((prev) =>
        prev.map((e) =>
          e.from_branch_id === edge.from_branch_id && e.to_branch_id === edge.to_branch_id
            ? { ...e, enabled: !e.enabled }
            : e,
        ),
      );
    } catch {
      setError("Error al cambiar estado de la arista.");
    }
  };

  const body = (<>
        {/* Acciones */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => void load()}
                disabled={loading}
                className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Recargar
              </button>
              <button
                onClick={() => void handleDerive()}
                disabled={deriving}
                className="h-10 px-4 rounded-lg bg-[#2563eb] text-white text-sm font-medium hover:bg-[#1d4ed8] flex items-center gap-2 disabled:opacity-50"
              >
                <GitBranch className={`h-4 w-4 ${deriving ? "animate-pulse" : ""}`} />
                {deriving ? "Derivando…" : "Auto-derive ahora"}
              </button>
              <button
                onClick={() => setShowNewEdge(!showNewEdge)}
                className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Nueva arista manual
              </button>
              <span className="text-xs text-slate-500">
                El auto-derive también corre a las 02:00 ART junto con el backfill de métricas.
              </span>
            </div>

            {showNewEdge && (
              <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Desde</label>
                  <select
                    value={newEdge.from}
                    onChange={(e) => setNewEdge((n) => ({ ...n, from: e.target.value }))}
                    className="h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm min-w-[160px]"
                  >
                    <option value="">Seleccionar…</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Hasta</label>
                  <select
                    value={newEdge.to}
                    onChange={(e) => setNewEdge((n) => ({ ...n, to: e.target.value }))}
                    className="h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm min-w-[160px]"
                  >
                    <option value="">Seleccionar…</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Distancia (km)</label>
                  <input
                    type="number" min="0" step="1" placeholder="auto"
                    value={newEdge.distance}
                    onChange={(e) => setNewEdge((n) => ({ ...n, distance: e.target.value }))}
                    className="h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm w-24 tabular-nums"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-600">Tránsito prom. (hs)</label>
                  <input
                    type="number" min="0" step="0.5" placeholder="ej. 8"
                    value={newEdge.transit}
                    onChange={(e) => setNewEdge((n) => ({ ...n, transit: e.target.value }))}
                    className="h-9 px-2 rounded-lg border border-slate-200 bg-white text-sm w-24 tabular-nums"
                  />
                </div>
                <button
                  onClick={() => void handleCreateEdge()}
                  disabled={creating}
                  className="h-9 px-4 rounded-lg bg-[#2563eb] text-white text-sm font-medium hover:bg-[#1d4ed8] disabled:opacity-50"
                >
                  {creating ? "Creando…" : "Crear"}
                </button>
                <button
                  onClick={() => setShowNewEdge(false)}
                  className="h-9 px-4 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <span className="text-sm">{success}</span>
          </div>
        )}

        {/* Tabla */}
        <Card>
          <CardHeader>
            <CardTitle>Aristas ({edges.length})</CardTitle>
            <CardDescription>
              Una arista por par (origen → destino). Deshabilitá una arista para excluirla del
              algoritmo de shortest-path sin borrar el historial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {edges.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm">
                {loading
                  ? "Cargando…"
                  : "Sin aristas. Cargá datos de tránsito y ejecutá Auto-derive."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                      <th className="text-left py-2 px-3 font-medium">Desde</th>
                      <th className="text-left py-2 px-3 font-medium">Hasta</th>
                      <th className="text-right py-2 px-3 font-medium">Distancia</th>
                      <th className="text-right py-2 px-3 font-medium">Tránsito prom.</th>
                      <th className="text-right py-2 px-3 font-medium">Usos</th>
                      <th className="text-center py-2 px-3 font-medium">Fuente</th>
                      <th className="text-center py-2 px-3 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {edges.map((e) => (
                      <tr
                        key={`${e.from_branch_id}-${e.to_branch_id}`}
                        className={`border-b border-slate-100 hover:bg-slate-50 ${!e.enabled ? "opacity-50" : ""}`}
                      >
                        <td className="py-2 px-3 font-medium">{branchLabel(e.from_branch_id, branches)}</td>
                        <td className="py-2 px-3">{branchLabel(e.to_branch_id, branches)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {e.distance_km > 0 ? `${e.distance_km.toFixed(0)} km` : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {e.avg_transit_hours > 0 ? fmtHours(e.avg_transit_hours) : "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{e.observed_count}</td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              e.source === "manual"
                                ? "bg-violet-100 text-violet-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {e.source === "manual" ? "Manual" : "Auto"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => void handleToggle(e)}
                            title={e.enabled ? "Deshabilitar" : "Habilitar"}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-slate-100 transition-colors"
                          >
                            {e.enabled ? (
                              <Eye className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <EyeOff className="h-4 w-4 text-slate-400" />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
  </>);

  if (embedded) {
    return <div className="max-w-5xl mx-auto space-y-6">{body}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">{body}</div>
    </div>
  );
}
