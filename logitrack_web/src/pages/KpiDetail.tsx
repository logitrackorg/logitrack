import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { shipmentApi } from "../api/shipments";
import { branchApi, type Branch } from "../api/branches";
import { Breadcrumb } from "../components/Breadcrumb";
import { Card } from "../components/ui/card";
import { PageHeader } from "../components/ui/page-header";

const statusLabels: Record<string, string> = {
  delivered: "Entregados",
  issues: "Problemas",
  draft: "Borradores",
  at_origin_hub: "En sucursal de origen",
  loaded: "Cargado en vehículo",
  in_transit: "En tránsito",
  at_hub: "En sucursal",
  out_for_delivery: "Última milla",
  delivery_failed: "Entrega fallida",
  redelivery_scheduled: "Reentrega programada",
  no_entregado: "No entregados",
  rechazado: "Rechazados",
  ready_for_pickup: "Listos para retiro",
  ready_for_return: "Listos para devolución",
  returned: "Devueltos",
  cancelled: "Cancelados",
  lost: "Extraviados",
  destroyed: "Daño total",
  expired: "Borrador expirado",
  pending_payment: "Pago pendiente",
};

const issueStatuses = ["delivery_failed", "lost", "destroyed"];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse dark:bg-gray-700 bg-slate-200 rounded-lg ${className ?? ""}`} />;
}

export function KpiDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const kpi = searchParams.get("kpi") ?? "";
  const dateFrom = searchParams.get("date_from") ?? "";
  const dateTo = searchParams.get("date_to") ?? "";

  const [data, setData] = useState<Record<string, number> | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const label = statusLabels[kpi] ?? kpi;

  useEffect(() => {
    branchApi.list("activo").then(setBranches);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    const params: { status?: string; date_from?: string; date_to?: string } = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    if (kpi === "issues") {
      // Fetch each issue status and merge
      Promise.all(
        issueStatuses.map((s) =>
          shipmentApi.statsDetail({ ...params, status: s }).catch(() => ({} as Record<string, number>))
        )
      ).then((results) => {
        const merged: Record<string, number> = {};
        for (const result of results) {
          for (const [branchID, count] of Object.entries(result)) {
            merged[branchID] = (merged[branchID] ?? 0) + count;
          }
        }
        setData(merged);
        setLoading(false);
      }).catch(() => {
        setError(true);
        setLoading(false);
      });
    } else if (kpi) {
      params.status = kpi;
      shipmentApi.statsDetail(params).then((d) => {
        setData(d);
        setLoading(false);
      }).catch(() => {
        setError(true);
        setLoading(false);
      });
    } else {
      shipmentApi.statsDetail(params).then((d) => {
        setData(d);
        setLoading(false);
      }).catch(() => {
        setError(true);
        setLoading(false);
      });
    }
  }, [kpi, dateFrom, dateTo]);

  const branchMap = new Map(branches.map((b) => [b.id, b]));
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <Breadcrumb
        items={[
          { label: "Dashboard", to: "/dashboard" },
          { label },
        ]}
      />

      <PageHeader
        title={label}
        description={`Desglose por sucursal${dateFrom ? ` — ${dateFrom} al ${dateTo}` : ""}`}
        icon={<ArrowLeft className="w-5 h-5 cursor-pointer" onClick={() => navigate("/dashboard")} />}
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-48" />
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-red-600">No se pudieron cargar los datos. Intentá de nuevo más tarde.</p>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-sm dark:text-gray-400 text-slate-500">No hay datos para el período seleccionado.</p>
        </Card>
      ) : (
        <>
          <div className="mb-4 text-sm dark:text-gray-400 text-slate-600">
            Total: <strong className="dark:text-gray-100 text-slate-900">{total}</strong> envíos
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="dark:bg-gray-800/50 bg-slate-50/30 text-left border-b dark:border-gray-700 border-slate-100">
                    <th className="px-5 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Sucursal</th>
                    <th className="px-5 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider">Cantidad</th>
                    <th className="px-5 py-3 text-xs font-semibold dark:text-gray-400 text-slate-600 uppercase tracking-wider" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([branchID, count]) => {
                    const branch = branchMap.get(branchID);
                    const branchName = branch ? `${branch.name} — ${branch.address.city}` : branchID;
                    const statusQuery = kpi === "issues" ? issueStatuses.join(",") : kpi;
                    return (
                      <tr
                        key={branchID}
                        onClick={() => navigate(`/?status=${statusQuery}&branch_id=${branchID}`)}
                        className="border-b dark:border-gray-700 border-slate-100 cursor-pointer dark:hover:bg-gray-700 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-5 py-3 dark:text-gray-300 text-slate-700 font-medium">{branchName}</td>
                        <td className="px-5 py-3 dark:text-gray-100 text-slate-900 font-semibold">{count}</td>
                        <td className="px-5 py-3 text-right">
                          <span className="text-xs text-blue-600 font-semibold">Ver envíos →</span>
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
  );
}
