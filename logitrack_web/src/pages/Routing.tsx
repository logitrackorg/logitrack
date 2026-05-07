import { useEffect, useMemo, useState } from "react";
import { Route as RouteIcon, AlertCircle, CheckCircle2, RefreshCw, Truck, User as UserIcon, AlertTriangle, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { branchApi, branchLabelById, type Branch } from "../api/branches";
import { usersApi, type UserProfile } from "../api/users";
import { shipmentApi, type Shipment } from "../api/shipments";
import {
  routingApi,
  reasonLabel,
  DISPATCH_RULE_LABELS,
  type RoutingPlan,
  type LastMileAssignment,
  type InterBranchAssignment,
  type UnassignedShipment,
  type ApplyPlanResponse,
} from "../api/routing";
import { PriorityBadge } from "../components/PriorityBadge";

type Source =
  | { kind: "driver"; id: string }
  | { kind: "vehicle"; id: string }
  | { kind: "unassigned" };

const MANUAL_UNASSIGNED_REASON = "movido_por_operador";

// Un envío califica para última milla si está en su sucursal final, va a entrega a domicilio
// y no es una devolución. Returns SIEMPRE viajan en vehículo de regreso al origen.
function isLastMileShipment(sh: Shipment | undefined, branchId: string): boolean {
  if (!sh) return false;
  if (sh.is_returning) return false;
  return sh.final_branch_id === branchId && sh.delivery_method === "ultima_milla";
}

function clonePlan(p: RoutingPlan): RoutingPlan {
  return JSON.parse(JSON.stringify(p)) as RoutingPlan;
}

function recomputeWeights(plan: RoutingPlan, shipments: Map<string, Shipment>): RoutingPlan {
  const out = clonePlan(plan);
  out.last_mile.forEach((a) => {
    a.total_weight_kg = a.shipments.reduce((sum, tid) => sum + (shipments.get(tid)?.weight_kg ?? 0), 0);
  });
  out.inter_branch.forEach((a) => {
    a.total_weight_kg = a.shipments.reduce((sum, tid) => sum + (shipments.get(tid)?.weight_kg ?? 0), 0);
  });
  return out;
}

function findSource(plan: RoutingPlan, trackingId: string): Source | null {
  for (const a of plan.last_mile) {
    if (a.shipments.includes(trackingId)) return { kind: "driver", id: a.driver_id };
  }
  for (const a of plan.inter_branch) {
    if (a.shipments.includes(trackingId)) return { kind: "vehicle", id: a.vehicle_id };
  }
  if (plan.unassigned.some((u) => u.tracking_id === trackingId)) return { kind: "unassigned" };
  return null;
}

function removeFromSource(plan: RoutingPlan, src: Source, trackingId: string): RoutingPlan {
  const out = clonePlan(plan);
  if (src.kind === "driver") {
    out.last_mile = out.last_mile.map((a) =>
      a.driver_id === src.id ? { ...a, shipments: a.shipments.filter((t) => t !== trackingId) } : a,
    ).filter((a) => a.shipments.length > 0);
  } else if (src.kind === "vehicle") {
    out.inter_branch = out.inter_branch.map((a) =>
      a.vehicle_id === src.id ? { ...a, shipments: a.shipments.filter((t) => t !== trackingId) } : a,
    ).filter((a) => a.shipments.length > 0);
  } else {
    out.unassigned = out.unassigned.filter((u) => u.tracking_id !== trackingId);
  }
  return out;
}

interface ValidationError {
  field: string;
  message: string;
}

function driverTotals(plan: RoutingPlan, driverId: string): { count: number; weight: number } {
  const asg = plan.last_mile.find((a) => a.driver_id === driverId);
  const newCount = asg?.shipments.length ?? 0;
  const newWeight = asg?.total_weight_kg ?? 0;
  // existing_count/weight viven en la asignación si el chofer está en LastMile;
  // si no, los buscamos en driver_loads (chofer libre, sin envíos nuevos).
  let existingCount = asg?.existing_count;
  let existingWeight = asg?.existing_weight_kg;
  if (existingCount === undefined || existingWeight === undefined) {
    const load = plan.driver_loads.find((l) => l.driver_id === driverId);
    existingCount = existingCount ?? load?.existing_count ?? 0;
    existingWeight = existingWeight ?? load?.existing_weight_kg ?? 0;
  }
  return { count: newCount + existingCount, weight: newWeight + existingWeight };
}

function vehicleTotals(plan: RoutingPlan, vehicleId: string): { weight: number; capacity: number } | null {
  const asg = plan.inter_branch.find((a) => a.vehicle_id === vehicleId);
  if (asg) {
    return { weight: asg.total_weight_kg + asg.existing_weight_kg, capacity: asg.capacity_kg };
  }
  const load = plan.vehicle_loads.find((l) => l.vehicle_id === vehicleId);
  if (load) {
    return { weight: load.existing_weight_kg, capacity: load.capacity_kg };
  }
  return null;
}

function validateMoveToDriver(
  plan: RoutingPlan,
  driverId: string,
  shipment: Shipment,
): ValidationError | null {
  if (plan.blocked_drivers.some((b) => b.driver_id === driverId)) {
    return { field: "driver", message: "El chofer ya inició su ruta del día — no se le pueden asignar más envíos." };
  }
  const cfg = plan.config_snapshot;
  const totals = driverTotals(plan, driverId);
  if (totals.count + 1 > cfg.max_shipments_per_driver) {
    return { field: "count", message: `El chofer ya tiene ${totals.count} envíos (máx. ${cfg.max_shipments_per_driver}).` };
  }
  if (totals.weight + shipment.weight_kg > cfg.max_weight_kg_per_driver) {
    return {
      field: "weight",
      message: `Excede el peso máximo del chofer (${totals.weight.toFixed(1)} + ${shipment.weight_kg.toFixed(1)} > ${cfg.max_weight_kg_per_driver} kg).`,
    };
  }
  return null;
}

function validateMoveToVehicle(
  plan: RoutingPlan,
  vehicleId: string,
  shipment: Shipment,
): ValidationError | null {
  const totals = vehicleTotals(plan, vehicleId);
  if (!totals) return { field: "vehicle", message: "Vehículo no encontrado en el plan." };
  if (totals.weight + shipment.weight_kg > totals.capacity) {
    return {
      field: "weight",
      message: `Excede capacidad del vehículo (${totals.weight.toFixed(1)} + ${shipment.weight_kg.toFixed(1)} > ${totals.capacity} kg).`,
    };
  }
  // Nota: cuando final_branch_id !== destination_branch se permite (piggyback / tránsito parcial).
  return null;
}

export function Routing() {
  const { user } = useAuth();
  const branchId = user?.branch_id ?? "";

  const [plan, setPlan] = useState<RoutingPlan | null>(null);
  const [originalPlan, setOriginalPlan] = useState<RoutingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [shipments, setShipments] = useState<Map<string, Shipment>>(new Map());
  const [reassignFor, setReassignFor] = useState<{ trackingId: string; source: Source } | null>(null);
  const [reassignError, setReassignError] = useState("");
  const [applyResult, setApplyResult] = useState<ApplyPlanResponse | null>(null);

  // Data inicial: branches, drivers, vehicles
  useEffect(() => {
    branchApi.list("activo").then(setBranches).catch(() => {});
    if (branchId) {
      usersApi.listDrivers(branchId).then(setDrivers).catch(() => {});
    }
  }, [branchId]);

  const handleGenerate = async () => {
    if (!branchId) {
      setError("Tu usuario no tiene una sucursal asignada.");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const raw = await routingApi.generate(branchId);
      // El backend puede devolver null en arrays vacíos — normalizamos para evitar errores
      const newPlan: RoutingPlan = {
        ...raw,
        last_mile: raw.last_mile ?? [],
        inter_branch: raw.inter_branch ?? [],
        unassigned: raw.unassigned ?? [],
        blocked_drivers: raw.blocked_drivers ?? [],
        driver_loads: raw.driver_loads ?? [],
        vehicle_loads: raw.vehicle_loads ?? [],
      };
      const allTids = new Set<string>();
      newPlan.last_mile.forEach((a) => a.shipments.forEach((t) => allTids.add(t)));
      newPlan.inter_branch.forEach((a) => a.shipments.forEach((t) => allTids.add(t)));
      newPlan.unassigned.forEach((u) => allTids.add(u.tracking_id));
      // Hidratar cache de envíos para mostrar peso/prioridad/SLA
      const shipMap = new Map<string, Shipment>();
      const all = await shipmentApi.list({ branch_id: branchId });
      all.forEach((s) => {
        if (allTids.has(s.tracking_id)) shipMap.set(s.tracking_id, s);
      });
      setShipments(shipMap);
      setPlan(newPlan);
      setOriginalPlan(clonePlan(newPlan));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo generar el plan.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscard = () => {
    if (originalPlan) setPlan(clonePlan(originalPlan));
  };

  const handleApply = async () => {
    if (!plan || !branchId) return;
    setApplying(true);
    setError("");
    try {
      const resp = await routingApi.apply(branchId, plan);
      setApplyResult(resp);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo aplicar el plan.";
      setError(msg);
    } finally {
      setApplying(false);
    }
  };

  const closeApplyResult = () => {
    setApplyResult(null);
    setSuccess("Plan aplicado. Regenerando…");
    setTimeout(() => setSuccess(""), 2500);
    handleGenerate();
  };

  const openReassign = (trackingId: string) => {
    if (!plan) return;
    const src = findSource(plan, trackingId);
    if (!src) return;
    setReassignError("");
    setReassignFor({ trackingId, source: src });
  };

  const closeReassign = () => {
    setReassignFor(null);
    setReassignError("");
  };

  const moveTo = (target: { kind: "driver"; id: string } | { kind: "vehicle"; id: string } | { kind: "unassigned" }) => {
    if (!plan || !reassignFor) return;
    const sh = shipments.get(reassignFor.trackingId);
    if (!sh) {
      setReassignError("Información del envío no disponible.");
      return;
    }
    // Restricción de tipo: última milla solo a choferes; inter-sucursal solo a vehículos.
    const lastMile = isLastMileShipment(sh, branchId);
    if (target.kind === "driver" && !lastMile) {
      setReassignError("Este envío necesita transporte a otra sucursal — no se puede asignar a un chofer de última milla.");
      return;
    }
    if (target.kind === "vehicle" && lastMile) {
      setReassignError("Este envío ya está en su sucursal final — corresponde asignarlo a un chofer, no a un vehículo inter-sucursal.");
      return;
    }
    // Validación de capacidad
    let validation: ValidationError | null = null;
    if (target.kind === "driver") validation = validateMoveToDriver(plan, target.id, sh);
    else if (target.kind === "vehicle") validation = validateMoveToVehicle(plan, target.id, sh);
    if (validation) {
      setReassignError(validation.message);
      return;
    }

    // Mutar el plan
    let next = removeFromSource(plan, reassignFor.source, reassignFor.trackingId);

    if (target.kind === "driver") {
      const driver = drivers.find((d) => d.id === target.id);
      const existing = next.last_mile.find((a) => a.driver_id === target.id);
      if (existing) {
        existing.shipments.push(reassignFor.trackingId);
      } else {
        next.last_mile.push({
          driver_id: target.id,
          driver_name: driver?.full_name ?? target.id,
          shipments: [reassignFor.trackingId],
          total_weight_kg: 0,
        } as LastMileAssignment);
      }
    } else if (target.kind === "vehicle") {
      const existing = next.inter_branch.find((a) => a.vehicle_id === target.id);
      if (existing) {
        existing.shipments.push(reassignFor.trackingId);
      }
    } else {
      next.unassigned.push({
        tracking_id: reassignFor.trackingId,
        destination: sh.final_branch_id ?? "",
        reason: MANUAL_UNASSIGNED_REASON,
        weight_kg: sh.weight_kg,
        priority: sh.priority ?? "",
      } as UnassignedShipment);
    }

    next = recomputeWeights(next, shipments);
    setPlan(next);
    closeReassign();
  };

  const isDirty = useMemo(() => {
    if (!plan || !originalPlan) return false;
    return JSON.stringify(plan) !== JSON.stringify(originalPlan);
  }, [plan, originalPlan]);

  const totals = useMemo(() => {
    if (!plan) return null;
    const lastMileCount = plan.last_mile.reduce((n, a) => n + a.shipments.length, 0);
    const interBranchCount = plan.inter_branch.reduce((n, a) => n + a.shipments.length, 0);
    return {
      assignable: lastMileCount + interBranchCount,
      unassigned: plan.unassigned.length,
      dispatches: plan.inter_branch.length,
      drivers: plan.last_mile.length,
    };
  }, [plan]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Ruteo del día"
        description={`Plan sugerido para ${branches.find((b) => b.id === branchId)?.name ?? "tu sucursal"}. Revisalo, ajustá lo necesario y aplicá.`}
        icon={<RouteIcon className="w-5 h-5" />}
        actions={
          plan ? (
            <div className="flex gap-2">
              {isDirty && (
                <button
                  onClick={handleDiscard}
                  disabled={applying}
                  className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
                >
                  Descartar cambios
                </button>
              )}
              <button
                onClick={handleGenerate}
                disabled={loading || applying}
                className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                Regenerar
              </button>
              <button
                onClick={handleApply}
                disabled={applying || loading}
                className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
              >
                {applying ? "Aplicando…" : "Aplicar plan"}
              </button>
            </div>
          ) : null
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {success}
        </div>
      )}

      {!plan && !loading && (
        <Card className="p-10 text-center">
          <RouteIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-4">
            No hay plan generado todavía. Tocá <strong>Generar plan</strong> para que el sistema sugiera asignaciones para los envíos pendientes en tu sucursal.
          </p>
          <button
            onClick={handleGenerate}
            disabled={!branchId}
            className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
          >
            Generar plan
          </button>
        </Card>
      )}

      {loading && !plan && (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Calculando plan…</p>
        </Card>
      )}

      {plan && totals && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <SummaryChip label="Asignables" value={totals.assignable} />
            <SummaryChip label="Sin asignar" value={totals.unassigned} tone={totals.unassigned > 0 ? "warning" : "neutral"} />
            <SummaryChip label="Despachos" value={totals.dispatches} />
            <SummaryChip label="Choferes" value={totals.drivers} />
          </div>

          {plan.unassigned.length > 0 && (
            <UnassignedSection unassigned={plan.unassigned} branches={branches} shipments={shipments} onReassign={openReassign} />
          )}

          {plan.last_mile.length > 0 && (
            <LastMileSection
              assignments={plan.last_mile}
              drivers={drivers}
              shipments={shipments}
              onReassign={openReassign}
            />
          )}

          {plan.inter_branch.length > 0 && (
            <InterBranchSection
              assignments={plan.inter_branch}
              branches={branches}
              shipments={shipments}
              onReassign={openReassign}
            />
          )}

          {plan.last_mile.length === 0 && plan.inter_branch.length === 0 && plan.unassigned.length === 0 && (
            <Card className="p-10 text-center">
              <p className="text-sm text-slate-500">No hay envíos para rutear desde esta sucursal en este momento.</p>
            </Card>
          )}
        </>
      )}

      {reassignFor && plan && (
        <ReassignModal
          plan={plan}
          drivers={drivers}
          branches={branches}
          shipment={shipments.get(reassignFor.trackingId)}
          source={reassignFor.source}
          error={reassignError}
          onClose={closeReassign}
          onMove={moveTo}
        />
      )}

      {applyResult && (
        <ApplyResultModal result={applyResult} onClose={closeApplyResult} />
      )}
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function SummaryChip({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "warning" }) {
  const palette =
    tone === "warning"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-white border-slate-200 text-slate-800";
  return (
    <div className={`rounded-lg border px-4 py-3 ${palette}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function ShipmentChip({
  trackingId,
  shipment,
  onReassign,
  extra,
}: {
  trackingId: string;
  shipment: Shipment | undefined;
  onReassign: (trackingId: string) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50">
      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
        <span className="font-mono text-xs text-slate-700 shrink-0">{trackingId}</span>
        {shipment && (
          <>
            <span className="text-xs text-slate-500 tabular-nums shrink-0">{shipment.weight_kg.toFixed(1)} kg</span>
            {shipment.priority && <PriorityBadge priority={shipment.priority} />}
            {shipment.is_fragile && <span className="text-xs px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Frágil</span>}
            {shipment.shipment_type === "express" && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Express</span>
            )}
            {shipment.is_returning && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
                Devolución a remitente
              </span>
            )}
          </>
        )}
        {extra}
      </div>
      <button
        onClick={() => onReassign(trackingId)}
        className="text-xs font-semibold text-[#2563eb] hover:text-[#1d4ed8] cursor-pointer shrink-0"
      >
        Reasignar
      </button>
    </div>
  );
}

function UnassignedSection({
  unassigned,
  branches,
  shipments,
  onReassign,
}: {
  unassigned: UnassignedShipment[];
  branches: Branch[];
  shipments: Map<string, Shipment>;
  onReassign: (trackingId: string) => void;
}) {
  const groupedByReason = useMemo(() => {
    const m = new Map<string, UnassignedShipment[]>();
    unassigned.forEach((u) => {
      const arr = m.get(u.reason) ?? [];
      arr.push(u);
      m.set(u.reason, arr);
    });
    return Array.from(m.entries());
  }, [unassigned]);

  return (
    <Card className="mb-5 border-amber-200">
      <CardHeader className="bg-amber-50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <CardTitle className="text-amber-900">Sin asignar ({unassigned.length})</CardTitle>
        </div>
        <CardDescription>
          El algoritmo no pudo asignar estos envíos. Revisá el motivo y reasignalos manualmente si corresponde.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-3">
        {groupedByReason.map(([reason, items]) => (
          <div key={reason}>
            <div className="text-xs font-semibold text-slate-700 mb-2">{reasonLabel(reason)}</div>
            <div className="grid gap-2">
              {items.map((u) => (
                <ShipmentChip
                  key={u.tracking_id}
                  trackingId={u.tracking_id}
                  shipment={shipments.get(u.tracking_id)}
                  onReassign={onReassign}
                  extra={
                    <span className="text-xs text-slate-500 truncate">
                      → {u.destination ? branchLabelById(u.destination, branches) : "(última milla)"}
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function LastMileSection({
  assignments,
  drivers,
  shipments,
  onReassign,
}: {
  assignments: LastMileAssignment[];
  drivers: UserProfile[];
  shipments: Map<string, Shipment>;
  onReassign: (trackingId: string) => void;
}) {
  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserIcon className="w-4 h-4 text-slate-700" />
          <CardTitle>Última milla</CardTitle>
        </div>
        <CardDescription>Envíos asignados a choferes para entrega del día.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {assignments.map((a) => {
          const driver = drivers.find((d) => d.id === a.driver_id);
          const totalCount = a.shipments.length + a.existing_count;
          const totalWeight = a.total_weight_kg + a.existing_weight_kg;
          return (
            <div key={a.driver_id} className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-slate-900 text-sm">
                  {driver?.full_name ?? a.driver_name ?? a.driver_id}
                </div>
                <div className="text-xs text-slate-500 tabular-nums text-right">
                  <div>{totalCount} envíos · {totalWeight.toFixed(1)} kg</div>
                  {a.existing_count > 0 && (
                    <div className="text-[11px] text-slate-400">
                      {a.shipments.length} nuevos + {a.existing_count} en ruta ({a.existing_weight_kg.toFixed(1)} kg)
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-2">
                {a.shipments.map((tid) => (
                  <ShipmentChip key={tid} trackingId={tid} shipment={shipments.get(tid)} onReassign={onReassign} />
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function InterBranchSection({
  assignments,
  branches,
  shipments,
  onReassign,
}: {
  assignments: InterBranchAssignment[];
  branches: Branch[];
  shipments: Map<string, Shipment>;
  onReassign: (trackingId: string) => void;
}) {
  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-slate-700" />
          <CardTitle>Despachos a otras sucursales</CardTitle>
        </div>
        <CardDescription>
          Cada despacho prepara un vehículo con destino seteado. El viaje se inicia manualmente desde Flota cuando el vehículo esté listo.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {assignments.map((a) => {
          const totalLoaded = a.total_weight_kg + a.existing_weight_kg;
          const utilPct = a.capacity_kg > 0 ? Math.round((totalLoaded / a.capacity_kg) * 100) : 0;
          return (
            <div key={a.vehicle_id} className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-slate-900 text-sm">
                  {a.license_plate} → {branchLabelById(a.destination_branch, branches)}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.rule === "sla_forced" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>
                  {DISPATCH_RULE_LABELS[a.rule]}
                </span>
              </div>
              <div className="text-xs text-slate-500 tabular-nums mb-2">
                {a.shipments.length} envíos · {totalLoaded.toFixed(1)} / {a.capacity_kg} kg ({utilPct}%)
                {a.existing_weight_kg > 0 && (
                  <span className="ml-1 text-[11px] text-slate-400">
                    (incluye {a.existing_weight_kg.toFixed(1)} kg ya cargados)
                  </span>
                )}
              </div>
              <div className="grid gap-2">
                {a.shipments.map((tid) => {
                  const sh = shipments.get(tid);
                  // Para envíos en retorno, el destino real es el origen; para el resto, el final.
                  const realTarget = sh?.is_returning ? sh?.origin_branch_id : sh?.final_branch_id;
                  const isPartialTransit = !!realTarget && realTarget !== a.destination_branch;
                  return (
                    <ShipmentChip
                      key={tid}
                      trackingId={tid}
                      shipment={sh}
                      onReassign={onReassign}
                      extra={
                        isPartialTransit && realTarget ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 truncate">
                            Tránsito parcial → {branchLabelById(realTarget, branches)}
                          </span>
                        ) : null
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ReassignModal({
  plan,
  drivers,
  branches,
  shipment,
  source,
  error,
  onClose,
  onMove,
}: {
  plan: RoutingPlan;
  drivers: UserProfile[];
  branches: Branch[];
  shipment: Shipment | undefined;
  source: Source;
  error: string;
  onClose: () => void;
  onMove: (target: { kind: "driver"; id: string } | { kind: "vehicle"; id: string } | { kind: "unassigned" }) => void;
}) {
  const isCurrentDriver = (id: string) => source.kind === "driver" && source.id === id;
  const isCurrentVehicle = (id: string) => source.kind === "vehicle" && source.id === id;
  // Para envíos en retorno, el "destino real" es el origin_branch_id.
  const shipmentTarget = shipment?.is_returning
    ? (shipment?.origin_branch_id ?? "")
    : (shipment?.final_branch_id ?? "");
  const lastMile = isLastMileShipment(shipment, plan.branch_id);

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <div>
            <div className="text-sm font-semibold text-slate-900">Reasignar envío</div>
            {shipment && (
              <div className="text-xs text-slate-500 mt-0.5">
                {shipment.tracking_id} · {shipment.weight_kg.toFixed(1)} kg
                {shipment.is_fragile && " · Frágil"}
                {shipment.is_returning
                  ? shipmentTarget && ` · devolución a ${branchLabelById(shipmentTarget, branches)}`
                  : shipmentTarget && ` · destino ${branchLabelById(shipmentTarget, branches)}`}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 grid gap-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {drivers.length > 0 && lastMile && (
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-2">Mover a chofer</div>
              <div className="grid gap-1.5">
                {drivers.map((d) => {
                  const blocked = plan.blocked_drivers.some((b) => b.driver_id === d.id);
                  const disabled = isCurrentDriver(d.id) || blocked;
                  return (
                    <button
                      key={d.id}
                      disabled={disabled}
                      onClick={() => onMove({ kind: "driver", id: d.id })}
                      className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-sm transition-colors cursor-pointer flex items-center justify-between gap-2"
                    >
                      <span>
                        {d.full_name || d.username}
                        {isCurrentDriver(d.id) && " (actual)"}
                      </span>
                      {blocked && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          Ruta ya iniciada
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {plan.inter_branch.length > 0 && !lastMile && (
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-2">Mover a vehículo</div>
              <div className="grid gap-1.5">
                {plan.inter_branch.map((v) => {
                  const isDirect = !shipmentTarget || v.destination_branch === shipmentTarget;
                  return (
                    <button
                      key={v.vehicle_id}
                      disabled={isCurrentVehicle(v.vehicle_id)}
                      onClick={() => onMove({ kind: "vehicle", id: v.vehicle_id })}
                      className="text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-sm transition-colors cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {v.license_plate} → {branchLabelById(v.destination_branch, branches)}
                          {isCurrentVehicle(v.vehicle_id) && " (actual)"}
                        </span>
                        {!isDirect && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                            Tránsito parcial
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                        {(v.total_weight_kg + v.existing_weight_kg).toFixed(1)} / {v.capacity_kg} kg
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Otra opción</div>
            <button
              onClick={() => onMove({ kind: "unassigned" })}
              disabled={source.kind === "unassigned"}
              className="text-left w-full px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-sm transition-colors cursor-pointer"
            >
              Marcar como sin asignar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApplyResultModal({ result, onClose }: { result: ApplyPlanResponse; onClose: () => void }) {
  const failed = result.items.filter((i) => i.status !== "applied");
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Resultado del plan</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 grid gap-3">
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            <div className="text-sm text-emerald-900 font-semibold">{result.applied_count} envíos aplicados</div>
          </div>
          {result.failed_count > 0 && (
            <>
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-rose-50 border border-rose-200">
                <AlertCircle className="w-5 h-5 text-rose-700" />
                <div className="text-sm text-rose-900 font-semibold">{result.failed_count} fallaron</div>
              </div>
              <div className="grid gap-1.5 max-h-64 overflow-y-auto">
                {failed.map((it, i) => (
                  <div key={`${it.tracking_id}-${i}`} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-700">{it.tracking_id}</span>
                      <span className="text-xs text-slate-500">{it.target}</span>
                    </div>
                    {it.error && <div className="text-xs text-rose-700 mt-1">{reasonLabel(it.error)}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
          <button
            onClick={onClose}
            className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-bold transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
