import { useEffect, useMemo, useState } from "react";
import { Route as RouteIcon, AlertCircle, CheckCircle2, RefreshCw, Truck, User as UserIcon, AlertTriangle, X, MapPin, Clock } from "lucide-react";
import { fmtMinutesAsTime, fmtDuration } from "../utils/date";
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
  type RouteStop,
  type DriverLoad,
  type VehicleLoad,
  type ApplyPlanResponse,
  type GlobalRoutingPlan,
  type IncomingVehicle,
} from "../api/routing";
import { PriorityBadge } from "../components/PriorityBadge";
import { ShipmentInfoModal } from "../components/ShipmentInfoModal";

type Source =
  | { kind: "driver"; id: string }
  | { kind: "vehicle"; id: string }
  | { kind: "unassigned" };

type MoveTarget =
  | { kind: "driver"; id: string }
  | { kind: "vehicle"; id: string }
  | { kind: "unassigned" };

interface DragState {
  trackingId: string;
  source: Source;
  isLastMile: boolean;
}

// MIME-type que usamos para identificar nuestros propios drags y diferenciarlos
// de cualquier otro drop (texto, archivos, etc).
const DRAG_MIME = "application/x-logitrack-shipment";

const MANUAL_UNASSIGNED_REASON = "movido_por_operador";

// Un envío califica para última milla si está en su sucursal final, va a entrega a domicilio
// y no es una devolución. Returns SIEMPRE viajan en vehículo de regreso al origen.
function isLastMileShipment(sh: Shipment | undefined, branchId: string): boolean {
  if (!sh) return false;
  if (sh.is_returning) return false;
  return sh.final_branch_id === branchId && sh.delivery_method === "ultima_milla";
}

// hasPendingShipments devuelve true cuando un assignment tiene envíos en su
// lista actual (shipments) que NO figuran en applied_shipments. Esto detecta
// envíos agregados via drag-and-drop después de un apply previo: aunque el
// flag `applied` siga en true, sabemos que hay trabajo nuevo para aplicar.
function hasPendingShipments(a: { shipments: string[]; applied_shipments?: string[] }): boolean {
  const applied = new Set(a.applied_shipments ?? []);
  return a.shipments.some((tid) => !applied.has(tid));
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
    out.last_mile = out.last_mile
      .map((a) =>
        a.driver_id === src.id
          ? {
              ...a,
              shipments: a.shipments.filter((t) => t !== trackingId),
              // En modo VRP también hay que sacarlo de ordered_stops y
              // recompactar la secuencia (1..N) — sino el render queda
              // desfasado o muestra el envío movido.
              ordered_stops: a.ordered_stops
                ?.filter((s) => s.tracking_id !== trackingId)
                .map((s, i) => ({ ...s, sequence: i + 1 })),
            }
          : a,
      )
      .filter((a) => a.shipments.length > 0);
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
  if (plan.last_mile.some((a) => a.driver_id === driverId && a.route_started)) {
    return { field: "driver", message: "El chofer ya está en ruta — no se le pueden asignar más envíos." };
  }
  const totals = driverTotals(plan, driverId);
  if (totals.weight + shipment.weight_kg > 150) {
    return {
      field: "weight",
      message: `Excede el peso máximo del chofer (${totals.weight.toFixed(1)} + ${shipment.weight_kg.toFixed(1)} > 150 kg).`,
    };
  }
  return null;
}

