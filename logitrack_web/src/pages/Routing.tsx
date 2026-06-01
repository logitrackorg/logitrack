import { useEffect, useMemo, useState } from "react";
import { Route as RouteIcon, AlertCircle, CheckCircle2, RefreshCw, Truck, User as UserIcon, AlertTriangle, X, Clock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { branchApi, branchLabelById, type Branch } from "../api/branches";

import { shipmentApi, type Shipment } from "../api/shipments";
import {
  routingApi,
  reasonLabel,
  DISPATCH_RULE_LABELS,
  type RoutingConfig,
  type RoutingPlan,
  type LastMileAssignment,
  type InterBranchAssignment,
  type UnassignedShipment,
  type VehicleLoad,
  type ApplyPlanResponse,
  type GlobalRoutingPlan,
  type IncomingVehicle,
} from "../api/routing";
import { PriorityBadge } from "../components/PriorityBadge";
import { ShipmentInfoModal } from "../components/ShipmentInfoModal";
import { EditDriverStopsModal } from "../components/EditDriverStopsModal";
import { ReviewInterBranchModal } from "../components/ReviewInterBranchModal";

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
    if (a.shipments.includes(trackingId)) return { kind: "driver", id: a.vehicle_id };
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
        a.vehicle_id === src.id
          ? { ...a, shipments: a.shipments.filter((t) => t !== trackingId) }
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

function lastMileVehicleTotals(plan: RoutingPlan, vehicleId: string): { weight: number; capacity: number } {
  const asg = plan.last_mile.find((a) => a.vehicle_id === vehicleId);
  if (asg) {
    return { weight: asg.total_weight_kg + (asg.existing_weight_kg ?? 0), capacity: asg.capacity_kg };
  }
  const load = plan.vehicle_loads.find((l) => l.vehicle_id === vehicleId);
  if (load) {
    return { weight: load.existing_weight_kg, capacity: load.capacity_kg };
  }
  return { weight: 0, capacity: 0 };
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

function validateMoveToLastMileVehicle(
  plan: RoutingPlan,
  vehicleId: string,
  shipment: Shipment,
): ValidationError | null {
  if (plan.last_mile.some((a) => a.vehicle_id === vehicleId && a.in_transit)) {
    return { field: "vehicle", message: "El vehículo ya está en viaje — no se le pueden asignar más envíos." };
  }
  const totals = lastMileVehicleTotals(plan, vehicleId);
  if (totals.capacity > 0 && totals.weight + shipment.weight_kg > totals.capacity) {
    return {
      field: "weight",
      message: `Excede la capacidad del vehículo (${totals.weight.toFixed(1)} + ${shipment.weight_kg.toFixed(1)} > ${totals.capacity.toFixed(0)} kg).`,
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

interface RoutingProps {
  // mode controla qué vista mostrar:
  //   "last_mile" → solo última milla, sin tab switcher
  //   "inter_branch" → solo inter-sucursal, sin tab switcher
  //   undefined → ambas, con tab switcher (legacy)
  mode?: "last_mile" | "inter_branch";
}

export function Routing({ mode }: RoutingProps = {}) {
  const { user, hasRole } = useAuth();
  const userBranchId = user?.branch_id ?? "";
  // Para op/supervisor el branch viene fijo. Para manager/admin (sin branch_id)
  // es elegible — empieza vacío y se setea al cargar el plan global.
  const isNetworkRole = hasRole("manager");
  const [selectedBranchId, setSelectedBranchId] = useState<string>(userBranchId);
  const branchId = selectedBranchId || userBranchId;

  const [plan, setPlan] = useState<RoutingPlan | null>(null);
  const [globalPlan, setGlobalPlan] = useState<GlobalRoutingPlan | null>(null);
  const [horizonPlans, setHorizonPlans] = useState<GlobalRoutingPlan[]>([]);
  const [horizonDayIndex, setHorizonDayIndex] = useState(0); // 0=hoy, 1=mañana, 2=pasado
  const [originalPlan, setOriginalPlan] = useState<RoutingPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);

  const [shipments, setShipments] = useState<Map<string, Shipment>>(new Map());
  const [applyResult, setApplyResult] = useState<ApplyPlanResponse | null>(null);
  const [viewingTrackingId, setViewingTrackingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [dropError, setDropError] = useState("");
  const [activeTabState, setActiveTab] = useState<"last_mile" | "inter_branch">(mode ?? "last_mile");
  // Si mode está forzado por la prop, ignorar el state interno
  const activeTab = mode ?? activeTabState;
  // Modal "Editar paradas" (última milla)
  const [editingStopsVehicleId, setEditingStopsVehicleId] = useState<string | null>(null);
  // Modal "Revisar despacho" (inter-sucursal)
  const [reviewingDispatchVehicleId, setReviewingDispatchVehicleId] = useState<string | null>(null);

  // Modal "Agregar parada"
  const [addStopVehicleId, setAddStopVehicleId] = useState<string | null>(null);
  const [addStopBranchId, setAddStopBranchId] = useState("");
  const [addStopShipments, setAddStopShipments] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    branchApi.list("activo").then(setBranches).catch(() => {});
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
    // Cargar el horizonte completo en paralelo (para los tabs de días).
    routingApi.getHorizonPlans().then(setHorizonPlans).catch(() => {});
    try {
      const globalPlanRaw = await routingApi.getTodayPlan();
      setGlobalPlan(globalPlanRaw);
      // Para op/sup el backend ya filtra a su sucursal.
      // Para manager/admin: usar la seleccionada o defaultear a la primera.
      let effectiveBranchId = branchId;
      if (isNetworkRole && !effectiveBranchId && globalPlanRaw.branch_plans.length > 0) {
        effectiveBranchId = globalPlanRaw.branch_plans[0].branch_id;
        setSelectedBranchId(effectiveBranchId);
      }
      const branchPlan = globalPlanRaw.branch_plans.find((bp) => bp.branch_id === effectiveBranchId)
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

  // isForecast: true cuando se está viendo un día de pronóstico (no aplicable).
  const isForecast = horizonDayIndex > 0;

  // loadHorizonDay carga el plan del día seleccionado desde el horizonte ya cargado.
  const loadHorizonDay = async (dayIdx: number) => {
    const hp = horizonPlans[dayIdx];
    if (!hp) return;
    setHorizonDayIndex(dayIdx);
    if (dayIdx === 0) {
      // Día 0: recargar el plan vivo (con overrides de runtime).
      await loadTodayPlan();
      return;
    }
    // Días de pronóstico: mostrar read-only sin overrides.
    let effectiveBranchId = branchId;
    if (isNetworkRole && !effectiveBranchId && hp.branch_plans.length > 0) {
      effectiveBranchId = hp.branch_plans[0].branch_id;
    }
    const branchPlan = hp.branch_plans.find((bp) => bp.branch_id === effectiveBranchId)
      ?? hp.branch_plans[0];
    if (!branchPlan) {
      setPlan(null);
      setOriginalPlan(null);
      return;
    }
    await applyBranchPlan(branchPlan.plan);
  };

  // applyBranchPlan normaliza y establece un RoutingPlan como estado editable.
  const applyBranchPlan = async (raw: RoutingPlan) => {
    const newPlan: RoutingPlan = {
      ...raw,
      last_mile: raw.last_mile ?? [],
      inter_branch: raw.inter_branch ?? [],
      unassigned: raw.unassigned ?? [],
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
      // Pickups cross-branch: envíos de OTRAS sucursales que viajan en este dispatch
      a.additional_stops?.forEach((st) => {
        st.pickup_shipments?.forEach((t) => allTids.add(t));
      });
    });
    newPlan.unassigned.forEach((u) => allTids.add(u.tracking_id));
    newPlan.vehicle_loads.forEach((l) => l.existing_shipments?.forEach((t) => allTids.add(t)));
    newPlan.incoming_vehicles?.forEach((v) => v.shipments.forEach((t) => allTids.add(t)));
    const shipMap = new Map<string, Shipment>();
    const all = await shipmentApi.list({ branch_id: branchId || newPlan.branch_id });
    all.forEach((s) => {
      if (allTids.has(s.tracking_id)) shipMap.set(s.tracking_id, s);
    });
    // Pickups cross-branch: traer los envíos que aún no están en el shipMap
    // (vienen de OTRAS sucursales). Lookups individuales por tracking_id.
    const missing = Array.from(allTids).filter((t) => !shipMap.has(t));
    if (missing.length > 0) {
      const fetched = await Promise.all(
        missing.map((t) => shipmentApi.get(t).catch(() => null))
      );
      fetched.forEach((s) => {
        if (s) shipMap.set(s.tracking_id, s);
      });
    }
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
    if (!branchId || !plan) return;
    setApplying(true);
    setError("");
    try {
      // Solo enviar la sección del tab activo; la otra queda con array vacío
      // para que el backend no toque esos envíos.
      const tabPlan: typeof plan =
        activeTab === "last_mile"
          ? { ...plan, inter_branch: [] }
          : { ...plan, last_mile: [] };
      const resp = await routingApi.apply(branchId, { plan: tabPlan });
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

  const handleApplyWithReorder = async (vehicleId: string, orderedTids: string[], routeMode?: import("../api/routing").RouteMode) => {
    if (!plan || !branchId) return;
    setApplying(true);
    setError("");
    try {
      const editedPlan = clonePlan(plan);
      const asgmt = editedPlan.last_mile.find((a) => a.vehicle_id === vehicleId);
      if (asgmt) {
        asgmt.shipments = orderedTids;
        if (routeMode) asgmt.route_mode = routeMode;
      }
      await routingApi.apply(branchId, { vehicleId, plan: editedPlan });
      setEditingStopsVehicleId(null);
      await loadTodayPlan();
      setSuccess("Ruta aplicada.");
      setTimeout(() => setSuccess(""), 2500);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo aplicar la ruta.";
      setError(msg);
      throw err;
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
    if (target.kind === "driver") validation = validateMoveToLastMileVehicle(plan, target.id, sh);
    else if (target.kind === "vehicle") validation = validateMoveToVehicle(plan, target.id, sh);
    if (validation) return { ok: false, error: validation.message };

    // Mutar el plan
    let next = removeFromSource(plan, source, trackingId);

    if (target.kind === "driver") {
      // target.id is now a vehicle_id for last-mile assignments
      const existing = next.last_mile.find((a) => a.vehicle_id === target.id);
      if (existing) {
        existing.shipments.push(trackingId);
      } else {
        const load = next.vehicle_loads.find((l) => l.vehicle_id === target.id);
        const created: LastMileAssignment = {
          vehicle_id: target.id,
          license_plate: load?.license_plate ?? target.id,
          capacity_kg: load?.capacity_kg ?? 0,
          shipments: [trackingId],
          total_weight_kg: 0,
          existing_weight_kg: load?.existing_weight_kg ?? 0,
          existing_shipments: load?.existing_shipments ?? [],
        };
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

  // unassignShipment quita un envío de su asignación actual (chofer o vehículo)
  // y lo manda a "Sin asignar". Lo usa el botón ✕ del chip — no requiere drag.
  const unassignShipment = (trackingId: string) => {
    if (!plan) return;
    const source = findSource(plan, trackingId);
    if (!source || source.kind === "unassigned") return;
    const result = executeMove(trackingId, source, { kind: "unassigned" });
    if (!result.ok) {
      showDropError(result.error);
    }
  };

  // Multi-hop: abre el modal "Agregar parada" para el dispatch del vehículo.
  const openAddStop = (vehicleId: string) => {
    setAddStopVehicleId(vehicleId);
    setAddStopBranchId("");
    setAddStopShipments(new Set());
  };
  const closeAddStop = () => {
    setAddStopVehicleId(null);
    setAddStopBranchId("");
    setAddStopShipments(new Set());
  };

  // Confirma la nueva parada: agrega el AssignmentStop al dispatch del vehículo
  // y mueve los envíos seleccionados desde la parada de la que vinieran.
  const saveAddStop = () => {
    if (!plan || !addStopVehicleId || !addStopBranchId || addStopShipments.size === 0) return;
    const next = clonePlan(plan);
    const dispatch = next.inter_branch.find((d) => d.vehicle_id === addStopVehicleId);
    if (!dispatch) return closeAddStop();
    // Sacar los envíos seleccionados de cualquier otra parada adicional donde estuvieran
    if (dispatch.additional_stops) {
      dispatch.additional_stops = dispatch.additional_stops
        .map((st) => ({ ...st, shipments: st.shipments.filter((tid) => !addStopShipments.has(tid)) }))
        .filter((st) => st.shipments.length > 0);
    }
    // Calcular peso de la nueva parada
    const selected = Array.from(addStopShipments);
    const weight = selected.reduce((sum, tid) => sum + (shipments.get(tid)?.weight_kg ?? 0), 0);
    dispatch.additional_stops = [
      ...(dispatch.additional_stops ?? []),
      { branch_id: addStopBranchId, shipments: selected, total_weight_kg: Math.round(weight * 10) / 10 },
    ];
    setPlan(next);
    closeAddStop();
  };

  // Quita una parada adicional: sus envíos vuelven a la parada primaria.
  const removeStop = (vehicleId: string, stopIndex: number) => {
    if (!plan) return;
    const next = clonePlan(plan);
    const dispatch = next.inter_branch.find((d) => d.vehicle_id === vehicleId);
    if (!dispatch || !dispatch.additional_stops || stopIndex >= dispatch.additional_stops.length) return;
    // Los envíos vuelven implícitamente a la parada primaria (siguen en dispatch.shipments)
    dispatch.additional_stops = dispatch.additional_stops.filter((_, idx) => idx !== stopIndex);
    if (dispatch.additional_stops.length === 0) dispatch.additional_stops = undefined;
    setPlan(next);
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
    if (target.kind === "driver") return validateMoveToLastMileVehicle(plan, target.id, sh) === null;
    if (target.kind === "vehicle") return validateMoveToVehicle(plan, target.id, sh) === null;
    return true;
  };

  // rejectionReason devuelve el motivo por el cual un target rechaza el drop
  // activo, o null si lo aceptaría. Se usa para mostrar tooltip en las tarjetas
  // grises durante un drag — el operador entiende por qué no acepta.
  const rejectionReason = (target: MoveTarget): string | null => {
    if (!dragging || !plan) return null;
    if (target.kind === "driver" && !dragging.isLastMile) {
      return "Este envío necesita transporte a otra sucursal — no se puede asignar a un chofer.";
    }
    if (target.kind === "vehicle" && dragging.isLastMile) {
      return "Este envío ya está en su sucursal final — corresponde asignarlo a un chofer.";
    }
    if (target.kind === "driver" && dragging.source.kind === "driver" && dragging.source.id === target.id) return null;
    if (target.kind === "vehicle" && dragging.source.kind === "vehicle" && dragging.source.id === target.id) return null;
    const sh = shipments.get(dragging.trackingId);
    if (!sh) return "Información del envío no disponible.";
    if (target.kind === "driver") {
      const err = validateMoveToLastMileVehicle(plan, target.id, sh);
      return err?.message ?? null;
    }
    if (target.kind === "vehicle") {
      const err = validateMoveToVehicle(plan, target.id, sh);
      return err?.message ?? null;
    }
    return null;
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

  const isDirty = plan != null && originalPlan != null && JSON.stringify(plan) !== JSON.stringify(originalPlan);

  const totals = useMemo(() => {
    if (!plan) return null;
    const pendingInAsgmt = (assignments: { shipments: string[]; applied_shipments?: string[] }[]) =>
      assignments.reduce((n, a) => {
        const done = new Set(a.applied_shipments ?? []);
        return n + a.shipments.filter((t) => !done.has(t)).length;
      }, 0);
    const appliedInAsgmt = (assignments: { applied_shipments?: string[] }[]) =>
      assignments.reduce((n, a) => n + (a.applied_shipments?.length ?? 0), 0);

    const lastMileApplied = appliedInAsgmt(plan.last_mile);
    const lastMilePending = pendingInAsgmt(plan.last_mile);
    const interBranchApplied = appliedInAsgmt(plan.inter_branch);
    const interBranchPending = pendingInAsgmt(plan.inter_branch);
    const awaitingConsolidation = plan.unassigned.filter(
      (u) => u.reason === "esperando_consolidacion",
    ).length;
    const otherUnassigned = plan.unassigned.length - awaitingConsolidation;
    return {
      lastMileApplied,
      lastMilePending,
      interBranchApplied,
      interBranchPending,
      otherUnassigned,
      awaitingConsolidation,
      dispatches: plan.inter_branch.length,
    };
  }, [plan]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Ruteo del día"
        description={
          globalPlan
            ? undefined
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
            {canRegenerate && !isForecast && (
              <button
                onClick={handleRegenerate}
                disabled={loading || applying}
                className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                Regenerar plan
              </button>
            )}
            {canApply && !isForecast && (
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

      {/* Selector de día del horizonte */}
      {horizonPlans.length > 1 && (
        <div className="flex items-center gap-1 mb-4">
          {horizonPlans.map((hp, idx) => {
            // Parseo manual YYYY-MM-DD para evitar NaN en algunos browsers/locales
            // cuando se usa `new Date(str + "T12:00:00")`.
            const [, m, d] = (hp.plan_date ?? "").split("-").map(Number);
            const dayLabel = idx === 0
              ? "Hoy"
              : Number.isFinite(d)
              ? `${idx === 1 ? "Mañana " : ""}${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`
              : hp.plan_date;
            const isSelected = horizonDayIndex === idx;
            return (
              <button
                key={hp.plan_date}
                onClick={() => void loadHorizonDay(idx)}
                className={`h-9 px-4 rounded-lg text-sm font-semibold transition-colors cursor-pointer border ${
                  isSelected
                    ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {dayLabel}
                {hp.is_forecast && (
                  <span className="ml-1.5 text-[10px] opacity-70">pronóstico</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Banner de pronóstico (días +1/+2) */}
      {isForecast && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <span className="text-base">📅</span>
          <div>
            <span className="font-semibold">Pronóstico — no aplicable.</span>
            {" "}Este plan simula la disponibilidad de flota y envíos para el día {horizonPlans[horizonDayIndex]?.plan_date}.
            Los despachos se generan según los vehículos que se esperan libres ese día. Regenerado automáticamente a las 08:00.
          </div>
        </div>
      )}

      {/* Selector de sucursal para manager/admin */}
      {isNetworkRole && globalPlan && globalPlan.branch_plans.length > 0 && (
        <Card className="mb-4 p-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Sucursal:</label>
            <select
              value={selectedBranchId}
              onChange={(e) => {
                const newBranch = e.target.value;
                setSelectedBranchId(newBranch);
                const bp = globalPlan.branch_plans.find((b) => b.branch_id === newBranch);
                if (bp) void applyBranchPlan(bp.plan);
              }}
              className="h-9 px-3 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            >
              {globalPlan.branch_plans.map((bp) => (
                <option key={bp.branch_id} value={bp.branch_id}>
                  {branches.find((b) => b.id === bp.branch_id)?.name ?? bp.branch_id}
                </option>
              ))}
            </select>
            <span className="ml-auto text-xs text-slate-500">
              Como manager/admin podés ver el plan de cualquier sucursal.
            </span>
          </div>
        </Card>
      )}

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
          {canRegenerate && !isForecast && (
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
          {(() => {
            const pendingLastMile = plan.last_mile.filter((a) => !a.in_transit);
            const inProgressLastMile = plan.last_mile.filter((a) => a.in_transit);
            const pendingInterBranch = plan.inter_branch.filter((a) => !a.in_transit);
            const inProgressInterBranch = plan.inter_branch.filter((a) => a.in_transit);
            const inProgressLastMileIds = inProgressLastMile.map((a) => a.vehicle_id);
            const inProgressVehicleIds = inProgressInterBranch.map((a) => a.vehicle_id);

            // Particionar "Sin asignar" por tipo de envío. Usamos la lógica
            // canónica de isLastMileShipment cuando el shipment está cargado;
            // como fallback (envío no encontrado en la map), si la unassigned
            // viene con destination vacío la consideramos última milla.
            const lastMileUnassigned = plan.unassigned.filter((u) => {
              const sh = shipments.get(u.tracking_id);
              return sh ? isLastMileShipment(sh, branchId) : !u.destination;
            });
            const interBranchUnassigned = plan.unassigned.filter(
              (u) => !lastMileUnassigned.some((x) => x.tracking_id === u.tracking_id),
            );

            // Badge = envíos pendientes de aplicar:
            //   - Los "sin asignar" (no tienen chofer/vehículo todavía).
            //   - Los que están en una asignación pero no figuran en
            //     applied_shipments (typicamente: drag-and-drop manual o
            //     plan recién generado sin aplicar).
            // Los envíos ya aplicados al backend no se cuentan.
            const countPendingApply = (
              assignments: { shipments: string[]; applied_shipments?: string[] }[],
            ): number =>
              assignments.reduce((sum, a) => {
                const applied = new Set(a.applied_shipments ?? []);
                return sum + a.shipments.filter((t) => !applied.has(t)).length;
              }, 0);

            const lastMileBadge =
              lastMileUnassigned.length + countPendingApply(plan.last_mile);
            const interBranchBadge =
              interBranchUnassigned.length + countPendingApply(plan.inter_branch);

            // Si hay un drag activo cuya fuente no es "sin asignar" y la pestaña
            // activa no tiene sección de Sin asignar visible para su tipo,
            // mostramos un drop-zone flotante.
            const tabUnassigned = activeTab === "last_mile" ? lastMileUnassigned : interBranchUnassigned;
            const showFloatingDropZone =
              !!dragging &&
              dragging.source.kind !== "unassigned" &&
              tabUnassigned.length === 0 &&
              // Solo mostramos la drop-zone flotante si el drag pertenece a
              // esta pestaña — si el operador arrastra un envío de última
              // milla mientras la pestaña inter-sucursal está activa, no
              // tiene sentido ofrecerle desasignar acá.
              dragging.isLastMile === (activeTab === "last_mile");

            return (
              <>
                {/* Tabs: solo se muestran cuando NO hay mode forzado por la prop. */}
                {!mode && (
                  <div className="flex gap-1 border-b border-slate-200 mb-5">
                    <TabButton
                      label="Última milla"
                      icon={<UserIcon className="w-4 h-4" />}
                      badge={lastMileBadge}
                      active={activeTab === "last_mile"}
                      onClick={() => setActiveTab("last_mile")}
                    />
                    <TabButton
                      label="Inter-sucursal"
                      icon={<Truck className="w-4 h-4" />}
                      badge={interBranchBadge}
                      active={activeTab === "inter_branch"}
                      onClick={() => setActiveTab("inter_branch")}
                    />
                  </div>
                )}

                {showFloatingDropZone && (
                  <UnassignedDropZone
                    onDrop={() => handleDrop(dragging!.trackingId, dragging!.source, { kind: "unassigned" })}
                  />
                )}

                {activeTab === "last_mile" && (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <SummaryChip label="Confirmados" value={totals.lastMileApplied} />
                      <SummaryChip label="Por confirmar" value={totals.lastMilePending} tone={totals.lastMilePending > 0 ? "warning" : "neutral"} />
                      <SummaryChip label="Sin asignar" value={lastMileUnassigned.length} tone={lastMileUnassigned.length > 0 ? "warning" : "neutral"} />
                    </div>
                    {lastMileUnassigned.length > 0 && (
                      <UnassignedSection
                        unassigned={lastMileUnassigned}
                        branches={branches}
                        shipments={shipments}
                        onView={openInfo}
                        dragging={dragging}
                        canAccept={canApply && canAcceptDrop({ kind: "unassigned" })}
                        onDragStart={canApply ? beginDrag : undefined}
                        onDragEnd={canApply ? endDrag : undefined}
                        onDropHere={canApply ? () => dragging && handleDrop(dragging.trackingId, dragging.source, { kind: "unassigned" }) : undefined}
                        showDestination={false}
                      />
                    )}

                    {pendingLastMile.length > 0 && (
                      <LastMileSection
                        assignments={pendingLastMile}
                        excludedVehicleIds={inProgressLastMileIds}
                        vehicleLoads={plan.vehicle_loads.filter((v) => v.mode === "ultima_milla")}
                        shipments={shipments}
                        onView={openInfo}
                        dragging={dragging}
                        canAcceptVehicle={(vehicleId) => canApply && canAcceptDrop({ kind: "driver", id: vehicleId })}
                        onDragStart={canApply ? beginDrag : undefined}
                        onDragEnd={canApply ? endDrag : undefined}
                        onDropVehicle={canApply ? (vehicleId) => dragging && handleDrop(dragging.trackingId, dragging.source, { kind: "driver", id: vehicleId }) : undefined}
                        onEditStops={canApply ? (vehicleId) => setEditingStopsVehicleId(vehicleId) : undefined}
                        onRemoveShipment={canApply ? unassignShipment : undefined}
                        applying={applying}
                      />
                    )}

                    {inProgressLastMile.length > 0 && (
                      <OutgoingInProgressSection
                        lastMile={inProgressLastMile}
                        interBranch={[]}
                        branches={branches}
                        shipments={shipments}
                        onView={openInfo}
                      />
                    )}

                    {lastMileUnassigned.length === 0 &&
                      pendingLastMile.length === 0 &&
                      inProgressLastMile.length === 0 && (
                        <Card className="p-10 text-center">
                          <p className="text-sm text-slate-500">
                            No hay envíos de última milla para rutear desde esta sucursal en este momento.
                          </p>
                        </Card>
                      )}
                  </>
                )}

                {activeTab === "inter_branch" && (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <SummaryChip label="Confirmados" value={totals.interBranchApplied} />
                      <SummaryChip label="Por confirmar" value={totals.interBranchPending} tone={totals.interBranchPending > 0 ? "warning" : "neutral"} />
                      <SummaryChip label="Sin asignar" value={interBranchUnassigned.length} tone={interBranchUnassigned.length > 0 ? "warning" : "neutral"} />
                    </div>
                    {interBranchUnassigned.length > 0 && (
                      <UnassignedSection
                        unassigned={interBranchUnassigned}
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

                    {(pendingInterBranch.length > 0 || plan.vehicle_loads.length > 0) && (
                      <InterBranchSection
                        assignments={pendingInterBranch}
                        originBranchId={branchId}
                        excludedVehicleIds={inProgressVehicleIds}
                        vehicleLoads={plan.vehicle_loads.filter((v) => v.mode === "inter_sucursal")}
                        branches={branches}
                        shipments={shipments}
                        configSnapshot={plan.config_snapshot}
                        onView={openInfo}
                        dragging={dragging}
                        canAcceptVehicle={(vehicleId) => canApply && canAcceptDrop({ kind: "vehicle", id: vehicleId })}
                        vehicleRejectionReason={(vehicleId) => rejectionReason({ kind: "vehicle", id: vehicleId })}
                        onDragStart={canApply ? beginDrag : undefined}
                        onDragEnd={canApply ? endDrag : undefined}
                        onDropVehicle={canApply ? (vehicleId) => dragging && handleDrop(dragging.trackingId, dragging.source, { kind: "vehicle", id: vehicleId }) : undefined}
                        onApplyVehicle={canApply ? (vehicleId) => setReviewingDispatchVehicleId(vehicleId) : undefined}
                        onRemoveShipment={canApply ? unassignShipment : undefined}
                        onAddStop={canApply ? openAddStop : undefined}
                        onRemoveStop={canApply ? removeStop : undefined}
                        applying={applying}
                      />
                    )}

                    {inProgressInterBranch.length > 0 && (
                      <OutgoingInProgressSection
                        lastMile={[]}
                        interBranch={inProgressInterBranch}
                        branches={branches}
                        shipments={shipments}
                        onView={openInfo}
                      />
                    )}

                    {(plan.incoming_vehicles?.length ?? 0) > 0 && (
                      <IncomingVehiclesSection
                        vehicles={plan.incoming_vehicles!}
                        branches={branches}
                        shipments={shipments}
                        onView={openInfo}
                      />
                    )}

                    {interBranchUnassigned.length === 0 &&
                      pendingInterBranch.length === 0 &&
                      inProgressInterBranch.length === 0 &&
                      plan.vehicle_loads.length === 0 &&
                      (plan.incoming_vehicles?.length ?? 0) === 0 && (
                        <Card className="p-10 text-center">
                          <p className="text-sm text-slate-500">
                            No hay envíos inter-sucursal para rutear desde esta sucursal en este momento.
                          </p>
                        </Card>
                      )}
                  </>
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

      {editingStopsVehicleId && plan && (() => {
        const assignment = plan.last_mile.find((a) => a.vehicle_id === editingStopsVehicleId);
        if (!assignment) return null;
        const branch = branches.find((b) => b.id === branchId);
        const branchCoords =
          branch?.latitude != null && branch?.longitude != null
            ? { lat: branch.latitude, lng: branch.longitude }
            : null;
        return (
          <EditDriverStopsModal
            assignment={assignment}
            shipmentMap={shipments}
            branchCoords={branchCoords}
            config={plan.config_snapshot}
            onClose={() => setEditingStopsVehicleId(null)}
            onApply={(orderedTids, routeMode) => handleApplyWithReorder(editingStopsVehicleId, orderedTids, routeMode)}
          />
        );
      })()}

      {/* Modal: Revisar despacho inter-sucursal */}
      {reviewingDispatchVehicleId && plan && (() => {
        const assignment = plan.inter_branch.find((a) => a.vehicle_id === reviewingDispatchVehicleId);
        if (!assignment) return null;
        return (
          <ReviewInterBranchModal
            assignment={assignment}
            originBranchId={branchId}
            branches={branches}
            shipments={shipments}
            applying={applying}
            onClose={() => setReviewingDispatchVehicleId(null)}
            onConfirm={(editedStops, departureMin) => {
              const vehicleId = reviewingDispatchVehicleId;
              setReviewingDispatchVehicleId(null);
              if (!plan || !branchId) return;
              // Construir el plan editado con paradas + salida modificada. Cambiar la
              // salida desplaza todos los arribos por el mismo delta (los tramos no cambian).
              const editedPlan = clonePlan(plan);
              const d = editedPlan.inter_branch.find((x) => x.vehicle_id === vehicleId);
              if (d) {
                // Ancla del plan para desplazar los arribos (los tramos no cambian).
                const origDep = d.estimated_departure_min ?? 8 * 60;
                const dlt = departureMin - origDep;
                const shiftMin = (m?: number) => (m && m > 0 ? m + dlt : m);
                d.additional_stops = editedStops.length > 0
                  ? editedStops.map((s) => ({ ...s, estimated_arrival_min: shiftMin(s.estimated_arrival_min) }))
                  : undefined;
                // La salida siempre se setea (default = ahora + 30 min, anclada al apply).
                d.estimated_departure_min = departureMin;
                d.primary_estimated_arrival_min = shiftMin(d.primary_estimated_arrival_min);
                d.estimated_arrival_min = shiftMin(d.estimated_arrival_min);
              }
              setPlan(editedPlan);
              setApplying(true);
              setError("");
              void (async () => {
                try {
                  await routingApi.apply(branchId, { vehicleId, plan: editedPlan });
                  await loadTodayPlan();
                  setSuccess("Despacho aplicado.");
                  setTimeout(() => setSuccess(""), 2500);
                } catch (err: unknown) {
                  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
                    ?? "No se pudo aplicar el despacho.";
                  setError(msg);
                } finally {
                  setApplying(false);
                }
              })();
            }}
          />
        );
      })()}

      {/* Modal: Agregar parada al despacho multi-hop */}
      {addStopVehicleId && plan && (() => {
        const dispatch = plan.inter_branch.find((d) => d.vehicle_id === addStopVehicleId);
        if (!dispatch) return null;
        // Sucursales disponibles: activas, distintas a la sucursal actual del operador,
        // distintas al destino primario, y no usadas como paradas adicionales.
        const usedBranches = new Set<string>([branchId, dispatch.destination_branch, ...(dispatch.additional_stops?.map((s) => s.branch_id) ?? [])]);
        const candidateBranches = branches.filter((b) => b.status === "activo" && !usedBranches.has(b.id));
        const appliedSet = new Set(dispatch.applied_shipments ?? []);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={closeAddStop}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Agregar parada</h3>
                <button onClick={closeAddStop} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sucursal de destino</label>
                  <select
                    value={addStopBranchId}
                    onChange={(e) => setAddStopBranchId(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                  >
                    <option value="">— Elegí una sucursal —</option>
                    {candidateBranches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  {candidateBranches.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1">No hay sucursales disponibles para agregar.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Envíos que se entregan en esta parada
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Tildá los envíos que deben bajar en la nueva parada. El resto sigue en la parada primaria u otras existentes.
                  </p>
                  <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-md">
                    {dispatch.shipments.map((tid) => {
                      const sh = shipments.get(tid);
                      const isApplied = appliedSet.has(tid);
                      const dest = sh?.is_returning ? sh.origin_branch_id : sh?.final_branch_id;
                      const destLabel = dest ? branchLabelById(dest, branches) : "—";
                      return (
                        <label
                          key={tid}
                          className={`flex items-center gap-2 px-3 py-2 border-b border-slate-100 last:border-0 text-xs ${isApplied ? "opacity-50" : "hover:bg-slate-50 cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            checked={addStopShipments.has(tid)}
                            disabled={isApplied}
                            onChange={(e) => {
                              const next = new Set(addStopShipments);
                              if (e.target.checked) next.add(tid); else next.delete(tid);
                              setAddStopShipments(next);
                            }}
                          />
                          <span className="font-mono text-slate-700">{tid}</span>
                          <span className="text-slate-500">→ {destLabel}</span>
                          {sh && <span className="ml-auto text-slate-400 tabular-nums">{sh.weight_kg.toFixed(1)} kg</span>}
                          {isApplied && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">aplicado</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  onClick={closeAddStop}
                  className="h-9 px-3 rounded-md text-sm text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveAddStop}
                  disabled={!addStopBranchId || addStopShipments.size === 0}
                  className="h-9 px-4 rounded-md text-sm font-semibold bg-[#1e3a5f] hover:bg-[#15294a] disabled:opacity-40 text-white cursor-pointer"
                >
                  Agregar parada
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function TabButton({
  label,
  icon,
  badge,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  badge: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 text-sm font-semibold transition-colors cursor-pointer ${
        active
          ? "border-[#1e3a5f] text-[#1e3a5f]"
          : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge > 0 && (
        <span
          className={`ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold tabular-nums ${
            active ? "bg-[#1e3a5f] text-white" : "bg-slate-200 text-slate-700"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

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
  onRemove,
  extra,
  tooltip,
}: {
  trackingId: string;
  shipment: Shipment | undefined;
  onView?: (trackingId: string) => void;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  onRemove?: (trackingId: string) => void;
  extra?: React.ReactNode;
  tooltip?: string;
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
      title={tooltip}
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
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(trackingId);
          }}
          title="Quitar del despacho"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
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
  showDestination = true,
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
  showDestination?: boolean;
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
          El algoritmo no pudo asignar estos envíos. Podés arrastrarlos manualmente hasta el chofer o vehículo correspondiente.
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
                  tooltip={`Motivo: ${reasonLabel(u.reason)}`}
                  extra={
                    showDestination && u.destination ? (
                      <span className="text-xs text-slate-500 truncate">
                        → {branchLabelById(u.destination, branches)}
                      </span>
                    ) : undefined
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
// no hay sección "Sin asignar" en el plan. Permanece visible durante todo el
// drag — la limpieza del state la hace el onDragEnd de la chip de origen.
// Sticky en el tope del viewport para que esté siempre accesible aunque el
// usuario haya scrolleado dentro de la sección.
function UnassignedDropZone({ onDrop }: { onDrop: () => void }) {
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
      className="sticky top-2 z-30 mb-5 px-4 py-4 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 text-center text-sm text-amber-900 font-semibold shadow-sm"
    >
      Soltá acá para mover el envío a "Sin asignar"
    </div>
  );
}

function LastMileSection({
  assignments,
  excludedVehicleIds,
  vehicleLoads,
  shipments,
  onView,
  dragging,
  canAcceptVehicle,
  onDragStart,
  onDragEnd,
  onDropVehicle,
  onEditStops,
  onRemoveShipment,
  applying,
}: {
  assignments: LastMileAssignment[];
  excludedVehicleIds: string[];
  vehicleLoads: VehicleLoad[];
  shipments: Map<string, Shipment>;
  onView?: (trackingId: string) => void;
  dragging: DragState | null;
  canAcceptVehicle?: (vehicleId: string) => boolean;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  onDropVehicle?: (vehicleId: string) => void;
  onEditStops?: (vehicleId: string) => void;
  onRemoveShipment?: (trackingId: string) => void;
  applying?: boolean;
}) {
  const assignedIds = new Set([...assignments.map((a) => a.vehicle_id), ...excludedVehicleIds]);
  const poolVehicles = vehicleLoads.filter((v) => !assignedIds.has(v.vehicle_id));

  return (
    <Card className="mb-5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-slate-700" />
          <CardTitle>Última milla</CardTitle>
        </div>
        <CardDescription>Envíos asignados a vehículos de última milla. El chofer escanea el QR del vehículo para reclamar el viaje e iniciarlo.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {assignments.map((a) => (
          <DriverRouteCard
            key={a.vehicle_id}
            assignment={a}
            driverName={a.license_plate}
            shipments={shipments}
            onView={onView}
            dragActive={!!dragging}
            canAccept={canAcceptVehicle?.(a.vehicle_id) ?? false}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDropHere={() => onDropVehicle?.(a.vehicle_id)}
            onEditStops={!a.in_transit && hasPendingShipments(a) && onEditStops ? () => onEditStops(a.vehicle_id) : undefined}
            onRemoveShipment={!a.in_transit ? onRemoveShipment : undefined}
            applying={applying}
          />
        ))}
        {poolVehicles.map((v) => (
          <PoolDropCard
            key={v.vehicle_id}
            label={v.license_plate}
            sublabel={`Capacidad: ${v.capacity_kg.toFixed(0)} kg · Carga actual: ${v.existing_weight_kg.toFixed(1)} kg`}
            dragActive={!!dragging}
            canAccept={canAcceptVehicle?.(v.vehicle_id) ?? false}
            onDropHere={() => onDropVehicle?.(v.vehicle_id)}
          />
        ))}
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
  rejectionReason,
  onDropHere,
}: {
  label: string;
  sublabel: string;
  dragActive: boolean;
  canAccept: boolean;
  rejectionReason?: string | null;
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
      title={dragActive && !canAccept && rejectionReason ? rejectionReason : undefined}
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
      {dragActive && !canAccept && rejectionReason && (
        <div className="mt-1 text-[11px] text-slate-500">{rejectionReason}</div>
      )}
    </div>
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
  onEditStops,
  onRemoveShipment,
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
  onEditStops?: () => void;
  onRemoveShipment?: (trackingId: string) => void;
  applying?: boolean;
}) {
  const a = assignment;
  const appliedSet = new Set(a.applied_shipments ?? []);
  const totalCount = a.shipments.length;
  const totalWeight = a.total_weight_kg + a.existing_weight_kg;
  const utilPct = a.capacity_kg > 0 ? Math.round((totalWeight / a.capacity_kg) * 100) : 0;

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
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
          <span>{driverName}</span>
          {assignment.suggested_departure_min != null && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Salida sugerida: {String(Math.floor(assignment.suggested_departure_min / 60)).padStart(2, "0")}:{String(assignment.suggested_departure_min % 60).padStart(2, "0")}
            </span>
          )}
          {assignment.in_transit && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
              🚚 En viaje
            </span>
          )}
          {!assignment.in_transit && assignment.applied && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
              ✓ Aplicado
            </span>
          )}
          {!assignment.in_transit && !assignment.applied && (assignment.applied_shipments?.length ?? 0) > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              Parcial · {assignment.applied_shipments?.length}/{assignment.shipments.length}
            </span>
          )}
          {!assignment.in_transit && assignment.applied && hasPendingShipments(assignment) && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              + {assignment.shipments.length - (assignment.applied_shipments?.length ?? 0)} sin aplicar
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasPendingShipments(assignment) && onEditStops && (
            <button
              onClick={onEditStops}
              disabled={applying}
              className="text-xs px-2 py-0.5 rounded-md bg-[#1e3a5f] hover:bg-[#15294a] disabled:opacity-40 text-white font-semibold transition-colors cursor-pointer"
            >
              Aplicar
            </button>
          )}
        </div>
      </div>
      <div className="text-xs text-slate-500 tabular-nums mb-2">
        {totalCount} envíos · {totalWeight.toFixed(1)} / {a.capacity_kg} kg ({utilPct}%)
        {a.existing_weight_kg > 0 && (
          <span className="ml-1 text-[11px] text-slate-400">
            (incluye {a.existing_weight_kg.toFixed(1)} kg ya cargados)
          </span>
        )}
      </div>

      {(
        <div className="grid gap-2">
          {a.shipments.map((tid) => (
            <ShipmentChip
              key={tid}
              trackingId={tid}
              shipment={shipments.get(tid)}
              onView={onView}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onRemove={onRemoveShipment && !appliedSet.has(tid) ? onRemoveShipment : undefined}
            />
          ))}
        </div>
      )}

      {a.existing_shipments && a.existing_shipments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-200">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Ya cargados en el vehículo
          </div>
          <div className="grid gap-2">
            {a.existing_shipments.map((tid) => (
              <ExistingShipmentRow
                key={tid}
                trackingId={tid}
                shipment={shipments.get(tid)}
                onView={onView}
                badgeLabel="Cargado"
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


function InterBranchSection({
  assignments,
  originBranchId,
  excludedVehicleIds,
  vehicleLoads,
  branches,
  shipments,
  configSnapshot,
  onView,
  dragging,
  canAcceptVehicle,
  vehicleRejectionReason,
  onDragStart,
  onDragEnd,
  onDropVehicle,
  onApplyVehicle,
  onRemoveShipment,
  onAddStop,
  onRemoveStop,
  applying,
}: {
  assignments: InterBranchAssignment[];
  originBranchId: string;
  excludedVehicleIds: string[];
  vehicleLoads: VehicleLoad[];
  branches: Branch[];
  shipments: Map<string, Shipment>;
  configSnapshot?: RoutingConfig;
  onView?: (trackingId: string) => void;
  dragging: DragState | null;
  canAcceptVehicle?: (vehicleId: string) => boolean;
  vehicleRejectionReason?: (vehicleId: string) => string | null;
  onDragStart?: (e: React.DragEvent, trackingId: string) => void;
  onDragEnd?: () => void;
  onDropVehicle?: (vehicleId: string) => void;
  onApplyVehicle?: (vehicleId: string) => void;
  onRemoveShipment?: (trackingId: string) => void;
  onAddStop?: (vehicleId: string) => void;
  onRemoveStop?: (vehicleId: string, stopIndex: number) => void;
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
          const pickupSet = new Set<string>([
            ...(a.primary_pickup_shipments ?? []),
            ...(a.additional_stops ?? []).flatMap((s) => s.pickup_shipments ?? []),
          ]);
          const pickupWeight = (a.primary_pickup_weight_kg ?? 0) +
            (a.additional_stops ?? []).reduce((sum, st) => sum + (st.pickup_weight_kg ?? 0), 0);
          const originShipmentCount = a.shipments.filter((tid) => !pickupSet.has(tid)).length;
          const totalLoaded = a.total_weight_kg - pickupWeight + a.existing_weight_kg;
          const utilPct = a.capacity_kg > 0 ? Math.round((totalLoaded / a.capacity_kg) * 100) : 0;
          // "bajan en ruta": envíos de origen descargados en paradas intermedias (no la final)
          const additionalStops = a.additional_stops ?? [];
          let bajanCount = 0;
          let bajanWeight = 0;
          if (additionalStops.length > 0) {
            const finalStopSet = new Set(additionalStops[additionalStops.length - 1].shipments);
            const bajanList = a.shipments.filter((tid) => !finalStopSet.has(tid) && !pickupSet.has(tid));
            bajanCount = bajanList.length;
            bajanWeight = bajanList.reduce((sum, tid) => sum + (shipments.get(tid)?.weight_kg ?? 0), 0);
          }
          const netDiff = pickupWeight - bajanWeight;
          const canAccept = canAcceptVehicle?.(a.vehicle_id) ?? false;
          const rejection = dragActive && !canAccept ? vehicleRejectionReason?.(a.vehicle_id) ?? null : null;
          const cardClass = dragActive
            ? canAccept
              ? "rounded-lg border-2 border-emerald-400 ring-2 ring-emerald-200 p-3 bg-emerald-50/40"
              : "rounded-lg border border-slate-200 p-3 bg-slate-50/50 opacity-60"
            : "rounded-lg border border-slate-200 p-3 bg-slate-50/50";
          return (
            <div
              key={a.vehicle_id}
              className={cardClass}
              title={rejection ?? undefined}
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
                  {a.license_plate} · {branchLabelById(originBranchId, branches)} → {branchLabelById(a.destination_branch, branches)}
                  {a.additional_stops?.map((st, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 text-[11px] text-slate-500 group/stop">
                      <span className="text-slate-300">›</span>
                      <span className="font-medium text-slate-700">{branchLabelById(st.branch_id, branches)}</span>
                      {(st.pickup_shipments?.length ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold"
                          title={`Recoger ${st.pickup_shipments?.length} envío(s) (${(st.pickup_weight_kg ?? 0).toFixed(1)} kg) al pasar`}
                        >
                          ↑ {st.pickup_shipments?.length}
                        </span>
                      )}
                      {!a.in_transit && onRemoveStop && (
                        <button
                          type="button"
                          onClick={() => onRemoveStop(a.vehicle_id, idx)}
                          className="opacity-0 group-hover/stop:opacity-100 w-4 h-4 flex items-center justify-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                          title="Quitar parada (los envíos vuelven a la parada anterior)"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {!a.in_transit && onAddStop && (a.additional_stops?.length ?? 0) < 2 && (
                    <button
                      type="button"
                      onClick={() => onAddStop(a.vehicle_id)}
                      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-dashed border-slate-300 text-slate-500 hover:border-violet-400 hover:text-violet-700 hover:bg-violet-50 transition-colors cursor-pointer"
                      title="Agregar parada intermedia (máx. 3)"
                    >
                      + Parada
                    </button>
                  )}
                  {(a.additional_stops?.length ?? 0) > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                      Multi-hop · {1 + (a.additional_stops?.length ?? 0)} paradas
                    </span>
                  )}
                  {a.backhaul && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold" title={`Retorno: ${a.backhaul.shipments.length} envíos · ${a.backhaul.total_weight_kg.toFixed(1)} kg (${a.backhaul.fill_rate_pct.toFixed(0)}% cap.)`}>
                      ↩ Backhaul · {a.backhaul.shipments.length} env.
                    </span>
                  )}
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
                      Aplicar
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs text-slate-500 tabular-nums mb-2">
                {originShipmentCount} envíos · {totalLoaded.toFixed(1)} / {a.capacity_kg} kg ({utilPct}%)
                {(bajanCount > 0 || pickupSet.size > 0) && (
                  <span className="ml-1 text-[11px] text-slate-400">
                    en ruta:{bajanCount > 0 && ` bajan ${bajanCount} (−${bajanWeight.toFixed(1)} kg)`}{bajanCount > 0 && pickupSet.size > 0 && " ·"}{pickupSet.size > 0 && ` suben ${pickupSet.size} (+${pickupWeight.toFixed(1)} kg)`}
                    {" "}({netDiff >= 0 ? `+${netDiff.toFixed(1)}` : `−${Math.abs(netDiff).toFixed(1)}`} kg neto)
                  </span>
                )}
                {a.existing_weight_kg > 0 && (
                  <span className="ml-1 text-[11px] text-slate-400">
                    (incluye {a.existing_weight_kg.toFixed(1)} kg ya cargados)
                  </span>
                )}
              </div>
              <div className="grid gap-2">
                {(() => {
                  const appliedSet = new Set(a.applied_shipments ?? []);
                  // Set de pickups cross-branch: envíos que NO salen de origen,
                  // se levantan en una parada intermedia.
                  const pickupAtStop = new Map<string, string>(); // tid → branch_id donde se recoge
                  a.primary_pickup_shipments?.forEach((t) => pickupAtStop.set(t, a.destination_branch));
                  a.additional_stops?.forEach((st) => {
                    st.pickup_shipments?.forEach((t) => pickupAtStop.set(t, st.branch_id));
                  });
                  return a.shipments.map((tid) => {
                  const sh = shipments.get(tid);
                  const realTarget = sh?.is_returning ? sh?.origin_branch_id : sh?.final_branch_id;
                  const pickupBranch = pickupAtStop.get(tid);
                  const isCrossBranchPickup = !!pickupBranch;
                  const isPartialTransit = !isCrossBranchPickup && !!realTarget && realTarget !== a.destination_branch;
                  const canRemove = onRemoveShipment && !a.in_transit && !appliedSet.has(tid);

                  let slaTag: React.ReactNode = null;
                  if (a.rule === "sla_forced" && sh && configSnapshot) {
                    const isSlaUrgent =
                      sh.estimated_delivery_at != null &&
                      (new Date(sh.estimated_delivery_at).getTime() - Date.now()) / 3600000 <
                        configSnapshot.sla_force_horizon_hours;
                    const isPriorityForced =
                      sh.priority_score != null &&
                      sh.priority_score >= configSnapshot.priority_force_threshold;
                    if (isSlaUrgent) {
                      slaTag = (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium shrink-0">
                          <Clock className="w-3 h-3" />
                          SLA crítico
                        </span>
                      );
                    } else if (isPriorityForced) {
                      slaTag = (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium shrink-0">
                          <AlertTriangle className="w-3 h-3" />
                          Prioridad forzada
                        </span>
                      );
                    }
                  }

                  return (
                    <ShipmentChip
                      key={tid}
                      trackingId={tid}
                      shipment={sh}
                      onView={onView}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onRemove={canRemove ? onRemoveShipment : undefined}
                      extra={
                        <>
                          {slaTag}
                          {isCrossBranchPickup && pickupBranch && realTarget && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 truncate inline-flex items-center gap-1"
                              title={`Será recogido en ${branchLabelById(pickupBranch, branches)} al pasar el camión y entregado en ${branchLabelById(realTarget, branches)}`}
                            >
                              ↑ Por recoger en {branchLabelById(pickupBranch, branches)}
                            </span>
                          )}
                          {isPartialTransit && realTarget && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 truncate">
                              Tránsito parcial → {branchLabelById(realTarget, branches)}
                            </span>
                          )}
                        </>
                      }
                    />
                  );
                });
                })()}
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
        {poolVehicles.map((v) => {
          const accepts = canAcceptVehicle?.(v.vehicle_id) ?? false;
          const reason = !accepts ? vehicleRejectionReason?.(v.vehicle_id) ?? null : null;
          return (
            <PoolDropCard
              key={v.vehicle_id}
              label={v.license_plate}
              sublabel={`Disponible · ${v.existing_weight_kg.toFixed(1)} / ${v.capacity_kg} kg`}
              dragActive={!!dragging}
              canAccept={accepts}
              rejectionReason={reason}
              onDropHere={onDropVehicle ? () => onDropVehicle(v.vehicle_id) : undefined}
            />
          );
        })}
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
  branches,
  shipments,
  onView,
}: {
  lastMile: LastMileAssignment[];
  interBranch: InterBranchAssignment[];
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
          Vehículos que ya iniciaron viaje desde esta sucursal. Solo informativo — no se puede modificar la asignación.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        {lastMile.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Vehículos de última milla en viaje
            </div>
            <div className="grid gap-3">
              {lastMile.map((a) => {
                const allShipments = [
                  ...a.shipments,
                  ...(a.existing_shipments ?? []).filter((t) => !a.shipments.includes(t)),
                ];
                const totalCount = allShipments.length;
                const totalWeight = a.total_weight_kg + a.existing_weight_kg;
                return (
                  <div key={a.vehicle_id} className="rounded-lg border border-sky-200 p-3 bg-sky-50/40">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                        <Truck className="w-3.5 h-3.5 text-slate-500" />
                        <span>{a.license_plate}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                          🚚 En viaje
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
                const pickupSetG = new Set<string>([
                  ...(a.primary_pickup_shipments ?? []),
                  ...(a.additional_stops ?? []).flatMap((s) => s.pickup_shipments ?? []),
                ]);
                const pickupWeightG = (a.primary_pickup_weight_kg ?? 0) +
                  (a.additional_stops ?? []).reduce((sum, st) => sum + (st.pickup_weight_kg ?? 0), 0);
                const totalLoaded = a.total_weight_kg - pickupWeightG + a.existing_weight_kg;
                const utilPct = a.capacity_kg > 0 ? Math.round((totalLoaded / a.capacity_kg) * 100) : 0;
                const allShipments = [
                  ...a.shipments,
                  ...(a.existing_shipments ?? []).filter((t) => !a.shipments.includes(t)),
                ];
                const originShipmentCountG = allShipments.filter((t) => !pickupSetG.has(t)).length;
                const additionalStopsG = a.additional_stops ?? [];
                let bajanCountG = 0;
                let bajanWeightG = 0;
                if (additionalStopsG.length > 0) {
                  const finalStopSetG = new Set(additionalStopsG[additionalStopsG.length - 1].shipments);
                  const bajanListG = a.shipments.filter((tid) => !finalStopSetG.has(tid) && !pickupSetG.has(tid));
                  bajanCountG = bajanListG.length;
                  bajanWeightG = bajanListG.reduce((sum, tid) => sum + (shipments.get(tid)?.weight_kg ?? 0), 0);
                }
                const netDiffG = pickupWeightG - bajanWeightG;
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
                        {originShipmentCountG} envíos · {totalLoaded.toFixed(1)} / {a.capacity_kg} kg ({utilPct}%)
                        {(bajanCountG > 0 || pickupSetG.size > 0) && (
                          <span className="ml-1 text-[11px] text-slate-400">
                            en ruta:{bajanCountG > 0 && ` bajan ${bajanCountG} (−${bajanWeightG.toFixed(1)} kg)`}{bajanCountG > 0 && pickupSetG.size > 0 && " ·"}{pickupSetG.size > 0 && ` suben ${pickupSetG.size} (+${pickupWeightG.toFixed(1)} kg)`}
                            {" "}({netDiffG >= 0 ? `+${netDiffG.toFixed(1)}` : `−${Math.abs(netDiffG).toFixed(1)}`} kg neto)
                          </span>
                        )}
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
        {vehicles.map((v) => {
          const utilPct = v.capacity_kg > 0 ? Math.round((v.total_weight_kg / v.capacity_kg) * 100) : 0;
          return (
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
                  {v.shipments.length} envíos · {v.total_weight_kg.toFixed(1)} / {v.capacity_kg} kg ({utilPct}%)
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
      </CardContent>
    </Card>
  );
}
