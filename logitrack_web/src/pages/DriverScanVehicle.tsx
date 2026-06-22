import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, QrCode, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { interBranchTripsApi } from "../api/interBranchTrips";
import { driverApi, type DriverRouteResponse } from "../api/driver";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { Button } from "@/components/ui/button";
import { getPendingFatigueStep } from "../utils/fatigueWizardProgress";
import { driverDebug } from "../utils/driverDebug";

export function DriverScanVehicle() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const qrRef = useRef<Html5Qrcode | null>(null);
  const mountedRef = useRef(true);
  // Se resetea a true en el montaje (no solo false en el cleanup): bajo StrictMode
  // el ciclo mount→cleanup→remount dejaría el ref en false y abortaría handleToken
  // justo después del fetch, sin abrir el gate ni reclamar el vehículo.
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Gate de fatiga post-escaneo: se activa cuando el chofer todavía no tiene un
  // check-in válido para hoy (primera ruta del día → incluye horas de sueño) o
  // cuando el backend pide re-test (segunda ruta en adelante). El token QR/patente
  // se guarda para usarlo después de que el chofer pase el test.
  const [showGate, setShowGate] = useState(false);
  const [requiresSleepData, setRequiresSleepData] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  // Bloqueo por puntuación de fatiga elevada. Cuando el backend bloquea al
  // conductor tras un check-in con riesgo ROJO, se muestra un overlay fijo y
  // se hace polling hasta que el supervisor desbloquee la ruta.
  const [fatigueBlocked, setFatigueBlocked] = useState(false);
  const [fatigueUnblockedBy, setFatigueUnblockedBy] = useState<string | null>(null);
  const pendingAckRef = useRef<string | null>(null);

  // Si el chofer ya tiene una ruta activa (last-mile) o un viaje intersucursal
  // activo, mandarlo directo a esa pantalla sin pedirle que vuelva a escanear.
  useEffect(() => {
    driverApi.getRoute().then((data) => {
      const hasPending = data.shipments.some((s) => s.status === "out_for_delivery");
      const hasFailed  = data.shipments.some((s) => s.status === "delivery_failed");
      driverDebug("scan_mount_getroute_ok", {
        driverId: user?.id,
        driverType: user?.driver_type,
        shipments: data.shipments?.length ?? 0,
        hasPending,
        hasFailed,
        willRedirect: hasPending || hasFailed ? "/driver/route" : "none",
      });
      // Ya tenemos la ruta en mano: la pasamos por navigation state para que
      // DriverRoute renderice al instante, sin segundo fetch ni skeleton.
      if (hasPending || hasFailed) {
        navigate("/driver/route", { replace: true, state: { fromClaim: true, route: data } });
      }
    }).catch((err) => {
      driverDebug("scan_mount_getroute_err", { driverId: user?.id, status: err?.response?.status });
    });

    interBranchTripsApi.getMyTrip().then((trip) => {
      // Solo los viajes inter-sucursal van a /driver/trip. getMyTrip
      // (GetActiveByDriver en el backend) NO filtra por kind, así que para un
      // chofer de última milla devuelve su trip last_mile en_transito. Sin este
      // guard lo mandábamos a la pantalla inter-sucursal, en conflicto con la
      // navegación a /driver/route del getRoute de arriba → rebote a /driver/scan.
      const isInterBranchActive =
        trip.kind === "inter_branch" &&
        (trip.status === "pendiente" || trip.status === "en_transito");
      driverDebug("scan_mount_getmytrip_ok", {
        driverId: user?.id,
        driverType: user?.driver_type,
        tripStatus: trip.status,
        tripKind: trip.kind,
        willRedirect: isInterBranchActive ? "/driver/trip" : "none",
      });
      if (isInterBranchActive) {
        navigate("/driver/trip", { replace: true });
      }
    }).catch((err) => {
      driverDebug("scan_mount_getmytrip_err", { driverId: user?.id, status: err?.response?.status });
    });
  }, [navigate, user]);

  // Router Guard anti-bypass por F5: si quedó un wizard de fatiga a mitad de
  // camino (persistido en sessionStorage), forzar el gate de inmediato sin
  // esperar un nuevo escaneo — el backend ya considera el check-in "completo"
  // apenas se envía el paso KSS, así que no podemos confiar solo en su respuesta.
  useEffect(() => {
    if (!user) return;
    if (!getPendingFatigueStep(user.id)) return;
    driverApi.getCheckinGateStatus()
      .then((status) => setRequiresSleepData(status.requires_sleep_data))
      .catch(() => {})
      .finally(() => setShowGate(true));
  }, [user]);

  // Polling de bloqueo por fatiga: corre cada 5 s mientras el conductor está
  // bloqueado por puntuación ROJA. Cuando el supervisor desbloquea, se muestra
  // el cartel de autorización y luego se completa el claim del vehículo.
  useEffect(() => {
    if (!fatigueBlocked) return;
    const poll = async () => {
      try {
        const data = await driverApi.getFatigueBlockStatus();
        if (!data.blocked) {
          setFatigueBlocked(false);
          if (data.recently_unblocked && data.unblocked_by) {
            pendingAckRef.current = data.unblocked_at ?? "seen";
            setFatigueUnblockedBy(data.unblocked_by);
          } else if (pendingToken) {
            // Desbloqueado sin cartelito — proceder directamente.
            const token = pendingToken;
            setPendingToken(null);
            void claimAndNavigate(token);
          }
        }
      } catch {
        // Error de red → conservar estado bloqueado
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fatigueBlocked]);

  const goToRoute = async (successMsg: string) => {
    setSuccess(successMsg);
    // Pre-fetcheamos la ruta recién creada en esta misma pantalla (que ya muestra
    // su propio spinner) y la pasamos por navigation state. Así DriverRoute
    // renderiza al instante, sin pagar el skeleton ni arriesgar el read-after-write
    // race de un segundo request. Si la ruta todavía no es visible (race), navegamos
    // solo con el flag fromClaim y DriverRoute reintenta por su cuenta.
    let route: DriverRouteResponse | null = null;
    try {
      route = await driverApi.getRoute();
    } catch (err) {
      driverDebug("gotoroute_prefetch_err", {
        driverId: user?.id,
        status: (err as { response?: { status?: number } })?.response?.status,
      });
    }
    navigate("/driver/route", { replace: true, state: { fromClaim: true, route } });
  };

  // Realiza el claim del token (QR o patente) y navega a la pantalla
  // correspondiente. Se llama después de que el gate de fatiga se resuelve
  // (ya sea porque no era necesario o porque el chofer lo completó).
  // Llama a markRouteStarted() tras cada claim exitoso de ruta de última milla
  // para que CompletedRoutesToday quede incrementado ANTES de que el chofer
  // vuelva a esta pantalla para una eventual segunda ruta.
  const claimAndNavigate = async (token: string) => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError("");
    try {
      const trip = await interBranchTripsApi.claimByVehicleQR(token);
      stopScanner();
      driverDebug("claim_ok", {
        driverId: user?.id,
        driverType: user?.driver_type,
        tripKind: trip.kind,
        target: trip.kind === "last_mile" ? "/driver/route" : "/driver/trip",
      });
      if (trip.kind === "last_mile") {
        driverApi.markRouteStarted().catch(() => {});
        await goToRoute(`Vehículo ${trip.license_plate} asignado. Iniciando ruta…`);
      } else {
        navigate("/driver/trip", { replace: true });
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      driverDebug("claim_err", { driverId: user?.id, driverType: user?.driver_type, status, msg });
      if (msg.includes("no hay viaje activo")) {
        try {
          await driverApi.startRoute();
          if (!mountedRef.current) return;
          stopScanner();
          driverApi.markRouteStarted().catch(() => {});
          driverDebug("claim_startroute_ok", { driverId: user?.id, target: "/driver/route" });
          await goToRoute("Ruta iniciada.");
          return;
        } catch (routeErr: unknown) {
          if (!mountedRef.current) return;
          const routeMsg =
            (routeErr as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
          driverDebug("claim_startroute_err", { driverId: user?.id, routeMsg });
          if (routeMsg.includes("no tenés una ruta")) {
            setError("No tenés envíos asignados para hoy. Consultá con el operador.");
            setLoading(false);
            return;
          }
          if (routeMsg.includes("ya está iniciada")) {
            stopScanner();
            driverApi.markRouteStarted().catch(() => {});
            await goToRoute("Ruta en curso.");
            return;
          }
          if (routeMsg.includes("ya finalizó")) {
            setError("No tenés envíos asignados para una nueva ruta. Consultá con el operador.");
            setLoading(false);
            return;
          }
        }
      }
      setError(msg || "No se pudo reclamar el vehículo.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleToken = async (token: string) => {
    if (loading) return;

    try {
      if (user?.driver_type !== "intersucursal") {
        const gateStatus = await driverApi.getCheckinGateStatus();
        if (!mountedRef.current) return;
        driverDebug("handletoken_gate_status", {
          driverId: user?.id,
          needsTest: gateStatus.needs_test,
          needsCheckin: gateStatus.needs_checkin,
          willShowGate: gateStatus.needs_test || gateStatus.needs_checkin,
        });
        if (gateStatus.needs_test || gateStatus.needs_checkin) {
          stopScanner();
          setPendingToken(token);
          setRequiresSleepData(gateStatus.requires_sleep_data);
          setShowGate(true);
          return;
        }
      }

      await claimAndNavigate(token);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      setError(msg || "Error al procesar el vehículo. Intentá de nuevo.");
      setLoading(false);
    }
  };

  const startScanner = async () => {
    setError("");
    setScanning(true);
    try {
      const html5Qrcode = new Html5Qrcode("driver-qr-reader");
      qrRef.current = html5Qrcode;
      await html5Qrcode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          void handleToken(decodedText.trim());
        },
        () => { /* ignore scan errors */ }
      );
    } catch {
      setError("No se pudo acceder a la cámara. Ingresá el código manualmente.");
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
    return () => {
      if (qrRef.current) {
        qrRef.current.stop().catch(() => {});
      }
    };
  }, []);

  // Overlay de bloqueo por puntuación ROJA de fatiga.
  if (fatigueBlocked) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[var(--sidebar-bg)] flex flex-col items-center justify-center p-8 text-center gap-6">
        <AlertTriangle size={64} className="text-[var(--danger-c)]" />
        <h2 className="text-white text-[22px] font-bold m-0">
          Alerta de fatiga detectada
        </h2>
        <p className="text-[var(--text-muted)] text-base leading-relaxed m-0">
          Tu supervisor fue notificado.<br />
          Esperá su indicación antes de continuar.
        </p>
      </div>
    );
  }

  // Cartelito de autorización cuando el supervisor desbloquea la ruta.
  if (fatigueUnblockedBy) {
    return (
      <div className="fixed inset-0 z-[9999] bg-[var(--sidebar-bg)] flex flex-col items-center justify-center p-8 text-center gap-6">
        <CheckCircle2 size={64} className="text-[var(--ok)]" />
        <h2 className="text-white text-[22px] font-bold m-0">
          Ruta autorizada
        </h2>
        <p className="text-[var(--text-secondary)] text-base leading-relaxed m-0">
          Tu supervisor <strong className="text-white">{fatigueUnblockedBy}</strong> autorizó<br />
          que continúes la ruta.
        </p>
        <Button
          onClick={() => {
            if (pendingAckRef.current) sessionStorage.setItem("lt_fatigue_ack", pendingAckRef.current);
            setFatigueUnblockedBy(null);
            if (pendingToken) {
              const token = pendingToken;
              setPendingToken(null);
              void claimAndNavigate(token);
            }
          }}
          className="mt-2 px-9 py-3 rounded-xl text-base font-bold bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          Continuar
        </Button>
      </div>
    );
  }

  // Gate de fatiga post-escaneo. requiresSleepData es true en la primera ruta del
  // día (el chofer aún no registró horas de sueño) y false en el re-test posterior
  // (ya quedaron registradas en el check-in matutino).
  if (showGate && user) {
    return (
      <KssCheckIn
        driverId={user.id}
        misfireCount={0}
        requiresSleepData={requiresSleepData}
        onDone={async () => {
          driverDebug("gate_done", {
            driverId: user.id,
            driverType: user.driver_type,
            hasPendingToken: !!pendingToken,
          });
          setShowGate(false);
          if (pendingToken) {
            // Verificar si el check-in resultó en un bloqueo por puntuación ROJA
            // antes de dejar que el chofer acceda a la ruta.
            try {
              const blockStatus = await driverApi.getFatigueBlockStatus();
              if (blockStatus.blocked) {
                setFatigueBlocked(true);
                return; // pendingToken se conserva; el polling lo usará al desbloquear
              }
            } catch {
              // Si no se puede determinar el estado, dejar pasar (fail-open)
            }
            const token = pendingToken;
            setPendingToken(null);
            void claimAndNavigate(token);
          }
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-full bg-[var(--sidebar-bg)] flex items-center justify-center mb-3">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Escanear vehículo</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1 text-center">
            Escaneá el código QR del vehículo para reclamar el viaje.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm text-[var(--danger-text)]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-lg border border-[var(--ok-border)] bg-[var(--ok-bg)] text-sm text-[var(--ok-text)]">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            {success}
          </div>
        )}

        {/* QR Scanner viewport */}
        <div
          id="driver-qr-reader"
          className={`w-full rounded-xl overflow-hidden border border-[var(--border)] bg-black mb-4 ${scanning ? "block min-h-[280px]" : "hidden min-h-0"}`}
        />

        {!scanning ? (
          <Button
            onClick={() => void startScanner()}
            disabled={loading}
            className="w-full h-12 rounded-xl font-semibold text-sm gap-2"
          >
            <QrCode className="w-5 h-5" />
            Activar cámara
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={stopScanner}
            className="w-full h-12 rounded-xl font-semibold text-sm"
          >
            Cancelar
          </Button>
        )}

        {/* Manual fallback */}
        <div className="mt-6">
          <p className="text-xs text-[var(--text-secondary)] text-center mb-2">¿No funciona la cámara? Ingresá la patente del vehículo:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value.toUpperCase())}
              placeholder="Ej.: AB100UM"
              className="flex-1 h-10 px-3 rounded-lg border border-[var(--border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--sidebar-bg)]"
              onKeyDown={(e) => { if (e.key === "Enter" && manualToken.trim()) void handleToken(manualToken.trim()); }}
            />
            <Button
              onClick={() => { if (manualToken.trim()) void handleToken(manualToken.trim()); }}
              disabled={!manualToken.trim() || loading}
              className="h-10 px-4 rounded-lg text-sm font-semibold"
            >
              OK
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
