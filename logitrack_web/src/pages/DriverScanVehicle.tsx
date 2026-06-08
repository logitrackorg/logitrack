import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, QrCode, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { interBranchTripsApi } from "../api/interBranchTrips";
import { driverApi } from "../api/driver";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { Button } from "@/components/ui/button";

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
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Gate de fatiga post-escaneo: se activa solo cuando el chofer ya completó
  // al menos una ruta hoy (segunda ruta en adelante). Para la primera ruta del
  // día el gate no aplica aquí. El token QR/patente se guarda para usarlo
  // después de que el chofer pase el test.
  const [showGate, setShowGate] = useState(false);
  const [requiresSleepData, setRequiresSleepData] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  // Si el chofer ya tiene una ruta activa (last-mile) o un viaje intersucursal
  // activo, mandarlo directo a esa pantalla sin pedirle que vuelva a escanear.
  useEffect(() => {
    driverApi.getRoute().then((data) => {
      const hasPending = data.shipments.some((s) => s.status === "out_for_delivery");
      const hasFailed  = data.shipments.some((s) => s.status === "delivery_failed");
      if (hasPending || hasFailed) navigate("/driver/route", { replace: true });
    }).catch(() => { /* sin ruta — chequear inter-sucursal */ });

    interBranchTripsApi.getMyTrip().then((trip) => {
      if (trip.status === "pendiente" || trip.status === "en_transito") {
        navigate("/driver/trip", { replace: true });
      }
    }).catch(() => { /* sin trip — quedarse acá */ });
  }, [navigate]);

  const goToRoute = (successMsg: string) => {
    setSuccess(successMsg);
    setTimeout(() => {
      if (mountedRef.current) {
        navigate("/driver/route", { replace: true });
      }
    }, 1800);
  };

  // Realiza el claim del token (QR o patente) y navega a la pantalla
  // correspondiente. Se llama después de que el gate de fatiga se resuelve
  // (ya sea porque no era necesario o porque el chofer lo completó).
  // Llama a markRouteStarted() tras cada claim exitoso de ruta de última milla
  // para que CompletedRoutesToday quede incrementado ANTES de que el chofer
  // vuelva a esta pantalla para una eventual segunda ruta.
  const claimAndNavigate = async (token: string) => {
    setLoading(true);
    setError("");
    try {
      const trip = await interBranchTripsApi.claimByVehicleQR(token);
      stopScanner();
      if (trip.kind === "last_mile") {
        // Marcar inicio de ruta antes de navegar. La llamada es fire-and-forget.
        driverApi.markRouteStarted().catch(() => {});
        goToRoute(`Vehículo ${trip.license_plate} asignado. Iniciando ruta…`);
      } else {
        navigate("/driver/trip", { replace: true });
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      if (msg.includes("no hay viaje activo")) {
        try {
          await driverApi.startRoute();
          stopScanner();
          driverApi.markRouteStarted().catch(() => {});
          goToRoute("Ruta iniciada.");
          return;
        } catch (routeErr: unknown) {
          const routeMsg =
            (routeErr as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
          if (routeMsg.includes("no tenés una ruta")) {
            setError("No tenés envíos asignados para hoy. Consultá con el operador.");
            setLoading(false);
            return;
          }
          if (routeMsg.includes("ya está iniciada")) {
            stopScanner();
            driverApi.markRouteStarted().catch(() => {});
            goToRoute("Ruta en curso.");
            return;
          }
        }
      }
      setError(msg || "No se pudo reclamar el vehículo.");
    } finally {
      setLoading(false);
    }
  };

  const handleToken = async (token: string) => {
    if (loading) return;

    // Solo para choferes de última milla: evaluar si corresponde el gate de
    // fatiga antes de reclamar el vehículo.
    // El gate aplica únicamente para la SEGUNDA ruta en adelante del día;
    // para la primera ruta el backend devuelve requires_fatigue_test: false.
    // Los choferes intersucursales tienen su propio gate en DriverInterBranchTrip.
    if (user?.driver_type !== "intersucursal") {
      const gateStatus = await driverApi.getCheckinGateStatus();
      if (gateStatus.needs_test) {
        stopScanner();
        setPendingToken(token);
        setRequiresSleepData(gateStatus.requires_sleep_data);
        setShowGate(true);
        return;
      }
    }

    await claimAndNavigate(token);
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

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim().toUpperCase();
      if (trimmed) {
        setManualToken(trimmed);
        void handleToken(trimmed);
      }
    } catch {
      // Clipboard API not available — user types manually
    }
  };

  // Gate de fatiga post-escaneo: se muestra solo para la segunda ruta en
  // adelante. requiresSleepData siempre es false aquí porque las horas de
  // sueño ya fueron registradas durante el primer check-in del día.
  if (showGate && user) {
    return (
      <KssCheckIn
        driverId={user.id}
        misfireCount={0}
        requiresSleepData={requiresSleepData}
        onDone={() => {
          setShowGate(false);
          if (pendingToken) {
            void claimAndNavigate(pendingToken);
            setPendingToken(null);
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex flex-col items-center justify-center px-4 py-6">
      <div className="w-full max-w-sm flex flex-col items-center">

        {/* ── Header ────────────────────────────────────────── */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-full bg-[var(--brand-800)] flex items-center justify-center mb-3 shadow-lg">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Escanear vehículo</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1 text-center">
            Escaneá el código QR del vehículo para reclamar el viaje.
          </p>
        </div>

        {/* ── Loading ───────────────────────────────────────── */}
        {loading && (
          <div className="py-12 text-center animate-fade-in">
            <Loader2 className="w-12 h-12 text-[var(--brand)] animate-spin mx-auto mb-4" />
            <p className="text-lg font-bold text-[var(--text-primary)]">Escaneando…</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Reclamando vehículo…
            </p>
          </div>
        )}

        {/* ── Success ───────────────────────────────────────── */}
        {success && !loading && (
          <div className="py-12 text-center animate-fade-in">
            <CheckCircle2 className="w-16 h-16 text-[var(--ok)] mx-auto mb-4" />
            <p className="text-lg font-bold text-[var(--text-primary)] leading-snug">
              {success}
            </p>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────── */}
        {error && !loading && !success && (
          <div className="w-full flex flex-col items-center gap-3 px-5 py-6 rounded-2xl bg-[var(--danger-bg)] border border-[var(--danger-border)] animate-fade-in">
            <AlertCircle className="w-10 h-10 text-[var(--danger-c)]" />
            <p className="text-sm text-[var(--danger-text)] text-center leading-relaxed">
              {error}
            </p>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setError("")}
              className="mt-1 h-11 rounded-xl font-semibold text-sm"
            >
              Reintentar
            </Button>
          </div>
        )}

        {/* ── Main scan UI — hidden during loading/success ──── */}
        {!loading && !success && (
          <>
            {/* Camera viewfinder */}
            <div
              id="driver-qr-reader"
              className={`w-full aspect-square max-w-sm min-h-64 rounded-xl overflow-hidden bg-black border border-[var(--border)] mb-4 shadow-lg ${scanning ? "block" : "hidden"}`}
            />

            {!scanning ? (
              <Button
                variant="accent"
                onClick={() => void startScanner()}
                disabled={loading}
                className="w-full h-14 rounded-xl text-lg font-bold gap-2.5 shadow-md"
              >
                <QrCode className="w-5 h-5" />
                Escanear QR
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={stopScanner}
                className="w-full h-14 rounded-xl text-base font-semibold"
              >
                Cancelar escaneo
              </Button>
            )}

            {/* ── Manual token input ─────────────────────────── */}
            <div className="w-full mt-6">
              <p className="text-xs text-[var(--text-muted)] text-center mb-3">
                ¿No funciona la cámara? Ingresá la patente del vehículo:
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value.toUpperCase())}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData("text").trim().toUpperCase();
                      if (pasted) {
                        e.preventDefault();
                        setManualToken(pasted);
                        void handleToken(pasted);
                      }
                    }}
                    placeholder="Ej.: AB100UM"
                    className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)] transition-shadow"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && manualToken.trim()) void handleToken(manualToken.trim());
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handlePasteFromClipboard()}
                    aria-label="Pegar desde portapapeles"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors cursor-pointer"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
                <Button
                  onClick={() => { if (manualToken.trim()) void handleToken(manualToken.trim()); }}
                  disabled={!manualToken.trim() || loading}
                  variant="accent"
                  className="h-12 px-5 rounded-xl font-bold text-sm"
                >
                  OK
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
