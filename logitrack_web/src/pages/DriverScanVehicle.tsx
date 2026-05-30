import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, QrCode, AlertCircle, CheckCircle2 } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { interBranchTripsApi } from "../api/interBranchTrips";
import { driverApi } from "../api/driver";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";

export default function DriverScanVehicle() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const qrRef = useRef<Html5Qrcode | null>(null);

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
    setTimeout(() => navigate("/driver/route"), 900);
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
        // Marcar inicio de ruta antes de navegar. La llamada es fire-and-forget;
        // la navegación tiene 900 ms de delay, más que suficiente para que complete.
        driverApi.markRouteStarted().catch(() => {});
        goToRoute(`Vehículo ${trip.license_plate} asignado. Iniciando ruta…`);
      } else {
        setSuccess(`Vehículo ${trip.license_plate} asignado. Redirigiendo…`);
        setTimeout(() => navigate("/driver/trip"), 900);
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
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-full bg-[#1e3a5f] flex items-center justify-center mb-3">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Escanear vehículo</h1>
          <p className="text-sm text-slate-500 mt-1 text-center">
            Escaneá el código QR del vehículo para reclamar el viaje.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            {success}
          </div>
        )}

        {/* QR Scanner viewport */}
        <div
          id="driver-qr-reader"
          className={`w-full rounded-xl overflow-hidden border border-slate-200 bg-black mb-4 ${scanning ? "block" : "hidden"}`}
          style={{ minHeight: scanning ? 280 : 0 }}
        />

        {!scanning ? (
          <button
            onClick={() => void startScanner()}
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#1e3a5f] hover:bg-[#15294a] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <QrCode className="w-5 h-5" />
            Activar cámara
          </button>
        ) : (
          <button
            onClick={stopScanner}
            className="w-full h-12 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-sm transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        )}

        {/* Manual fallback */}
        <div className="mt-6">
          <p className="text-xs text-slate-500 text-center mb-2">¿No funciona la cámara? Ingresá la patente del vehículo:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value.toUpperCase())}
              placeholder="Ej.: AB100UM"
              className="flex-1 h-10 px-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              onKeyDown={(e) => { if (e.key === "Enter" && manualToken.trim()) void handleToken(manualToken.trim()); }}
            />
            <button
              onClick={() => { if (manualToken.trim()) void handleToken(manualToken.trim()); }}
              disabled={!manualToken.trim() || loading}
              className="h-10 px-4 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:opacity-40 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