function validateMoveToVehicle(
  plan: RoutingPlan,
  vehicleId: string,
  shipment: Shipment,
): ValidationError | null {
  if (plan.inter_branch.some((a) => a.vehicle_id === vehicleId && a.in_transit)) {
    return { field: "vehicle", message: "El vehículo ya está en viaje — no se le pueden asignar más envíos." };
  }
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
  const { user, hasRole } = useAuth();
  const branchId = user?.branch_id ?? "";

  const [plan, setPlan] = useState<RoutingPlan | null>(null);
  const [globalPlan, setGlobalPlan] = useState<GlobalRoutingPlan | null>(null);
  const [originalPlan, setOriginalPlan] = useState<RoutingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [drivers, setDrivers] = useState<UserProfile[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [shipments, setShipments] = useState<Map<string, Shipment>>(new Map());
  const [applyResult, setApplyResult] = useState<ApplyPlanResponse | null>(null);
  const [viewingTrackingId, setViewingTrackingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropError, setDropError] = useState("");
  const canRegenerate = hasRole("operator", "supervisor");
  const canApply = hasRole("operator", "supervisor");

  const openInfo = (trackingId: string) => {
    if (shipments.has(trackingId)) setViewingTrackingId(trackingId);
  };
  const closeInfo = () => setViewingTrackingId(null);

  // showDropError muestra un toast efímero arriba del listado. Los drops
  // inválidos (capacidad excedida, tipo incorrecto, etc.) usan esto en lugar
  // del modal de error porque el operador no abrió ningún diálogo.
  const showDropError = (msg: string) => {
    setDropError(msg);
    window.setTimeout(() => setDropError((curr) => (curr === msg ? "" : curr)), 4000);
  };

  // Data inicial: branches, drivers, vehicles
  useEffect(() => {
    branchApi.list("activo").then(setBranches).catch(() => {});
    if (branchId) {
      usersApi.listDrivers(branchId).then(setDrivers).catch(() => {});
    }
  }, [branchId]);

  // Carga el plan del día desde el servidor al montar la página.
  useEffect(() => {
    void loadTodayPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // loadTodayPlan obtiene el plan del día desde el servidor (generado por cron o regenerate).
  // Extrae el BranchPlan de la sucursal del usuario y lo establece como plan editable.
  const loadTodayPlan = async () => {
    setLoading(true);
    setError("");
    try {
      const globalPlanRaw = await routingApi.getTodayPlan();
      setGlobalPlan(globalPlanRaw);
      // Buscar el plan de la sucursal del usuario (el backend ya lo filtra para op/sup).
      const branchPlan = globalPlanRaw.branch_plans.find((bp) => bp.branch_id === branchId)
        ?? globalPlanRaw.branch_plans[0];
      if (!branchPlan) {
        setPlan(null);
        setOriginalPlan(null);
        return;
      }
      await applyBranchPlan(branchPlan.plan);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        // No hay plan todavía — estado vacío esperado.
        setPlan(null);
        setOriginalPlan(null);
        setGlobalPlan(null);
      } else {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "No se pudo cargar el plan del día.";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // applyBranchPlan normaliza y establece un RoutingPlan como estado editable.
  const applyBranchPlan = async (raw: RoutingPlan) => {
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
    newPlan.last_mile.forEach((a) => {
      a.shipments.forEach((t) => allTids.add(t));
      a.existing_shipments?.forEach((t) => allTids.add(t));
    });
    newPlan.inter_branch.forEach((a) => {
      a.shipments.forEach((t) => allTids.add(t));
      a.existing_shipments?.forEach((t) => allTids.add(t));
    });
    newPlan.unassigned.forEach((u) => allTids.add(u.tracking_id));
    newPlan.driver_loads.forEach((l) => l.existing_shipments?.forEach((t) => allTids.add(t)));
    newPlan.vehicle_loads.forEach((l) => l.existing_shipments?.forEach((t) => allTids.add(t)));
    const shipMap = new Map<string, Shipment>();
    const all = await shipmentApi.list({ branch_id: branchId || newPlan.branch_id });
    all.forEach((s) => {
      if (allTids.has(s.tracking_id)) shipMap.set(s.tracking_id, s);
    });
    setShipments(shipMap);
    setPlan(newPlan);
    setOriginalPlan(clonePlan(newPlan));
  };

  // handleRegenerate llama al backend para regenerar el plan del día (manager/admin).
  const handleRegenerate = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const globalPlanRaw = await routingApi.regenerate();
      setGlobalPlan(globalPlanRaw);
      const branchPlan = globalPlanRaw.branch_plans.find((bp) => bp.branch_id === branchId)
        ?? globalPlanRaw.branch_plans[0];
      if (!branchPlan) {
        setPlan(null);
        setOriginalPlan(null);
      } else {
        await applyBranchPlan(branchPlan.plan);
        setSuccess("Plan regenerado correctamente.");
        setTimeout(() => setSuccess(""), 3000);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo regenerar el plan.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDiscard = () => {
    if (originalPlan) setPlan(clonePlan(originalPlan));
  };

  const handleApply = async () => {
    if (!branchId) return;
    setApplying(true);
    setError("");
    try {
      const editedPlan = isDirty && plan ? plan : undefined;
      const resp = await routingApi.apply(branchId, editedPlan ? { plan: editedPlan } : undefined);
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

  // handleApplyItem aplica solo un vehículo o chofer específico y recarga el plan inline.
  // Si el plan está dirty (drag-and-drop sin guardar), envía la versión editada al backend
  // para que sincronice los cambios y aplique el ítem en una sola request.
  const handleApplyItem = async (opts: { vehicleId?: string; driverId?: string }) => {
    if (!branchId) return;
    setApplying(true);
    setError("");
    try {
      const editedPlan = isDirty && plan ? plan : undefined;
      await routingApi.apply(branchId, { ...opts, plan: editedPlan });
      await loadTodayPlan();
      const label = opts.vehicleId ? "Despacho aplicado." : "Ruta aplicada.";
      setSuccess(label);
      setTimeout(() => setSuccess(""), 2500);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo aplicar el ítem.";
      setError(msg);
    } finally {
      setApplying(false);
    }
  };

  const closeApplyResult = () => {
    setApplyResult(null);
    setSuccess("Plan aplicado. Recargando…");
    setTimeout(() => setSuccess(""), 2500);
    void loadTodayPlan();
  };

  // executeMove es la lógica pura de mutación: valida, mueve, devuelve resultado.
  // La usa el handler de drop. Devuelve `{ ok: false, error }` cuando la
  // validación falla — el caller decide cómo mostrar el error.
  const executeMove = (
    trackingId: string,
    source: Source,
    target: MoveTarget,
  ): { ok: true } | { ok: false; error: string } => {
    if (!plan) return { ok: false, error: "Sin plan" };
    const sh = shipments.get(trackingId);
    if (!sh) return { ok: false, error: "Información del envío no disponible." };

    // No-op: drop sobre el mismo origen
    if (target.kind === "driver" && source.kind === "driver" && source.id === target.id) return { ok: true };
    if (target.kind === "vehicle" && source.kind === "vehicle" && source.id === target.id) return { ok: true };
    if (target.kind === "unassigned" && source.kind === "unassigned") return { ok: true };

    // Restricción de tipo: última milla solo a choferes; inter-sucursal solo a vehículos.
    const lastMile = isLastMileShipment(sh, branchId);
    if (target.kind === "driver" && !lastMile) {
      return { ok: false, error: "Este envío necesita transporte a otra sucursal — no se puede asignar a un chofer de última milla." };
    }
    if (target.kind === "vehicle" && lastMile) {
      return { ok: false, error: "Este envío ya está en su sucursal final — corresponde asignarlo a un chofer, no a un vehículo inter-sucursal." };
    }

    // Validación de capacidad
    let validation: ValidationError | null = null;
    if (target.kind === "driver") validation = validateMoveToDriver(plan, target.id, sh);
    else if (target.kind === "vehicle") validation = validateMoveToVehicle(plan, target.id, sh);
    if (validation) return { ok: false, error: validation.message };

    // Mutar el plan
    let next = removeFromSource(plan, source, trackingId);

    if (target.kind === "driver") {
      const driver = drivers.find((d) => d.id === target.id);
      // Si el plan original viene en modo VRP (cualquier ruta tiene
      // ordered_stops), las nuevas asignaciones manuales también deben
      // tener una stop — sino el render solo lee ordered_stops y los envíos
      // pusheados a `shipments` no aparecen en pantalla.
      const planIsVrp = next.last_mile.some((a) => !!a.ordered_stops?.length);
      // Nota: marcamos `manual: true` (no `unsequenced`). `unsequenced` está
      // reservado para envíos que el backend no pudo geolocalizar; para
      // reasignaciones del operador usamos un flag distinto que se renderiza
      // como un badge informativo, no un warning de coordenadas.
      const newStop = {
        tracking_id: trackingId,
        sequence: 0,
        arrival_min: -1,
        manual: true,
        time_window: sh.time_window ?? "flexible",
        weight_kg: sh.weight_kg,
      };
      const existing = next.last_mile.find((a) => a.driver_id === target.id);
      if (existing) {
        existing.shipments.push(trackingId);
        if (existing.ordered_stops) {
          existing.ordered_stops.push({ ...newStop, sequence: existing.ordered_stops.length + 1 });
        }
      } else {
        // Heredamos la carga existente del driver_loads — sin esto la card
        // promovida diría "1 envío · X kg" cuando en realidad el chofer ya
        // tiene N envíos en su ruta del día.
        const load = next.driver_loads.find((l) => l.driver_id === target.id);
        const created: LastMileAssignment = {
          driver_id: target.id,
          driver_name: driver?.full_name ?? target.id,
          shipments: [trackingId],
          total_weight_kg: 0,
          existing_count: load?.existing_count ?? 0,
          existing_weight_kg: load?.existing_weight_kg ?? 0,
          existing_shipments: load?.existing_shipments ?? [],
        };
        if (planIsVrp) {
          created.ordered_stops = [{ ...newStop, sequence: 1 }];
          created.optimized_by = "vrp";
          created.departure_min = next.last_mile[0]?.departure_min;
        }
        next.last_mile.push(created);
      }
    } else if (target.kind === "vehicle") {
      const existing = next.inter_branch.find((a) => a.vehicle_id === target.id);
      if (existing) {
        existing.shipments.push(trackingId);
      } else {
        // El operador asignó manualmente a un vehículo que todavía no tenía
        // despacho — lo creamos sobre la marcha usando los datos del pool
        // (vehicle_loads). El destino se infiere del envío: para retornos
        // es el origen, sino el final_branch. La rule queda "consolidation"
        // porque la decisión es manual.
        const load = next.vehicle_loads.find((l) => l.vehicle_id === target.id);
        if (load) {
          const dest = sh.is_returning ? (sh.origin_branch_id ?? "") : (sh.final_branch_id ?? "");
          next.inter_branch.push({
            vehicle_id: target.id,
            license_plate: load.license_plate,
            destination_branch: dest,
            rule: "consolidation",
            shipments: [trackingId],
            total_weight_kg: 0,
            capacity_kg: load.capacity_kg,
            existing_weight_kg: load.existing_weight_kg,
            existing_shipments: load.existing_shipments ?? [],
          });
        }
      }
    } else {
      next.unassigned.push({
        tracking_id: trackingId,
        destination: sh.final_branch_id ?? "",
        reason: MANUAL_UNASSIGNED_REASON,
        weight_kg: sh.weight_kg,
        priority: sh.priority ?? "",
      } as UnassignedShipment);
    }

    next = recomputeWeights(next, shipments);
    setPlan(next);
    return { ok: true };
  };

  // handleDrop es invocado por las drop zones. Si la validación falla, mostramos
  // un toast efímero como feedback inmediato.
  const handleDrop = (trackingId: string, source: Source, target: MoveTarget) => {
    const result = executeMove(trackingId, source, target);
    if (!result.ok) {
      showDropError(result.error);
    }
    setDragging(null);
  };

  // canAcceptDrop predice si el drag activo podría drop-ear sobre este target
  // sin actualizar el plan. Se usa para resaltar visualmente las zonas válidas.
  const canAcceptDrop = (target: MoveTarget): boolean => {
    if (!dragging || !plan) return false;
    if (target.kind === "driver" && !dragging.isLastMile) return false;
    if (target.kind === "vehicle" && dragging.isLastMile) return false;
    if (target.kind === "driver" && dragging.source.kind === "driver" && dragging.source.id === target.id) return false;
    if (target.kind === "vehicle" && dragging.source.kind === "vehicle" && dragging.source.id === target.id) return false;
    if (target.kind === "unassigned" && dragging.source.kind === "unassigned") return false;
    const sh = shipments.get(dragging.trackingId);
    if (!sh) return false;
    if (target.kind === "driver") return validateMoveToDriver(plan, target.id, sh) === null;
    if (target.kind === "vehicle") return validateMoveToVehicle(plan, target.id, sh) === null;
    return true;
  };

  // beginDrag arma el state de drag y configura el dataTransfer del evento.
  // Se invoca desde onDragStart de cada chip/row.
  const beginDrag = (e: React.DragEvent, trackingId: string) => {
    if (!plan) return;
    const sh = shipments.get(trackingId);
    if (!sh) return;
    const source = findSource(plan, trackingId);
    if (!source) return;
    e.dataTransfer.setData(DRAG_MIME, trackingId);
    e.dataTransfer.effectAllowed = "move";
    setDragging({
      trackingId,
      source,
      isLastMile: isLastMileShipment(sh, branchId),
    });
  };

  const endDrag = () => setDragging(null);

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
        description={
          globalPlan
            ? `Plan generado el ${new Date(globalPlan.generated_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${globalPlan.log.total_assigned} asignados · ${globalPlan.log.total_unassigned} sin asignar`
            : `Plan de ruteo para ${branches.find((b) => b.id === branchId)?.name ?? "tu sucursal"}. Se genera automáticamente a las 08:00.`
        }
        icon={<RouteIcon className="w-5 h-5" />}
        actions={
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
            {canRegenerate && (
              <button
                onClick={handleRegenerate}
                disabled={loading || applying}
                className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                Regenerar plan
              </button>
            )}
            {canApply && (
              <button
                onClick={handleApply}
                disabled={applying || loading || !plan}
                className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
              >
                {applying ? "Aplicando…" : "Aplicar plan"}
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {dropError && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {dropError}
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
            El plan del día aún no fue generado. Se genera automáticamente a las <strong>08:00</strong>.
            {canRegenerate
              ? " Podés generarlo ahora tocando el botón de abajo."
              : " Contactá a un manager o admin para generarlo manualmente."}
          </p>
          {canRegenerate && (
            <button
              onClick={handleRegenerate}
              disabled={!branchId}
              className="h-10 px-5 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
            >
              Generar plan ahora
            </button>
          )}
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
            <SummaryChip label="Asignados" value={totals.assignable} />
            <SummaryChip label="Por asignar" value={totals.unassigned} tone={totals.unassigned > 0 ? "warning" : "neutral"} />
            <SummaryChip label="Salidas inter-sucursal" value={totals.dispatches} />
            <SummaryChip label="Repartos locales" value={totals.drivers} />
          </div>

          {(() => {
            const pendingLastMile = plan.last_mile.filter((a) => !a.route_started);
            const inProgressLastMile = plan.last_mile.filter((a) => a.route_started);
            const pendingInterBranch = plan.inter_branch.filter((a) => !a.in_transit);
            const inProgressInterBranch = plan.inter_branch.filter((a) => a.in_transit);
            const inProgressDriverIds = inProgressLastMile.map((a) => a.driver_id);
            const inProgressVehicleIds = inProgressInterBranch.map((a) => a.vehicle_id);

            return (
              <>
                {/* Si el operador está draggeando y no hay sección de "sin asignar"
                    renderizada, mostramos un drop-zone flotante para poder soltar
                    ahí y desasignar. */}
                {dragging && plan.unassigned.length === 0 && dragging.source.kind !== "unassigned" && (
                  <UnassignedDropZone
                    onDrop={() => handleDrop(dragging.trackingId, dragging.source, { kind: "unassigned" })}
                    onCancel={endDrag}
                  />
                )}

                {plan.unassigned.length > 0 && (
                  <UnassignedSection
                    unassigned={plan.unassigned}
                    branches={branches}
                    shipments={shipments}
                    onView={openInfo}
                    dragging={dragging}
                    canAccept={canApply && canAcceptDrop({ kind: "unassigned" })}
                    onDragStart={canApply ? beginDrag : undefined}
                    onDragEnd={canApply ? endDrag : undefined}
                    onDropHere={canApply ? () => dragging && handleDrop(dragging.trackingId, dragging.source, { kind: "unassigned" }) : undefined}
                  />
                )}

                {/* Última milla: solo envíos pendientes de despacho. */}
                {(pendingLastMile.length > 0 || drivers.length > 0) && (
                  <LastMileSection
                    assignments={pendingLastMile}
                    excludedDriverIds={inProgressDriverIds}
                    drivers={drivers}
                    driverLoads={plan.driver_loads}
                    blockedDriverIds={plan.blocked_drivers.map((b) => b.driver_id)}
                    shipments={shipments}
                    onView={openInfo}
                    dragging={dragging}
                    canAcceptDriver={(driverId) => canApply && canAcceptDrop({ kind: "driver", id: driverId })}
                    onDragStart={canApply ? beginDrag : undefined}
                    onDragEnd={canApply ? endDrag : undefined}
                    onDropDriver={canApply ? (driverId) => dragging && handleDrop(dragging.trackingId, dragging.source, { kind: "driver", id: driverId }) : undefined}
                    onApplyDriver={canApply ? (driverId) => void handleApplyItem({ driverId }) : undefined}
                    applying={applying}
                  />
                )}

                {/* Inter-sucursal: solo despachos aún no iniciados. */}
                {(pendingInterBranch.length > 0 || plan.vehicle_loads.length > 0) && (
                  <InterBranchSection
                    assignments={pendingInterBranch}
                    excludedVehicleIds={inProgressVehicleIds}
                    vehicleLoads={plan.vehicle_loads}
                    branches={branches}
                    shipments={shipments}
                    onView={openInfo}
                    dragging={dragging}
                    canAcceptVehicle={(vehicleId) => canApply && canAcceptDrop({ kind: "vehicle", id: vehicleId })}
                    onDragStart={canApply ? beginDrag : undefined}
                    onDragEnd={canApply ? endDrag : undefined}
                    onDropVehicle={canApply ? (vehicleId) => dragging && handleDrop(dragging.trackingId, dragging.source, { kind: "vehicle", id: vehicleId }) : undefined}
                    onApplyVehicle={canApply ? (vehicleId) => void handleApplyItem({ vehicleId }) : undefined}
                    applying={applying}
                  />
                )}

                {/* Salidas en curso: choferes que ya iniciaron ruta y vehículos en viaje. Solo informativo. */}
                {(inProgressLastMile.length > 0 || inProgressInterBranch.length > 0) && (
                  <OutgoingInProgressSection
                    lastMile={inProgressLastMile}
                    interBranch={inProgressInterBranch}
                    drivers={drivers}
                    branches={branches}
                    shipments={shipments}
                    onView={openInfo}
                  />
                )}

                {/* Vehículos llegando: viajes inter-sucursal con destino esta sucursal. Solo informativo. */}
                {(plan.incoming_vehicles?.length ?? 0) > 0 && (
                  <IncomingVehiclesSection
                    vehicles={plan.incoming_vehicles!}
                    branches={branches}
                    shipments={shipments}
                    onView={openInfo}
                  />
                )}

                {plan.last_mile.length === 0 && plan.inter_branch.length === 0 && plan.unassigned.length === 0 && (
                  <Card className="p-10 text-center">
                    <p className="text-sm text-slate-500">No hay envíos para rutear desde esta sucursal en este momento.</p>
                  </Card>
                )}
              </>
            );
          })()}
        </>
      )}

      {applyResult && (
        <ApplyResultModal result={applyResult} onClose={closeApplyResult} />
      )}

      {viewingTrackingId && shipments.get(viewingTrackingId) && (
        <ShipmentInfoModal
          shipment={shipments.get(viewingTrackingId)!}
          branches={branches}
          onClose={closeInfo}
        />
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
  onView,
  onDragStart,
  onDragEnd,
  extra,
}: {
  trackingId: string;
  shipment: Shipment | undefined;
  onView?: (trackingId: string) => void;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  extra?: React.ReactNode;
}) {
  const clickable = !!onView && !!shipment;
  const draggable = !!onDragStart && !!shipment;
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart!(e, trackingId) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={clickable ? () => onView!(trackingId) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onView!(trackingId);
              }
            }
          : undefined
      }
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 ${draggable ? "cursor-grab active:cursor-grabbing" : clickable ? "cursor-pointer" : ""}`}
    >
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
    </div>
  );
}

function UnassignedSection({
  unassigned,
  branches,
  shipments,
  onView,
  dragging,
  canAccept,
  onDragStart,
  onDragEnd,
  onDropHere,
}: {
  unassigned: UnassignedShipment[];
  branches: Branch[];
  shipments: Map<string, Shipment>;
  onView?: (trackingId: string) => void;
  dragging: DragState | null;
  canAccept: boolean;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  onDropHere?: () => void;
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

  const dragActive = !!dragging;
  const cardClass = dragActive
    ? canAccept
      ? "mb-5 border-2 border-emerald-400 ring-2 ring-emerald-200"
      : "mb-5 border-amber-200 opacity-60"
    : "mb-5 border-amber-200";

  return (
    <Card
      className={cardClass}
      onDragOver={(e: React.DragEvent) => {
        if (canAccept) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e: React.DragEvent) => {
        if (!canAccept) return;
        e.preventDefault();
        onDropHere?.();
      }}
    >
      <CardHeader className="bg-amber-50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <CardTitle className="text-amber-900">Sin asignar ({unassigned.length})</CardTitle>
        </div>
        <CardDescription>
          El algoritmo no pudo asignar estos envíos. Arrastrá cualquier envío hasta el chofer o vehículo correspondiente, o tocá "Reasignar" para usar el menú.
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
                  onView={onView}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
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

// UnassignedDropZone es un placeholder mostrado durante un drag activo cuando
// no hay sección "Sin asignar" en el plan. Permite desasignar un envío
// soltándolo acá.
function UnassignedDropZone({ onDrop, onCancel }: { onDrop: () => void; onCancel: () => void }) {
  return (
    <div
      onDragOver={(e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e: React.DragEvent) => {
        e.preventDefault();
        onDrop();
      }}
      onDragLeave={onCancel}
      className="mb-5 px-4 py-6 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 text-center text-sm text-amber-900"
    >
      Soltá acá para mover el envío a "Sin asignar"
    </div>
  );
}

function LastMileSection({
  assignments,
  excludedDriverIds,
  drivers,
  driverLoads,
  blockedDriverIds,
  shipments,
  onView,
  dragging,
  canAcceptDriver,
  onDragStart,
  onDragEnd,
  onDropDriver,
  onApplyDriver,
  applying,
}: {
  assignments: LastMileAssignment[];
  excludedDriverIds: string[];
  drivers: UserProfile[];
  driverLoads: DriverLoad[];
  blockedDriverIds: string[];
  shipments: Map<string, Shipment>;
  onView?: (trackingId: string) => void;
  dragging: DragState | null;
  canAcceptDriver?: (driverId: string) => boolean;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  onDropDriver?: (driverId: string) => void;
  onApplyDriver?: (driverId: string) => void;
  applying?: boolean;
}) {
  // Choferes elegibles que aún no tienen asignación en este plan: drop zones
  // adicionales durante un drag. Sin esto, si todo quedó "sin asignar" no
  // habría adónde tirar los envíos.
  // excludedDriverIds contiene los choferes ya en ruta — tampoco son pool válido.
  const assignedIds = new Set([...assignments.map((a) => a.driver_id), ...excludedDriverIds]);
  const blockedIds = new Set(blockedDriverIds);
  const poolDrivers = drivers.filter((d) => !assignedIds.has(d.id) && !blockedIds.has(d.id));

  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserIcon className="w-4 h-4 text-slate-700" />
          <CardTitle>Última milla</CardTitle>
        </div>
        <CardDescription>Envíos asignados a choferes para entrega del día. Arrastrá cualquier envío entre choferes o desde "Sin asignar". El sistema calcula la secuencia óptima de paradas cuando hay coordenadas.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {assignments.map((a) => {
          const driver = drivers.find((d) => d.id === a.driver_id);
          return (
            <DriverRouteCard
              key={a.driver_id}
              assignment={a}
              driverName={driver?.full_name ?? a.driver_name ?? a.driver_id}
              shipments={shipments}
              onView={onView}
              dragActive={!!dragging}
              canAccept={canAcceptDriver?.(a.driver_id) ?? false}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropHere={() => onDropDriver?.(a.driver_id)}
              onApply={!a.route_started && hasPendingShipments(a) && onApplyDriver ? () => onApplyDriver(a.driver_id) : undefined}
              applying={applying}
            />
          );
        })}
        {poolDrivers.map((d) => {
          // Buscamos la carga existente del chofer (envíos ya en out_for_delivery
          // de un Apply previo, sin haber iniciado la ruta todavía). Si tiene
          // envíos pendientes el sublabel los refleja en lugar de "Sin asignaciones".
          const load = driverLoads.find((l) => l.driver_id === d.id);
          const hasExisting = (load?.existing_count ?? 0) > 0;
          const sublabel = hasExisting
            ? `${load!.existing_count} envíos en ruta · ${load!.existing_weight_kg.toFixed(1)} kg pendientes`
            : "Sin envíos asignados";
          return (
            <PoolDropCard
              key={d.id}
              label={d.full_name || d.username}
              sublabel={sublabel}
              dragActive={!!dragging}
              canAccept={canAcceptDriver?.(d.id) ?? false}
              onDropHere={() => onDropDriver?.(d.id)}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

// PoolDropCard es la card que representa un chofer o vehículo del pool sin
// asignaciones. Sirve también como drop target durante drag — permite asignar
// el envío sin tener que crear el dispatch antes. Tiene 3 estados visuales:
//   - reposo (sin drag): borde sólido tenue, sin highlight
//   - drag activo + acepta: borde verde con ring + hint "Soltá acá"
//   - drag activo + no acepta (otro tipo de envío): atenuado
function PoolDropCard({
  label,
  sublabel,
  dragActive,
  canAccept,
  onDropHere,
}: {
  label: string;
  sublabel: string;
  dragActive: boolean;
  canAccept: boolean;
  onDropHere?: () => void;
}) {
  const cls = dragActive
    ? canAccept
      ? "rounded-lg border-2 border-dashed border-emerald-400 ring-2 ring-emerald-100 p-3 bg-emerald-50/40"
      : "rounded-lg border border-dashed border-slate-300 p-3 bg-white opacity-60"
    : "rounded-lg border border-dashed border-slate-300 p-3 bg-white";
  return (
    <div
      className={cls}
      onDragOver={(e: React.DragEvent) => {
        if (canAccept) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e: React.DragEvent) => {
        if (!canAccept) return;
        e.preventDefault();
        onDropHere?.();
      }}
    >
      <div className="text-sm font-semibold text-slate-900">{label}</div>
      <div className="text-xs text-slate-500">{sublabel}</div>
      {dragActive && canAccept && (
        <div className="mt-1 text-[11px] text-emerald-700">Soltá acá para asignar</div>
      )}
    </div>
  );
}

// Mapa de colores por ventana horaria.
const TIME_WINDOW_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  morning:   { bg: "bg-cyan-100",   text: "text-cyan-800",   label: "Mañana" },
  afternoon: { bg: "bg-violet-100", text: "text-violet-800", label: "Tarde" },
  flexible:  { bg: "bg-slate-100",  text: "text-slate-700",  label: "Flexible" },
};

function TimeWindowChip({ tw }: { tw?: string }) {
  const cfg = TIME_WINDOW_BADGE[tw ?? ""] ?? TIME_WINDOW_BADGE.flexible;
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function DriverRouteCard({
  assignment,
  driverName,
  shipments,
  onView,
  dragActive,
  canAccept,
  onDragStart,
  onDragEnd,
  onDropHere,
  onApply,
  applying,
}: {
  assignment: LastMileAssignment;
  driverName: string;
  shipments: Map<string, Shipment>;
  onView?: (trackingId: string) => void;
  dragActive: boolean;
  canAccept: boolean;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  onDropHere?: () => void;
  onApply?: () => void;
  applying?: boolean;
}) {
  const a = assignment;
  const totalCount = a.shipments.length + a.existing_count;
  const totalWeight = a.total_weight_kg + a.existing_weight_kg;
  const optimized = a.optimized_by === "vrp";
  const hasStops = !!a.ordered_stops && a.ordered_stops.length > 0;

  // Resaltado cuando hay drag activo: verde si acepta, atenuado si no.
  const cardClass = dragActive
    ? canAccept
      ? "rounded-lg border-2 border-emerald-400 ring-2 ring-emerald-200 p-3 bg-emerald-50/40"
      : "rounded-lg border border-slate-200 p-3 bg-slate-50/50 opacity-60"
    : "rounded-lg border border-slate-200 p-3 bg-slate-50/50";

  return (
    <div
      className={cardClass}
      onDragOver={(e: React.DragEvent) => {
        if (canAccept) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e: React.DragEvent) => {
        if (!canAccept) return;
        e.preventDefault();
        onDropHere?.();
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
            <span>{driverName}</span>
            {assignment.route_started && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                🚚 En ruta
              </span>
            )}
            {!assignment.route_started && assignment.applied && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                ✓ Aplicado
              </span>
            )}
            {!assignment.route_started && !assignment.applied && (assignment.applied_shipments?.length ?? 0) > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                Parcial · {assignment.applied_shipments?.length}/{assignment.shipments.length}
              </span>
            )}
            {!assignment.route_started && assignment.applied && hasPendingShipments(assignment) && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                + {assignment.shipments.length - (assignment.applied_shipments?.length ?? 0)} sin aplicar
              </span>
            )}
          </div>
          {optimized && (
            <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500 tabular-nums flex-wrap">
              {a.departure_min !== undefined && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Salida {fmtMinutesAsTime(a.departure_min)}
                </span>
              )}
              {a.total_duration_min ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Duración {fmtDuration(a.total_duration_min)}
                </span>
              ) : null}
              {a.total_distance_km ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {a.total_distance_km.toFixed(1)} km
                </span>
              ) : null}
            </div>
          )}
        </div>
        <div className="text-xs text-slate-500 tabular-nums text-right shrink-0 flex flex-col items-end gap-1">
          <div>{totalCount} envíos · {totalWeight.toFixed(1)} kg</div>
          {a.existing_count > 0 && (
            <div className="text-[11px] text-slate-400">
              {a.shipments.length} nuevos + {a.existing_count} en ruta ({a.existing_weight_kg.toFixed(1)} kg)
            </div>
          )}
          {hasPendingShipments(assignment) && onApply && (
            <button
              onClick={onApply}
              disabled={applying}
              className="text-xs px-2 py-0.5 rounded-md bg-[#1e3a5f] hover:bg-[#15294a] disabled:opacity-40 text-white font-semibold transition-colors cursor-pointer mt-1"
            >
              Aplicar ruta
            </button>
          )}
        </div>
      </div>

      {hasStops ? (
        <div className="grid gap-2">
          {a.ordered_stops!.map((s) => (
            <RouteStopRow
              key={s.tracking_id}
              stop={s}
              departureMin={a.departure_min ?? 0}
              shipment={shipments.get(s.tracking_id)}
              onView={onView}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          {a.shipments.map((tid) => (
            <ShipmentChip
              key={tid}
              trackingId={tid}
              shipment={shipments.get(tid)}
              onView={onView}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}

      {a.existing_shipments && a.existing_shipments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-200">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Ya en su ruta del día
          </div>
          <div className="grid gap-2">
            {a.existing_shipments.map((tid) => (
              <ExistingShipmentRow
                key={tid}
                trackingId={tid}
                shipment={shipments.get(tid)}
                onView={onView}
                badgeLabel="En ruta"
                badgeClass="bg-sky-100 text-sky-800"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ExistingShipmentRow es un row de solo lectura para envíos previos: ya están
// en out_for_delivery (chofer) o loaded (vehículo) y el operador no debería
// poder moverlos desde el planificador. Click abre el modal de detalle.
function ExistingShipmentRow({
  trackingId,
  shipment,
  onView,
  badgeLabel,
  badgeClass,
}: {
  trackingId: string;
  shipment: Shipment | undefined;
  onView?: (trackingId: string) => void;
  badgeLabel: string;
  badgeClass: string;
}) {
  const clickable = !!onView && !!shipment;
  return (
    <div
      onClick={clickable ? () => onView!(trackingId) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onView!(trackingId);
              }
            }
          : undefined
      }
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/70 ${clickable ? "cursor-pointer hover:bg-slate-100" : ""}`}
    >
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
          </>
        )}
      </div>
      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0 ${badgeClass}`}>{badgeLabel}</span>
    </div>
  );
}

function RouteStopRow({
  stop,
  departureMin,
  shipment,
  onView,
  onDragStart,
  onDragEnd,
}: {
  stop: RouteStop;
  departureMin: number;
  shipment: Shipment | undefined;
  onView?: (trackingId: string) => void;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
}) {
  const arrival = stop.unsequenced ? -1 : departureMin + stop.arrival_min;
  const clickable = !!onView && !!shipment;
  const draggable = !!onDragStart && !!shipment;
  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart!(e, stop.tracking_id) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={clickable ? () => onView!(stop.tracking_id) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onView!(stop.tracking_id);
              }
            }
          : undefined
      }
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 ${draggable ? "cursor-grab active:cursor-grabbing" : clickable ? "cursor-pointer" : ""}`}
    >
      <div className="shrink-0 w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center tabular-nums">
        {stop.sequence}
      </div>
      <div className="flex flex-col min-w-0 flex-1 gap-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-mono text-xs text-slate-700 shrink-0">{stop.tracking_id}</span>
          {!stop.unsequenced && !stop.manual && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 tabular-nums">
              <Clock className="w-3 h-3" />
              {fmtMinutesAsTime(arrival)}
            </span>
          )}
          {stop.unsequenced && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">
              Sin coordenadas
            </span>
          )}
          {stop.manual && !stop.unsequenced && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium">
              Asignado manualmente
            </span>
          )}
          {stop.within_window === false && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-medium"
              title={
                stop.window_deviation_min != null
                  ? `${stop.window_deviation_min > 0 ? "+" : ""}${stop.window_deviation_min} min fuera de ventana`
                  : "Fuera de ventana horaria"
              }
            >
              ⚠ Fuera de ventana {stop.window_deviation_min != null ? `(${stop.window_deviation_min > 0 ? "+" : ""}${stop.window_deviation_min} min)` : ""}
            </span>
          )}
          <TimeWindowChip tw={stop.time_window} />
          <span className="text-[11px] text-slate-500 tabular-nums">{stop.weight_kg.toFixed(1)} kg</span>
          {shipment?.priority && <PriorityBadge priority={shipment.priority} />}
          {shipment?.is_fragile && <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Frágil</span>}
          {shipment?.shipment_type === "express" && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Express</span>
          )}
        </div>
      </div>
    </div>
  );
}

