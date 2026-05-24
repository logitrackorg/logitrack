import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Package,
  Truck,
  X,
} from "lucide-react";
import { interBranchTripsApi, type InterBranchTrip, type TripStop } from "../api/interBranchTrips";
import { publicTrackingApi } from "../api/publicTracking";
import type { Branch } from "../api/branches";
import { Card } from "../components/ui/card";
import { useAuth } from "../context/AuthContext";

export default function OperatorTripReception() {
  const { id: tripId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [trip, setTrip] = useState<InterBranchTrip | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [done, setDone] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Last-mile return: simple finish (no stop checklist)
  const isLastMile = trip?.kind === "last_mile";

  const [unloadChecked, setUnloadChecked] = useState<Record<string, boolean>>({});
  const [loadChecked, setLoadChecked] = useState<Record<string, boolean>>({});
  // IDs de pickups que ya no están disponibles (estado terminal)
  const [unavailablePickups, setUnavailablePickups] = useState<Set<string>>(new Set());
  const [filteredPrevPickups, setFilteredPrevPickups] = useState<string[]>([]);

  const TERMINAL_STATUSES = new Set(["delivered", "returned", "cancelled", "lost", "destroyed"]);
  const ON_VEHICLE_STATUSES = new Set(["loaded", "in_transit"]);

  useEffect(() => {
    if (!tripId) return;
    Promise.all([
      interBranchTripsApi.getById(tripId),
      publicTrackingApi.getBranches(),
    ]).then(async ([t, br]) => {
      setTrip(t);
      setBranches(br);

      const stopIdx = t.current_stop_index ?? 0;
      const stop = t.stops?.[stopIdx];

      if (stop?.completed_at) {
        setDone(true);
      }

      const allPrevPickups = (t.stops ?? [])
        .slice(0, stopIdx)
        .flatMap((s) => s.pickup_shipment_ids ?? []);

      // Pickups de paradas anteriores: solo mostrar los que están físicamente en el camión
      let activePrevPickups = allPrevPickups;
      if (allPrevPickups.length > 0) {
        const statuses = await Promise.allSettled(
          allPrevPickups.map((tid) => publicTrackingApi.getShipment(tid))
        );
        activePrevPickups = allPrevPickups.filter((_, i) => {
          const r = statuses[i];
          return r.status === "fulfilled" && ON_VEHICLE_STATUSES.has(r.value.status);
        });
      }
      setFilteredPrevPickups(activePrevPickups);

      const unloadInit: Record<string, boolean> = {};
      stop?.shipment_ids?.forEach((tid) => { unloadInit[tid] = true; });
      activePrevPickups.forEach((tid) => { unloadInit[tid] = true; });
      setUnloadChecked(unloadInit);

      // Pickups nuevos en esta parada: filtrar los que ya tienen estado terminal
      const pickupIds = stop?.pickup_shipment_ids ?? [];
      if (pickupIds.length > 0) {
        const statuses = await Promise.allSettled(
          pickupIds.map((tid) => publicTrackingApi.getShipment(tid))
        );
        const unavailable = new Set<string>();
        statuses.forEach((result, i) => {
          if (result.status === "fulfilled" && TERMINAL_STATUSES.has(result.value.status)) {
            unavailable.add(pickupIds[i]);
          }
        });
        setUnavailablePickups(unavailable);

        const loadInit: Record<string, boolean> = {};
        pickupIds.forEach((tid) => {
          if (!unavailable.has(tid)) loadInit[tid] = false;
        });
        setLoadChecked(loadInit);
      } else {
        setLoadChecked({});
      }
    }).catch(() => {
      setError("No se pudo cargar el viaje. Verificá el ID e intentá de nuevo.");
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const currentStop: TripStop | undefined = trip?.stops?.[trip.current_stop_index ?? 0];
  const stopIdx = trip?.current_stop_index ?? 0;
  const stopBranch = branches.find((b) => b.id === currentStop?.branch_id);
  const totalStops = trip?.stops?.length ?? 1;
  const availablePickups = (currentStop?.pickup_shipment_ids ?? []).filter((tid) => !unavailablePickups.has(tid));
  const hasPickups = availablePickups.length > 0;
  const isLastStop = stopIdx === totalStops - 1;
  const prevPickups = filteredPrevPickups;

  const handleLastMileFinish = async () => {
    if (!trip || !user) return;
    setBusy(true);
    setSubmitError("");
    try {
      const res = await interBranchTripsApi.finishByScan(trip.id);
      setTrip(res.trip);
      setSuccessMsg(res.message);
      setDone(true);
    } catch (err: unknown) {
      setSubmitError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Error al recibir al chofer.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!trip || !user) return;
    setBusy(true);
    setSubmitError("");
    try {
      const delivered = Object.entries(unloadChecked).filter(([, v]) => v).map(([k]) => k);
      const missing = Object.entries(unloadChecked).filter(([, v]) => !v).map(([k]) => k);
      const unloadRes = await interBranchTripsApi.confirmUnload(trip.id, stopIdx, { delivered, missing });

      const loaded = Object.entries(loadChecked).filter(([, v]) => v).map(([k]) => k);
      const skipped = [
        ...Object.entries(loadChecked).filter(([, v]) => !v).map(([k]) => k),
        ...Array.from(unavailablePickups),
      ];
      const loadRes = await interBranchTripsApi.confirmLoad(unloadRes.trip.id, stopIdx, { loaded, skipped });

      setTrip(loadRes.trip);
      setSuccessMsg(loadRes.message);
      setDone(true);
    } catch (err: unknown) {
      setSubmitError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Error al confirmar la parada.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ReceptionSkeleton />;

  if (error) return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="flex items-center gap-2 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <p className="text-sm">{error}</p>
      </div>
    </div>
  );

  if (done) return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex flex-col items-center gap-4 py-12">
        <CheckCircle2 className="w-16 h-16 text-emerald-500" />
        <p className="text-base font-bold text-slate-900 text-center">{successMsg}</p>
        {!isLastStop && (
          <p className="text-sm text-slate-500 text-center">
            El vehículo queda en <strong>espera de chofer</strong> para continuar al próximo destino.
          </p>
        )}
        <button
          onClick={() => navigate("/vehicles")}
          className="h-10 px-6 rounded-xl bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-bold cursor-pointer transition-colors"
        >
          Volver a Flota
        </button>
      </div>
    </div>
  );

  if (!trip) return (
    <div className="p-6 max-w-lg mx-auto text-sm text-slate-500">Viaje no encontrado.</div>
  );

  // ── Vista simplificada para retorno de última milla ──────────────────────
  if (isLastMile) {
    const failedIds = trip.shipment_ids ?? [];
    return (
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Recepción de chofer</h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{trip.id}</p>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer transition-colors shrink-0"
          >
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f] flex items-center justify-center shrink-0">
              <Truck className="w-4.5 h-4.5" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {trip.license_plate} · Retorno de última milla
              </p>
              <p className="text-xs text-slate-500">
                {branches.find((b) => b.id === trip.origin_branch_id)?.name ?? trip.origin_branch_id}
              </p>
            </div>
          </div>
        </Card>

        {failedIds.length > 0 && (
          <Card className="p-4 space-y-3">
            <p className="text-sm font-bold text-slate-900">
              {failedIds.length} {failedIds.length === 1 ? "envío pendiente" : "envíos pendientes"}
            </p>
            <p className="text-xs text-slate-500">
              Al confirmar, el sistema asigna el estado final de cada envío según los intentos de entrega y si fue rechazado por el destinatario.
            </p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
              {failedIds.map((tid) => (
                <div key={tid} className="px-3 py-2.5 flex items-center gap-2">
                  <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-xs font-mono text-slate-700 flex-1">{tid}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {submitError && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {submitError}
          </div>
        )}

        <button
          onClick={handleLastMileFinish}
          disabled={busy}
          className="w-full h-11 rounded-xl bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {busy ? "Procesando…" : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Confirmar recepción
            </>
          )}
        </button>
      </div>
    );
  }

  if (!currentStop) return (
    <div className="p-6 max-w-lg mx-auto text-sm text-slate-500">Viaje no encontrado.</div>
  );

  const totalUnload = currentStop.shipment_ids.length + prevPickups.length;
  const confirmedUnload = Object.values(unloadChecked).filter(Boolean).length;
  const confirmedLoad = Object.values(loadChecked).filter(Boolean).length;

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Recepción de viaje</h1>
          <p className="text-xs text-slate-500 font-mono mt-0.5">{trip.id}</p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center cursor-pointer transition-colors shrink-0"
        >
          <X className="w-4 h-4 text-slate-600" />
        </button>
      </div>

      {/* Info del viaje */}
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#1e3a5f]/10 text-[#1e3a5f] flex items-center justify-center shrink-0">
            <Truck className="w-4.5 h-4.5" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">
              {trip.license_plate} · Parada {stopIdx + 1} de {totalStops}
            </p>
            <p className="text-xs text-slate-500">
              {stopBranch?.name ?? currentStop.branch_id} · {stopBranch?.address.city}
            </p>
          </div>
        </div>
      </Card>

      {/* Descarga */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-base">↓</span>
          <div>
            <p className="text-sm font-bold text-slate-900">Bajan del camión</p>
            <p className="text-xs text-slate-500">{confirmedUnload} de {totalUnload} confirmados</p>
          </div>
          <button
            onClick={() => {
              const all: Record<string, boolean> = {};
              currentStop.shipment_ids.forEach((tid) => { all[tid] = true; });
              prevPickups.forEach((tid) => { all[tid] = true; });
              setUnloadChecked(all);
            }}
            className="ml-auto text-xs font-semibold text-[#1e3a5f] hover:underline cursor-pointer"
          >
            Marcar todos
          </button>
        </div>

        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
          {currentStop.shipment_ids.map((tid) => (
            <ShipmentRow
              key={tid}
              tid={tid}
              checked={unloadChecked[tid] ?? true}
              onChange={(v) => setUnloadChecked((prev) => ({ ...prev, [tid]: v }))}
              badgeChecked={{ text: "✓ Llegó", cls: "text-slate-500 bg-slate-50" }}
              badgeUnchecked={{ text: "No llegó", cls: "text-rose-600 bg-rose-50" }}
            />
          ))}
          {prevPickups.length > 0 && (
            <>
              <div className="px-3 py-1.5 bg-sky-50">
                <p className="text-[10px] font-bold text-sky-700 uppercase tracking-wider">
                  Cargados en {stopIdx === 1 ? "la parada anterior" : "paradas anteriores"}
                </p>
              </div>
              {prevPickups.map((tid) => (
                <ShipmentRow
                  key={tid}
                  tid={tid}
                  checked={unloadChecked[tid] ?? true}
                  onChange={(v) => setUnloadChecked((prev) => ({ ...prev, [tid]: v }))}
                  highlight="sky"
                  badgeChecked={{ text: "✓ Llegó", cls: "text-sky-600 bg-sky-50" }}
                  badgeUnchecked={{ text: "No llegó", cls: "text-rose-600 bg-rose-50" }}
                />
              ))}
            </>
          )}
        </div>
      </Card>

      {/* Carga */}
      {hasPickups && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base">↑</span>
            <div>
              <p className="text-sm font-bold text-slate-900">Suben al camión</p>
              <p className="text-xs text-slate-500">{confirmedLoad} de {availablePickups.length} confirmados</p>
            </div>
            <button
              onClick={() => {
                const all: Record<string, boolean> = {};
                availablePickups.forEach((tid) => { all[tid] = true; });
                setLoadChecked(all);
              }}
              className="ml-auto text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
            >
              Marcar todos
            </button>
          </div>

          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden">
            {availablePickups.map((tid) => (
              <ShipmentRow
                key={tid}
                tid={tid}
                checked={loadChecked[tid] ?? false}
                onChange={(v) => setLoadChecked((prev) => ({ ...prev, [tid]: v }))}
                badgeChecked={{ text: "↑ Subió", cls: "text-emerald-700 bg-emerald-50" }}
                badgeUnchecked={{ text: "No subió", cls: "text-amber-700 bg-amber-50" }}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Error */}
      {submitError && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {submitError}
        </div>
      )}

      {/* Confirmar */}
      <button
        onClick={handleConfirm}
        disabled={busy}
        className="w-full h-11 rounded-xl bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {busy ? (
          "Procesando…"
        ) : (
          <>
            <Package className="w-4 h-4" />
            Confirmar parada
          </>
        )}
      </button>
    </div>
  );
}

function ShipmentRow({
  tid,
  checked,
  onChange,
  highlight,
  badgeChecked,
  badgeUnchecked,
}: {
  tid: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  highlight?: "sky";
  badgeChecked?: { text: string; cls: string };
  badgeUnchecked?: { text: string; cls: string };
}) {
  const rowBg = highlight === "sky"
    ? "hover:bg-sky-50/60 bg-sky-50/30"
    : "hover:bg-slate-50";

  return (
    <label className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer ${rowBg}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`w-4 h-4 cursor-pointer ${highlight === "sky" ? "accent-sky-600" : "accent-[#1e3a5f]"}`}
      />
      <span className={`text-xs font-mono flex-1 ${highlight === "sky" ? "text-sky-800" : "text-slate-700"}`}>{tid}</span>
      {checked && badgeChecked && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeChecked.cls}`}>{badgeChecked.text}</span>
      )}
      {!checked && badgeUnchecked && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeUnchecked.cls}`}>{badgeUnchecked.text}</span>
      )}
    </label>
  );
}

function ReceptionSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      <div className="h-7 w-48 rounded bg-slate-100 animate-pulse" />
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="h-4 w-32 rounded bg-slate-100 animate-pulse" />
          <div className="h-3 w-full rounded bg-slate-100 animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  );
}
