import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, MapPin, AlertCircle, RefreshCw, Package, Filter, QrCode, X } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { interBranchTripsApi, type InterBranchTrip, type TripStop } from "../api/interBranchTrips";
import { branchApi, branchLabelById, type Branch } from "../api/branches";
import { usersApi, type UserProfile } from "../api/users";
import { useAuth } from "../context/AuthContext";
import { TopbarActions } from "../components/topbarContext";
import { Card, CardContent } from "../components/ui/card";
import { fmtDateTime } from "../utils/date";

export function InterBranchTripsList() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<InterBranchTrip[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [driverMap, setDriverMap] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [branchFilter, setBranchFilter] = useState<string>("");

  // Modal recibir viaje
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [manualTripId, setManualTripId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const qrRef = useRef<Html5Qrcode | null>(null);

  const [tab, setTab] = useState<"inter_branch" | "last_mile">("inter_branch");

  const isNetworkRole = hasRole("manager");
  const userBranchId = user?.branch_id ?? "";
  const canReceive = hasRole("operator", "supervisor");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await interBranchTripsApi.listByBranch(isNetworkRole ? (branchFilter || undefined) : undefined);
      const active = data.filter((t) => t.status === "pendiente" || t.status === "en_transito");
      setTrips(active);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudieron cargar los viajes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    branchApi.list("activo").then(setBranches).catch(() => {});
    usersApi.listDrivers().then((drivers) => {
      const map: Record<string, UserProfile> = {};
      drivers.forEach((d) => { map[d.id] = d; });
      setDriverMap(map);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  // Para operator/supervisor: identificar "mi sucursal" para resaltar stops
  const myBranchId = isNetworkRole ? branchFilter : userBranchId;
  const interBranchTrips = trips.filter((t) => t.kind === "inter_branch");
  const lastMileTrips = trips.filter((t) => t.kind === "last_mile");
  const visibleTrips = tab === "inter_branch" ? interBranchTrips : lastMileTrips;

  const openReceiveModal = () => {
    setManualTripId("");
    setScanError("");
    setScanning(false);
    setShowReceiveModal(true);
  };

  const closeReceiveModal = () => {
    stopScanner();
    setShowReceiveModal(false);
  };

  const goToReception = (tripId: string) => {
    const id = tripId.trim().toUpperCase();
    if (!id) return;
    closeReceiveModal();
    navigate(`/inter-branch-trips/${id}/recepcion`);
  };

  const startScanner = async () => {
    setScanError("");
    setScanning(true);
    try {
      const scanner = new Html5Qrcode("operator-trip-qr-reader");
      qrRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decoded) => {
          stopScanner();
          goToReception(decoded.trim());
        },
        () => {}
      );
    } catch {
      setScanError("No se pudo acceder a la cámara. Ingresá el ID manualmente.");
      setScanning(false);
    }
  };

  const stopScanner = () => {
    if (qrRef.current) {
      qrRef.current.stop().catch(() => {});
      qrRef.current = null;
    }
    setScanning(false);
  };

  useEffect(() => {
    return () => { if (qrRef.current) qrRef.current.stop().catch(() => {}); };
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <TopbarActions>
        {canReceive && (
          <button
            onClick={openReceiveModal}
            className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            Recibir viaje
          </button>
        )}
        <button
          onClick={() => void load()}
          disabled={loading}
          className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-sm flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </TopbarActions>

      {/* Filtro de sucursal (solo manager/admin) */}
      {isNetworkRole && (
        <Card className="mb-4 p-3">
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-slate-500" />
            <label className="text-sm font-medium text-slate-700">Sucursal:</label>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="h-9 px-3 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sidebar-bg)]"
            >
              <option value="">— Toda la red —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <span className="ml-auto text-xs text-slate-500 tabular-nums">{trips.length} viajes</span>
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Sub-pestañas */}
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {(["inter_branch", "last_mile"] as const).map((t) => {
          const count = t === "inter_branch" ? interBranchTrips.length : lastMileTrips.length;
          const label = t === "inter_branch" ? "Inter-sucursal" : "Última milla";
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                tab === t
                  ? "border-[var(--sidebar-bg)] text-[var(--sidebar-bg)]"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                tab === t ? "bg-[var(--sidebar-bg)] text-white" : "bg-slate-100 text-slate-500"
              }`}>
                {loading ? "…" : count}
              </span>
            </button>
          );
        })}
      </div>

      {loading && trips.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      )}

      {!loading && visibleTrips.length === 0 && (
        <Card className="p-10 text-center">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            No hay viajes de {tab === "inter_branch" ? "inter-sucursal" : "última milla"} activos.
          </p>
        </Card>
      )}

      <div className="grid gap-4">
        {visibleTrips.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            branches={branches}
            myBranchId={myBranchId}
            driverMap={driverMap}
          />
        ))}
      </div>

      {/* Modal: recibir viaje */}
      {showReceiveModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={closeReceiveModal}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Recibir viaje intersucursal</h2>
              <button onClick={closeReceiveModal} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {scanError && (
              <div className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {scanError}
              </div>
            )}

            {/* Viewport de cámara */}
            <div
              id="operator-trip-qr-reader"
              className={`w-full rounded-xl overflow-hidden border border-slate-200 bg-black mb-4 ${scanning ? "block min-h-[260px]" : "hidden"}`}
            />

            {!scanning ? (
              <button
                onClick={() => void startScanner()}
                className="w-full h-11 rounded-xl bg-[var(--sidebar-bg)] hover:bg-[#15294a] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer mb-4"
              >
                <QrCode className="w-4 h-4" />
                Escanear QR del viaje
              </button>
            ) : (
              <button
                onClick={stopScanner}
                className="w-full h-11 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-sm transition-colors cursor-pointer mb-4"
              >
                Cancelar cámara
              </button>
            )}

            <p className="text-xs text-slate-500 text-center mb-2">
              ¿No podés escanear? Ingresá el ID manualmente:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualTripId}
                onChange={(e) => setManualTripId(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter" && manualTripId.trim()) goToReception(manualTripId); }}
                placeholder="TRIP-XXXXXXXX"
                className="flex-1 h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--sidebar-bg)]"
              />
              <button
                onClick={() => goToReception(manualTripId)}
                disabled={!manualTripId.trim()}
                className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                Ir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TripCard({
  trip,
  branches,
  myBranchId,
  driverMap,
}: {
  trip: InterBranchTrip;
  branches: Branch[];
  myBranchId: string;
  driverMap: Record<string, UserProfile>;
}) {
  const navigate = useNavigate();
  const stops = useMemo<TripStop[]>(() => {
    if (trip.stops && trip.stops.length > 0) return trip.stops;
    if (trip.destination_branch_id) {
      return [{
        branch_id: trip.destination_branch_id,
        shipment_ids: trip.shipment_ids,
        total_weight_kg: trip.total_weight_kg,
      }];
    }
    return [];
  }, [trip]);

  const currentIdx = trip.current_stop_index ?? 0;
  const isMultiHop = stops.length > 1;

  const statusBadge = trip.status === "pendiente"
    ? { label: "Pendiente", cls: "bg-amber-100 text-amber-800" }
    : trip.status === "en_transito"
      ? { label: "En tránsito", cls: "bg-sky-100 text-sky-800" }
      : { label: trip.status, cls: "bg-slate-100 text-slate-600" };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <Truck className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="font-mono font-semibold text-sm">{trip.license_plate}</span>
            <span className="text-xs text-slate-400 font-mono">{trip.id}</span>
            {trip.kind === "last_mile" ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                Última milla
              </span>
            ) : isMultiHop ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                Multi-hop · {stops.length} paradas
              </span>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium">
                Inter-sucursal
              </span>
            )}
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
        </div>

        {/* Timeline de paradas */}
        <div className="space-y-0">
          {/* Origen */}
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-3 h-3 rounded-full bg-[var(--sidebar-bg)] ring-2 ring-[var(--sidebar-bg)]/10" />
              {stops.length > 0 && <div className="w-0.5 h-7 bg-slate-200 my-1" />}
            </div>
            <div className="flex-1 pb-2 text-xs">
              <span className="text-slate-500">Salida: </span>
              <span className="font-semibold text-slate-900">{branchLabelById(trip.origin_branch_id, branches)}</span>
              {trip.started_at && (
                <span className="text-slate-400 ml-2">· {fmtDateTime(trip.started_at)}</span>
              )}
            </div>
          </div>

          {/* Paradas */}
          {stops.map((stop, idx) => {
            const isLast = idx === stops.length - 1;
            const isCompleted = idx < currentIdx;
            const isCurrent = idx === currentIdx && trip.status === "en_transito";
            const isMine = stop.branch_id === myBranchId;
            const dotClass = isCompleted
              ? "bg-emerald-500 ring-emerald-500/20"
              : isCurrent
                ? "bg-sky-500 ring-sky-500/30 animate-pulse"
                : "bg-slate-300 ring-slate-300/20";

            return (
              <div key={idx} className="flex items-start gap-3">
                <div className="flex flex-col items-center shrink-0">
                  <div className={`w-3 h-3 rounded-full ring-2 ${dotClass}`} />
                  {!isLast && <div className="w-0.5 h-7 bg-slate-200 my-1" />}
                </div>
                <div className={`flex-1 pb-2 text-xs rounded-md ${isMine ? "bg-amber-50/60 border border-amber-200 px-2 py-1.5 -ml-2" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-500">{isLast ? "Destino:" : `Parada ${idx + 1}:`}</span>
                    <span className="font-semibold text-slate-900">{branchLabelById(stop.branch_id, branches)}</span>
                    {isMine && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-bold">
                        Tu sucursal
                      </span>
                    )}
                    {isCompleted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
                        ✓ Hecho
                      </span>
                    )}
                    {isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-medium">
                        📍 Acá
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    {stop.shipment_ids.length > 0 && (
                      <span>↓ Bajan {stop.shipment_ids.length} envío{stop.shipment_ids.length === 1 ? "" : "s"} · {stop.total_weight_kg.toFixed(1)} kg</span>
                    )}
                    {(stop.pickup_shipment_ids?.length ?? 0) > 0 && (
                      <span className="ml-2 text-amber-700">↑ Suben {stop.pickup_shipment_ids?.length} envío{stop.pickup_shipment_ids?.length === 1 ? "" : "s"} · {(stop.pickup_weight_kg ?? 0).toFixed(1)} kg</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Carga total */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Package className="w-3 h-3" />
            {trip.shipment_ids.length} envíos totales
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {trip.total_weight_kg.toFixed(1)} kg
          </span>
          {trip.driver_id && (() => {
            const driver = driverMap[trip.driver_id];
            const label  = driver ? (driver.full_name || driver.username) : "–";
            return (
              <span className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                <Truck className="w-3 h-3 text-slate-400" />
                {label}
              </span>
            );
          })()}
          <button
            type="button"
            onClick={() => navigate(`/?view=trip&trip_id=${encodeURIComponent(trip.id)}`)}
            className="ml-auto text-[11px] font-semibold text-[var(--sidebar-bg)] hover:underline cursor-pointer"
          >
            Ver envíos agrupados →
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