function InterBranchSection({
  assignments,
  excludedVehicleIds,
  vehicleLoads,
  branches,
  shipments,
  onView,
  dragging,
  canAcceptVehicle,
  onDragStart,
  onDragEnd,
  onDropVehicle,
  onApplyVehicle,
  applying,
}: {
  assignments: InterBranchAssignment[];
  excludedVehicleIds: string[];
  vehicleLoads: VehicleLoad[];
  branches: Branch[];
  shipments: Map<string, Shipment>;
  onView?: (trackingId: string) => void;
  dragging: DragState | null;
  canAcceptVehicle?: (vehicleId: string) => boolean;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  onDropVehicle?: (vehicleId: string) => void;
  onApplyVehicle?: (vehicleId: string) => void;
  applying?: boolean;
}) {
  const dragActive = !!dragging;
  // Vehículos del pool sin despacho: drop zones extra durante drag para
  // poder asignar manualmente envíos a vehículos que el algoritmo no usó.
  // excludedVehicleIds contiene los ya en viaje — no son pool válido.
  const dispatchedIds = new Set([...assignments.map((a) => a.vehicle_id), ...excludedVehicleIds]);
  const poolVehicles = vehicleLoads.filter((v) => !dispatchedIds.has(v.vehicle_id));
  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-slate-700" />
          <CardTitle>Despachos a otras sucursales</CardTitle>
        </div>
        <CardDescription>
          Cada despacho prepara un vehículo con destino seteado. Arrastrá envíos entre vehículos según convenga. El viaje se inicia manualmente desde Flota cuando el vehículo esté listo.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {assignments.map((a) => {
          const totalLoaded = a.total_weight_kg + a.existing_weight_kg;
          const utilPct = a.capacity_kg > 0 ? Math.round((totalLoaded / a.capacity_kg) * 100) : 0;
          const canAccept = canAcceptVehicle?.(a.vehicle_id) ?? false;
          const cardClass = dragActive
            ? canAccept
              ? "rounded-lg border-2 border-emerald-400 ring-2 ring-emerald-200 p-3 bg-emerald-50/40"
              : "rounded-lg border border-slate-200 p-3 bg-slate-50/50 opacity-60"
            : "rounded-lg border border-slate-200 p-3 bg-slate-50/50";
          return (
            <div
              key={a.vehicle_id}
              className={cardClass}
              onDragOver={(e: React.DragEvent) => {
                if (canAccept) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(e: React.DragEvent) => {
                if (!canAccept) return;
                e.preventDefault();
                onDropVehicle?.(a.vehicle_id);
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                  {a.license_plate} → {branchLabelById(a.destination_branch, branches)}
                  {a.in_transit && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                      🚚 En viaje
                    </span>
                  )}
                  {!a.in_transit && a.applied && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                      ✓ Aplicado
                    </span>
                  )}
                  {!a.in_transit && !a.applied && (a.applied_shipments?.length ?? 0) > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                      Parcial · {a.applied_shipments?.length}/{a.shipments.length}
                    </span>
                  )}
                  {!a.in_transit && a.applied && hasPendingShipments(a) && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                      + {a.shipments.length - (a.applied_shipments?.length ?? 0)} sin aplicar
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.rule === "sla_forced" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"}`}>
                    {DISPATCH_RULE_LABELS[a.rule]}
                  </span>
                  {!a.in_transit && hasPendingShipments(a) && onApplyVehicle && (
                    <button
                      onClick={() => onApplyVehicle(a.vehicle_id)}
                      disabled={applying}
                      className="text-xs px-2 py-0.5 rounded-md bg-[#1e3a5f] hover:bg-[#15294a] disabled:opacity-40 text-white font-semibold transition-colors cursor-pointer"
                    >
                      Aplicar despacho
                    </button>
                  )}
                </div>
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
                      onView={onView}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
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
              {a.existing_shipments && a.existing_shipments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                    Ya cargado en el vehículo
                  </div>
                  <div className="grid gap-2">
                    {a.existing_shipments.map((tid) => (
                      <ExistingShipmentRow
                        key={tid}
                        trackingId={tid}
                        shipment={shipments.get(tid)}
                        onView={onView}
                        badgeLabel="Ya cargado"
                        badgeClass="bg-indigo-100 text-indigo-800"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {poolVehicles.map((v) => (
          <PoolDropCard
            key={v.vehicle_id}
            label={v.license_plate}
            sublabel={`Disponible · ${v.existing_weight_kg.toFixed(1)} / ${v.capacity_kg} kg`}
            dragActive={!!dragging}
            canAccept={canAcceptVehicle?.(v.vehicle_id) ?? false}
            onDropHere={onDropVehicle ? () => onDropVehicle(v.vehicle_id) : undefined}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ApplyResultModal({ result, onClose }: { result: ApplyPlanResponse; onClose: () => void }) {
  // Defensivo: el backend puede enviar items=null si no se aplicó nada.
  const items = result.items ?? [];
  const failed = items.filter((i) => i.status !== "applied");
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

// OutgoingInProgressSection muestra choferes que ya iniciaron ruta y vehículos
// que ya están en viaje DESDE esta sucursal. Es solo informativo: no hay
// drag-and-drop ni botones de apply porque ya están en movimiento.
function OutgoingInProgressSection({
  lastMile,
  interBranch,
  drivers,
  branches,
  shipments,
  onView,
}: {
  lastMile: LastMileAssignment[];
  interBranch: InterBranchAssignment[];
  drivers: UserProfile[];
  branches: Branch[];
  shipments: Map<string, Shipment>;
  onView?: (trackingId: string) => void;
}) {
  const total = lastMile.length + interBranch.length;
  if (total === 0) return null;
  return (
    <Card className="mb-5 border-sky-200">
      <CardHeader className="bg-sky-50 rounded-t-xl">
        <CardTitle className="text-sky-900 flex items-center gap-2">
          <Truck className="w-5 h-5" />
          Salidas en curso ({total})
        </CardTitle>
        <CardDescription>
          Choferes y vehículos que ya iniciaron viaje desde esta sucursal. Solo informativo — no se puede modificar la asignación.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        {lastMile.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Choferes en ruta
            </div>
            <div className="grid gap-3">
              {lastMile.map((a) => {
                const driver = drivers.find((d) => d.id === a.driver_id);
                const driverName = driver?.full_name ?? a.driver_name ?? a.driver_id;
                const allShipments = [
                  ...a.shipments,
                  ...(a.existing_shipments ?? []).filter((t) => !a.shipments.includes(t)),
                ];
                const totalCount = allShipments.length;
                const totalWeight = a.total_weight_kg + a.existing_weight_kg;
                return (
                  <div key={a.driver_id} className="rounded-lg border border-sky-200 p-3 bg-sky-50/40">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                        <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                        <span>{driverName}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                          🚚 En ruta
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums shrink-0">
                        {totalCount} envíos · {totalWeight.toFixed(1)} kg
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      {allShipments.map((tid) => {
                        const sh = shipments.get(tid);
                        const clickable = !!onView && !!sh;
                        return (
                          <div
                            key={tid}
                            onClick={clickable ? () => onView!(tid) : undefined}
                            role={clickable ? "button" : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onKeyDown={
                              clickable
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onView!(tid);
                                    }
                                  }
                                : undefined
                            }
                            className={`flex items-center gap-2 px-2 py-1 rounded border border-slate-200 bg-white text-xs ${clickable ? "cursor-pointer hover:bg-slate-50" : ""}`}
                          >
                            <span className="font-mono text-slate-700">{tid}</span>
                            {sh && <span className="text-slate-500 tabular-nums">{sh.weight_kg.toFixed(1)} kg</span>}
                            {sh?.priority && <PriorityBadge priority={sh.priority} />}
                            {sh?.is_fragile && <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Frágil</span>}
                            {sh?.shipment_type === "express" && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Express</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {lastMile.length > 0 && interBranch.length > 0 && (
          <div className="border-t border-slate-100" />
        )}
        {interBranch.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Vehículos en viaje
            </div>
            <div className="grid gap-3">
              {interBranch.map((a) => {
                const totalLoaded = a.total_weight_kg + a.existing_weight_kg;
                const utilPct = a.capacity_kg > 0 ? Math.round((totalLoaded / a.capacity_kg) * 100) : 0;
                const allShipments = [
                  ...a.shipments,
                  ...(a.existing_shipments ?? []).filter((t) => !a.shipments.includes(t)),
                ];
                return (
                  <div key={a.vehicle_id} className="rounded-lg border border-sky-200 p-3 bg-sky-50/40">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                        <span>{a.license_plate}</span>
                        <span className="text-slate-500 font-normal">→</span>
                        <span>{branchLabelById(a.destination_branch, branches)}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                          🚚 En viaje
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums shrink-0">
                        {allShipments.length} envíos · {totalLoaded.toFixed(1)} / {a.capacity_kg} kg ({utilPct}%)
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      {allShipments.map((tid) => {
                        const sh = shipments.get(tid);
                        const clickable = !!onView && !!sh;
                        return (
                          <div
                            key={tid}
                            onClick={clickable ? () => onView!(tid) : undefined}
                            role={clickable ? "button" : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onKeyDown={
                              clickable
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onView!(tid);
                                    }
                                  }
                                : undefined
                            }
                            className={`flex items-center gap-2 px-2 py-1 rounded border border-slate-200 bg-white text-xs ${clickable ? "cursor-pointer hover:bg-slate-50" : ""}`}
                          >
                            <span className="font-mono text-slate-700">{tid}</span>
                            {sh && <span className="text-slate-500 tabular-nums">{sh.weight_kg.toFixed(1)} kg</span>}
                            {sh?.priority && <PriorityBadge priority={sh.priority} />}
                            {sh?.is_fragile && <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Frágil</span>}
                            {sh?.shipment_type === "express" && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Express</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// IncomingVehiclesSection muestra vehículos en camino HACIA esta sucursal.
// Es una vista informativa: no hay drag-and-drop ni botones de apply porque
// los vehículos están en viaje y no se les puede asignar carga adicional.
function IncomingVehiclesSection({
  vehicles,
  branches,
  shipments,
  onView,
}: {
  vehicles: IncomingVehicle[];
  branches: Branch[];
  shipments: Map<string, Shipment>;
  onView?: (trackingId: string) => void;
}) {
  return (
    <Card className="border-sky-200">
      <CardHeader className="bg-sky-50 rounded-t-xl">
        <CardTitle className="text-sky-900 flex items-center gap-2">
          <Truck className="w-5 h-5" />
          Vehículos llegando ({vehicles.length})
        </CardTitle>
        <CardDescription>
          Despachos de otras sucursales en camino hacia acá. Solo informativo —
          no se les puede modificar ni asignar carga adicional.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        {vehicles.map((v) => (
          <div key={v.vehicle_id} className="rounded-lg border border-sky-200 p-3 bg-sky-50/40">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                <span>{v.license_plate}</span>
                <span className="text-slate-500 font-normal">desde</span>
                <span>{branchLabelById(v.origin_branch, branches)}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                  🚚 En viaje
                </span>
              </div>
              <div className="text-xs text-slate-500 tabular-nums shrink-0">
                {v.shipments.length} envíos · {v.total_weight_kg.toFixed(1)} / {v.capacity_kg} kg
              </div>
            </div>
            <div className="grid gap-1.5">
              {v.shipments.map((tid) => {
                const sh = shipments.get(tid);
                const clickable = !!onView && !!sh;
                return (
                  <div
                    key={tid}
                    onClick={clickable ? () => onView!(tid) : undefined}
                    role={clickable ? "button" : undefined}
                    className={`flex items-center gap-2 px-2 py-1 rounded border border-slate-200 bg-white text-xs ${clickable ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  >
                    <span className="font-mono text-slate-700">{tid}</span>
                    {sh && <span className="text-slate-500 tabular-nums">{sh.weight_kg.toFixed(1)} kg</span>}
                    {sh?.priority && <PriorityBadge priority={sh.priority} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
