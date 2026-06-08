import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPin,
  Navigation,
  Package,
  Play,
  QrCode,
  Truck,
  Weight,
  X,
} from "lucide-react";
import { interBranchTripsApi, type InterBranchTrip, type TripQRResponse } from "../api/interBranchTrips";
import { driverApi } from "../api/driver";
import { publicTrackingApi } from "../api/publicTracking";
import type { Branch } from "../api/branches";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { KssCheckIn } from "../components/KssCheckIn";
import { useAuth } from "../context/AuthContext";
import { useGeolocation } from "../hooks/useGeolocation";
import { getPendingFatigueStep } from "../utils/fatigueWizardProgress";

// ---------------------------------------------------------------------------
// Haversine
// ---------------------------------------------------------------------------
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function cityAbbrev(city: string): string {
  const map: Record<string, string> = {
    "Ciudad de Buenos Aires": "CABA",
    "Buenos Aires": "CABA",
    Córdoba: "CBA",
    Mendoza: "MZA",
    Rosario: "ROS",
    Salta: "SAL",
    Posadas: "POS",
    Jujuy: "JUJ",
    Bariloche: "BRC",
    Tucumán: "TUC",
  };
  const key = Object.keys(map).find((k) => city.toLowerCase().includes(k.toLowerCase()));
  return key ? map[key] : city.slice(0, 3).toUpperCase();
}

function mapsUrl(lat: number, lng: number, label: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(label)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function DriverInterBranchTrip() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trip, setTrip] = useState<InterBranchTrip | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [noTrip, setNoTrip] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [unavailablePickups, setUnavailablePickups] = useState<Set<string>>(new Set());

  // Bloqueo automático de pantalla por alerta de fatiga (LOGITRACK-499).
  const [fatigueBlocked, setFatigueBlocked] = useState(false);
  const [fatigueUnblockedBy, setFatigueUnblockedBy] = useState<string | null>(null);
  // Gate de fatiga en ruta: true = mostrar KssCheckIn bloqueando la pantalla.
  const [midTripCheckin, setMidTripCheckin] = useState(false);
  // true si el driver aún no reportó sueño para el día logístico actual.
  const [requiresSleepData, setRequiresSleepData] = useState(true);
  // Evita disparar múltiples consultas al gate cuando el vehículo está detenido.
  const stopGateCheckedRef = useRef(false);
  // Índices de checkpoints ya procesados en esta jornada (no repetir la alerta).
  const checkpointPassedRef = useRef<Set<number>>(new Set());
  // Último current_stop_index conocido; permite detectar el avance de parada.
  const prevStopIndexRef = useRef<number | null>(null);
  // Ref estable al trip actual — usado en handleCheckinDone sin necesitar deps.
  const tripRef = useRef<typeof trip>(null);
  // Clave del evento de desbloqueo actualmente en pantalla (para persistir el ACK en sessionStorage).
  const pendingAckRef = useRef<string | null>(null);

  // QR modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState<TripQRResponse | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const [confirmedBranchName, setConfirmedBranchName] = useState("");

  // Collapsible
  const [shipmentsExpanded, setShipmentsExpanded] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Mapa
  const mapRefInternal = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const [mapDivMounted, setMapDivMounted] = useState(false);
  const mapRef = useCallback((node: HTMLDivElement | null) => {
    mapRefInternal.current = node;
    setMapDivMounted(node !== null);
  }, []);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Abre el gate de fatiga y consulta si el driver ya registró sueño hoy.
  const openCheckinGate = useCallback(async () => {
    try {
      const status = await driverApi.getTodayCheckin().catch(() => ({ ok: false as const, requires_sleep_data: true }));
      setRequiresSleepData(status.requires_sleep_data ?? true);
    } catch {
      setRequiresSleepData(true);
    }
    setMidTripCheckin(true);
  }, []);

  // Router Guard anti-bypass por F5: si quedó un wizard de fatiga a mitad de
  // camino (persistido en sessionStorage), forzar el gate de inmediato — el
  // backend ya da por completo el check-in apenas se envía el paso KSS, así
  // que no podemos confiar solo en su respuesta para decidir si mostrarlo.
  useEffect(() => {
    if (!user) return;
    if (!getPendingFatigueStep(user.id)) return;
    void openCheckinGate();
  }, [user, openCheckinGate]);

  // ── Simulación de ruta (modo ?gps=simulate) ────────────────────────────────
  // Los routePoints se derivan del trip y las branches. Mientras no haya datos
  // el hook recibe [] y no inicia el intervalo (ver implementación).
  const routePoints = useMemo(() => {
    if (!trip || !branches.length) return [];
    const origin = branches.find((b) => b.id === trip.origin_branch_id);
    if (!origin?.latitude) return [];
    const pts: { lat: number; lng: number }[] = [
      { lat: origin.latitude!, lng: origin.longitude! },
    ];
    const stops = trip.stops ?? [];
    stops.forEach((s) => {
      const b = branches.find((br) => br.id === s.branch_id);
      if (b?.latitude) pts.push({ lat: b.latitude!, lng: b.longitude! });
    });
    return pts;
  }, [trip, branches]);

  // Checkpoints sintéticos: punto medio entre cada par de stops de la ruta.
  // En un despliegue real estos vendrían de la API (peajes, balanzas, estaciones).
  // Cuando la posición simulada entra en 500 m de uno de estos puntos, se
  // consulta el backend y — si el check-in lleva >3h — se fuerza el re-test.
  const checkpoints = useMemo(() => {
    if (routePoints.length < 2) return [];
    const midpoints: { lat: number; lng: number }[] = [];
    for (let i = 0; i < routePoints.length - 1; i++) {
      const a = routePoints[i];
      const b = routePoints[i + 1];
      midpoints.push({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
    }
    return midpoints;
  }, [routePoints]);

  const { stoppedTimeMs, position } = useGeolocation(routePoints, undefined, 80);

  useEffect(() => { tripRef.current = trip; }, [trip]);

  const load = useCallback(async () => {
    try {
      // Branches usa el endpoint público — los choferes no tienen permiso en /branches.
      const [t, br] = await Promise.all([
        interBranchTripsApi.getMyTrip(),
        publicTrackingApi.getBranches(),
      ]);
      setTrip(t);
      setBranches(br);
      setNoTrip(false);

      // Verificar estado actual de pickups de paradas completadas.
      // Solo se muestran los que están loaded o in_transit (están físicamente en el camión).
      // Los que quedaron en at_hub (no subieron) o en estado terminal se ocultan.
      const ON_VEHICLE_STATUSES = new Set(["loaded", "in_transit"]);
      const curIdx = t.current_stop_index ?? 0;
      const completedPickupIds = (t.stops ?? [])
        .slice(0, curIdx)
        .flatMap((s) => s.pickup_shipment_ids ?? []);
      if (completedPickupIds.length > 0) {
        const statuses = await Promise.allSettled(
          completedPickupIds.map((tid) => publicTrackingApi.getShipment(tid))
        );
        const notOnVehicle = new Set<string>();
        statuses.forEach((result, i) => {
          if (result.status === "fulfilled" && !ON_VEHICLE_STATUSES.has(result.value.status)) {
            notOnVehicle.add(completedPickupIds[i]);
          }
        });
        setUnavailablePickups(notOnVehicle);
      }
    } catch {
      setNoTrip(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Polling cuando el modal QR está abierto
  useEffect(() => {
    if (!qrOpen || !trip) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }
    const prevStopIdx = trip.current_stop_index ?? 0;
    const prevStatus = trip.status;

    pollingRef.current = setInterval(async () => {
      try {
        const updated = await interBranchTripsApi.getMyTrip();
        const newIdx = updated.current_stop_index ?? 0;
        const advanced = newIdx > prevStopIdx || updated.status !== prevStatus;
        if (advanced) {
          // Mostrar overlay de éxito antes de cerrar modal
          const currentStop = trip.stops?.[prevStopIdx];
          const b = branches.find((br) => br.id === currentStop?.branch_id);
          setConfirmedBranchName(b?.address.city ?? currentStop?.branch_id ?? "");
          setStopConfirmed(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
          setTimeout(() => {
            setStopConfirmed(false);
            setQrOpen(false);
            setTrip(updated);
          }, 1800);
        }
      } catch { /* ignorar errores de red durante polling */ }
    }, 4000);

    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [qrOpen, trip, branches]);

  // Gate de fatiga por tiempo detenido (solo en modo simulación activa y viaje en tránsito).
  // Cuando stoppedTimeMs vuelve a 0 el ref se resetea para detectar la próxima parada larga.
  // La consulta al backend solo se dispara UNA VEZ por parada (al cruzar el umbral de 6 min).
  useEffect(() => {
    if (!trip || trip.status !== "en_transito" || midTripCheckin) return;

    if (stoppedTimeMs === 0) {
      stopGateCheckedRef.current = false; // vehículo en movimiento → resetear para próxima parada
      return;
    }
    if (stoppedTimeMs < 6 * 60 * 1000) return; // todavía bajo el umbral
    if (stopGateCheckedRef.current) return;     // ya consultamos para esta parada

    stopGateCheckedRef.current = true;
    driverApi
      .getTestEligibility({ stopped_minutes: Math.floor(stoppedTimeMs / 60_000) })
      .then((elig) => { if (elig.require_test) openCheckinGate(); })
      .catch(() => { /* error de red — no bloquear al chofer */ });
  }, [stoppedTimeMs, trip, midTripCheckin, openCheckinGate]);

  // Check-in obligatorio al salir de cada parada intermedia.
  // Trigger: cuando current_stop_index avanza en tiempo real (el operador
  // escaneó el QR de recepción en la sucursal de destino).
  //
  // IMPORTANTE — NO incluir midTripCheckin en las deps:
  // El overlay no cambia `trip`, así que el efecto no re-corre mientras está
  // activo. Incluirlo causaba un loop infinito: al cerrar el overlay,
  // midTripCheckin volvía a false y el efecto re-disparaba con el ref
  // desactualizado (era early-return durante el overlay y no se actualizaba).
  useEffect(() => {
    if (!trip) return;

    // Al completar el viaje: limpiar la entrada de localStorage.
    if (trip.status === "completado") {
      localStorage.removeItem(`trip_checkin_${trip.id}`);
      prevStopIndexRef.current = null;
      return;
    }

    if (trip.status !== "en_transito") {
      prevStopIndexRef.current = null;
      return;
    }

    const curIdx = trip.current_stop_index ?? 0;

    if (prevStopIndexRef.current === null) {
      // ── Carga inicial (o re-login) ───────────────────────────────────────
      // Comparar el índice actual contra el último guardado en localStorage.
      // Si el supervisor avanzó el índice mientras el chofer estaba fuera,
      // curIdx > stored → mostrar el check-in pendiente.
      const stored = parseInt(localStorage.getItem(`trip_checkin_${trip.id}`) ?? "0", 10);
      if (curIdx > stored) {
        openCheckinGate();
      }
      prevStopIndexRef.current = curIdx;
      return;
    }

    if (curIdx > prevStopIndexRef.current) {
      // El índice subió en tiempo real → nueva parada confirmada por QR.
      // Mostrar check-in antes de que el chofer salga hacia la siguiente.
      openCheckinGate();
    }

    // Actualizar SIEMPRE el ref, incluso si setMidTripCheckin fue llamado.
    prevStopIndexRef.current = curIdx;
  }, [trip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geocercas de checkpoints (Regla 5): al entrar en 500 m de un checkpoint
  // sintético y el viaje está en tránsito, consultar elegibilidad y forzar
  // el re-test si el último check-in fue hace más de 3 horas.
  useEffect(() => {
    if (!position || !trip || trip.status !== "en_transito" || midTripCheckin) return;
    for (let idx = 0; idx < checkpoints.length; idx++) {
      if (checkpointPassedRef.current.has(idx)) continue; // ya procesado
      const distM = haversineKm(position, checkpoints[idx]) * 1000;
      if (distM <= 500) {
        checkpointPassedRef.current.add(idx); // marcar como visitado
        driverApi
          .getTestEligibility({ checkpoint: true })
          .then((elig) => { if (elig.require_test) openCheckinGate(); })
          .catch(() => {});
        break; // procesar un checkpoint por tick
      }
    }
  }, [position, trip, midTripCheckin, checkpoints, openCheckinGate]);

  // Mapa Leaflet
  useEffect(() => {
    if (!trip || !mapRefInternal.current || !branches.length) return;
    const origin = branches.find((b) => b.id === trip.origin_branch_id);
    if (!origin?.latitude) return;

    const stops =
      trip.stops && trip.stops.length > 0
        ? trip.stops
        : trip.destination_branch_id
          ? [{ branch_id: trip.destination_branch_id, shipment_ids: trip.shipment_ids, total_weight_kg: trip.total_weight_kg }]
          : [];

    const points: { lat: number; lng: number; branch?: Branch; label: string; completed: boolean; current: boolean }[] = [
      { lat: origin.latitude!, lng: origin.longitude!, branch: origin, label: "Origen", completed: false, current: false },
    ];
    const curIdx = trip.current_stop_index ?? 0;
    stops.forEach((s, idx) => {
      const b = branches.find((br) => br.id === s.branch_id);
      if (b?.latitude)
        points.push({
          lat: b.latitude,
          lng: b.longitude!,
          branch: b,
          label: idx === stops.length - 1 ? "Destino final" : `Parada ${idx + 1}`,
          completed: idx < curIdx,
          current: idx === curIdx && trip.status === "en_transito",
        });
    });
    if (points.length < 2) return;

    import("leaflet").then((L) => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove(): void }).remove();
        mapInstanceRef.current = null;
      }
      const map = L.map(mapRefInternal.current!, { zoomControl: false, scrollWheelZoom: false });
      mapInstanceRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(map);

      const icon = (bg: string, content: string) =>
        L.divIcon({
          className: "",
          html: `<div style="background:${bg};color:#fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.3)">${content}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });

      points.forEach((p, i) => {
        let bg = "var(--sidebar-bg)", content = "🏭";
        if (i > 0) {
          if (p.completed) { bg = "#059669"; content = "✓"; }
          else if (p.current) { bg = "#0284c7"; content = "📍"; }
          else { bg = "#64748b"; content = String(i); }
        }
        L.marker([p.lat, p.lng], { icon: icon(bg, content) })
          .addTo(map)
          .bindPopup(`<b>${p.label}</b><br>${p.branch?.name ?? ""}<br>${p.branch?.address.city ?? ""}`);
      });

      const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
      // Fit to remaining route: from the last completed stop (or origin) to the end.
      // This keeps the driver focused on what's ahead after each stop is confirmed.
      const remainingLatlngs = points.slice(curIdx).map((p) => [p.lat, p.lng] as [number, number]);
      map.fitBounds(
        L.latLngBounds(remainingLatlngs.length >= 2 ? remainingLatlngs : latlngs),
        { padding: [40, 40] },
      );

      // Ruta real por carretera vía OSRM — usa legs para colorear por segmento
      const coordStr = points.map((p) => `${p.lng},${p.lat}`).join(";");
      fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=false&geometries=geojson&steps=false&alternatives=false&annotations=false`)
        .then((r) => r.json())
        .then((data) => {
          if (data.code !== "Ok" || !data.routes?.[0]?.legs) throw new Error("no route");
          // Pedir geometría por leg individual para colorear completados vs pendientes
          const legRequests: Promise<Response>[] = [];
          for (let i = 0; i < points.length - 1; i++) {
            const from = `${points[i].lng},${points[i].lat}`;
            const to = `${points[i + 1].lng},${points[i + 1].lat}`;
            legRequests.push(fetch(`https://router.project-osrm.org/route/v1/driving/${from};${to}?overview=full&geometries=geojson`));
          }
          return Promise.all(legRequests).then((responses) =>
            Promise.all(responses.map((r) => r.json()))
          ).then((legs) => {
            legs.forEach((legData, i) => {
              if (legData.code !== "Ok" || !legData.routes?.[0]) {
                // fallback línea recta para este segmento
                L.polyline([[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]], {
                  color: points[i + 1].completed ? "#059669" : "var(--sidebar-bg)",
                  weight: 3,
                  dashArray: points[i + 1].completed ? undefined : "8 6",
                }).addTo(map);
                return;
              }
              const coords: [number, number][] = legData.routes[0].geometry.coordinates.map(
                (c: number[]) => [c[1], c[0]] as [number, number],
              );
              L.polyline(coords, {
                color: points[i + 1].completed ? "#059669" : "var(--sidebar-bg)",
                weight: 3,
                opacity: 0.8,
                dashArray: points[i + 1].completed ? undefined : "8 6",
              }).addTo(map);
            });
          });
        })
        .catch(() => {
          // fallback: líneas rectas si OSRM no responde
          for (let i = 0; i < points.length - 1; i++) {
            L.polyline([[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]], {
              color: points[i + 1].completed ? "#059669" : "var(--sidebar-bg)",
              weight: 3,
              dashArray: points[i + 1].completed ? undefined : "8 6",
            }).addTo(map);
          }
        });
    }).catch(() => {});

    return () => {
      if (mapInstanceRef.current) { (mapInstanceRef.current as { remove(): void }).remove(); mapInstanceRef.current = null; }
    };
  }, [trip, branches, mapDivMounted]);

  // Polling de bloqueo por fatiga — cada 5 s mientras el viaje está en_transito (LOGITRACK-499).
  useEffect(() => {
    if (!trip || trip.status !== "en_transito") return;
    const poll = async () => {
      try {
        const data = await driverApi.getFatigueBlockStatus();
        const nowBlocked = data.blocked ?? false;
        setFatigueBlocked(nowBlocked);
        if (!nowBlocked && data.recently_unblocked && data.unblocked_by) {
          const ackKey = data.unblocked_at ?? "seen";
          const storedAck = sessionStorage.getItem("lt_fatigue_ack");
          pendingAckRef.current = ackKey;
          if (ackKey !== storedAck) {
            setFatigueUnblockedBy(data.unblocked_by);
          }
        }
      } catch {
        // Error de red → mantener estado actual (conservador)
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [trip]);

  const openQR = async () => {
    if (!trip) return;
    setQrOpen(true);
    if (!qrData) {
      setQrLoading(true);
      try {
        const data = await interBranchTripsApi.getQR(trip.id);
        setQrData(data);
      } catch { /* mostrar fallback */ }
      finally { setQrLoading(false); }
    }
  };

  const doStartTrip = async () => {
    if (!trip) return;
    setStarting(true);
    setError("");
    try {
      const updated = await interBranchTripsApi.startTrip(trip.id);
      setTrip(updated);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo iniciar el viaje.");
    } finally {
      setStarting(false);
    }
  };

  const handleStart = async () => {
    // El check-in del inicio del viaje (Buenos Aires) no se requiere.
    // Los check-ins se disparan en cada PARADA INTERMEDIA, no en el origen.
    await doStartTrip();
  };

  // Callback que recibe KssCheckIn al terminar (completar o saltear).
  // Persiste el índice actual en localStorage para que, si el chofer cierra
  // sesión y vuelve a entrar, el sistema sepa hasta qué parada ya hizo el test.
  const handleCheckinDone = useCallback(() => {
    setMidTripCheckin(false);
    setRequiresSleepData(false); // sueño ya registrado, no pedir de nuevo hoy
    const t = tripRef.current;
    if (t) {
      const curIdx = t.current_stop_index ?? 0;
      localStorage.setItem(`trip_checkin_${t.id}`, String(curIdx));
    }
  }, []);

  // Bloqueo por alerta de fatiga: overlay fixed encima del contenido para no
  // desmontar el mapa ni otros elementos del DOM (LOGITRACK-499).
  // Se renderiza al final del JSX como portal superpuesto.

  // Gate de fatiga: cubre la pantalla completa antes de que el chofer inicie
  // el viaje o cuando lleva más de 6 minutos detenido en ruta.
  if (midTripCheckin && user) {
    return (
      <KssCheckIn
        driverId={user.id}
        requiresSleepData={requiresSleepData}
        onDone={handleCheckinDone}
      />
    );
  }

  if (loading) return <TripSkeleton />;
  if (noTrip) return <NoTripView />;
  if (!trip) return null;

  const stops =
    trip.stops && trip.stops.length > 0
      ? trip.stops
      : trip.destination_branch_id
        ? [{ branch_id: trip.destination_branch_id, shipment_ids: trip.shipment_ids, total_weight_kg: trip.total_weight_kg, pickup_shipment_ids: [], pickup_weight_kg: 0 }]
        : [];

  const curIdx = trip.current_stop_index ?? 0;
  const origin = branches.find((b) => b.id === trip.origin_branch_id);
  const currentStop = stops[curIdx];
  const currentStopBranch = branches.find((b) => b.id === currentStop?.branch_id);

  // Distancia restante = desde la última posición conocida (origen si no completó
  // paradas, o la última parada completada) hasta la próxima parada.
  const previousLocationBranch =
    curIdx === 0
      ? origin
      : branches.find((b) => b.id === stops[curIdx - 1]?.branch_id);
  let distRemainingKm: number | null = null;
  if (previousLocationBranch?.latitude && currentStopBranch?.latitude) {
    distRemainingKm = Math.round(
      haversineKm(
        { lat: previousLocationBranch.latitude!, lng: previousLocationBranch.longitude! },
        { lat: currentStopBranch.latitude!, lng: currentStopBranch.longitude! },
      ),
    );
  }
  const etaHours = distRemainingKm !== null ? distRemainingKm / 80 : null;

  const completedStops = stops.slice(0, curIdx);
  const upcomingStops = stops.slice(curIdx + 1);

  // Pickups cargados en paradas anteriores que viajan en el camión y se
  // descargan en esta parada (o en la siguiente, si hay más hops).
  // Se excluyen los que ya tienen estado terminal (cancelado, destruido, etc.).
  const pickupsInTransit = completedStops
    .flatMap((s) => s.pickup_shipment_ids ?? [])
    .filter((tid) => !unavailablePickups.has(tid));
  const pickupsInTransitWeightKg = completedStops.reduce((sum, s) => sum + (s.pickup_weight_kg ?? 0), 0);

  const totalShipments = trip.shipment_ids.length;

  const statusMap: Record<string, { label: string; cls: string }> = {
    pendiente: { label: "Pendiente", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    en_transito: { label: "En ruta", cls: "bg-[var(--brand-100)] text-[var(--brand-800)] dark:bg-[var(--brand-tint)] dark:text-[var(--brand)]" },
    completado: { label: "Completado", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
    cancelado: { label: "Cancelado", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  };
  const st = statusMap[trip.status] ?? statusMap.pendiente;

  // ---------- Estado completado ----------
  if (trip.status === "completado") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--bg-page)]">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-5">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">Viaje completado</h1>
        <p className="text-[var(--text-secondary)] text-sm mb-6 text-center">
          {stops.length} parada{stops.length !== 1 ? "s" : ""} · {totalShipments} envíos · {trip.license_plate}
        </p>
        {trip.completed_at && (
          <p className="text-xs text-[var(--text-muted)] mb-8">
            {new Date(trip.completed_at).toLocaleString("es-AR")}
          </p>
        )}
        <Button
          onClick={() => navigate("/driver/scan")}
          className="h-14 px-10 rounded-xl text-base font-bold"
        >
          Volver al inicio
        </Button>
      </div>
    );
  }

  return (
    <div className="pb-28 bg-[var(--bg-page)] min-h-screen">
      {/* ── HEADER ── */}
      <header className="sticky top-0 z-10 bg-[var(--bg-card)]/95 backdrop-blur border-b border-[var(--border)]">
        <div className="px-4 max-w-2xl mx-auto py-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)] flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-[var(--text-primary)] leading-tight">
                  Viaje · <span className="font-mono tracking-tight">{trip.license_plate}</span>
                </h1>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${st.cls}`}>
                  {st.label}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-secondary)] mt-0.5">
                <span className="flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  {totalShipments} envío{totalShipments !== 1 ? "s" : ""}
                </span>
                <span className="flex items-center gap-1">
                  <Weight className="w-3 h-3" />
                  {trip.total_weight_kg.toFixed(0)} kg
                </span>
                <span className="font-mono text-[10px] text-[var(--text-muted)] truncate">{trip.id}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 max-w-2xl mx-auto pt-4 space-y-4">
        {error && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-sm text-[var(--danger-text)]">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError("")} className="text-xs font-semibold cursor-pointer min-h-[44px] flex items-center">
              Cerrar
            </button>
          </div>
        )}

        {/* ── PROGRESS: STEPPER HORIZONTAL ── */}
        <StepperBar
          origin={origin}
          stops={stops}
          currentStopIdx={curIdx}
          branches={branches}
          tripStatus={trip.status}
        />

        {/* ── HERO: PRÓXIMA PARADA ── */}
        {trip.status === "en_transito" && currentStop && (
          <HeroNextStop
            stop={currentStop}
            stopNumber={curIdx + 1}
            totalStops={stops.length}
            branch={currentStopBranch}
            distKm={distRemainingKm}
            etaHours={etaHours}
            pickupsInTransit={pickupsInTransit}
            pickupsInTransitWeightKg={pickupsInTransitWeightKg}
            shipmentsExpanded={shipmentsExpanded}
            onToggleShipments={() => setShipmentsExpanded((v) => !v)}
          />
        )}

        {/* ── MAPA ── */}
        {!!origin?.latitude && (
          <Card className="overflow-hidden !p-0 border-[var(--border)]" variant="muted">
            <div ref={mapRef} className="h-48 w-full" />
          </Card>
        )}

        {/* ── PARADAS COMPLETADAS ── */}
        {completedStops.length > 0 && (
          <section>
            <button
              onClick={() => setCompletedExpanded((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3 cursor-pointer min-h-[44px] w-full"
            >
              {completedExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Paradas completadas ({completedStops.length})
            </button>
            {completedExpanded && (
              <div className="space-y-2.5">
                {completedStops.map((s, idx) => {
                  const b = branches.find((br) => br.id === s.branch_id);
                  return (
                    <Card key={idx} className="!p-4 border-[var(--border)]" variant="muted">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-[var(--text-primary)]">{b?.name ?? s.branch_id}</p>
                          <p className="text-xs text-[var(--text-secondary)]">{b?.address.city}</p>
                        </div>
                        {s.completed_at && (
                          <p className="text-[11px] text-[var(--text-muted)] shrink-0">
                            {new Date(s.completed_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── PRÓXIMAS PARADAS ── */}
        {upcomingStops.length > 0 && (
          <section>
            <p className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
              Siguientes paradas
            </p>
            <div className="space-y-2.5">
              {upcomingStops.map((s, idx) => {
                const b = branches.find((br) => br.id === s.branch_id);
                const realIdx = curIdx + 1 + idx;
                const prevBranch = branches.find((br) => br.id === stops[realIdx - 1]?.branch_id);
                let legKm: number | null = null;
                if (prevBranch?.latitude && b?.latitude) {
                  legKm = Math.round(haversineKm(
                    { lat: prevBranch.latitude!, lng: prevBranch.longitude! },
                    { lat: b.latitude!, lng: b.longitude! },
                  ));
                }
                return (
                  <Card key={idx} className="!p-4 border-[var(--border)]" variant="muted">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--bg-muted)] dark:bg-slate-700 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-[var(--text-secondary)]">{realIdx + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[var(--text-primary)]">{b?.name ?? s.branch_id}</p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {b?.address.city}{b?.address.province ? `, ${b.address.province}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0 text-xs text-[var(--text-muted)] space-y-0.5">
                        {legKm !== null && <p className="font-medium">+{legKm} km</p>}
                        <p>{s.shipment_ids.length} env.</p>
                      </div>
                    </div>
                    {(s.pickup_shipment_ids?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 ml-11">
                        <ArrowUp className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                          Cargás {s.pickup_shipment_ids?.length} envío{s.pickup_shipment_ids!.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* Timestamps */}
        {trip.started_at && (
          <p className="text-xs text-[var(--text-muted)] text-center pt-2">
            Iniciado: {new Date(trip.started_at).toLocaleString("es-AR")}
          </p>
        )}
      </div>

      {/* ── CTA STICKY BOTTOM ── */}
      {trip.status === "en_transito" && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={openQR}
              className="w-full h-14 rounded-2xl bg-[var(--sidebar-bg)] hover:brightness-110 active:brightness-90 text-white text-lg font-bold flex items-center justify-center gap-2.5 cursor-pointer transition-all shadow-lg shadow-[var(--sidebar-bg)]/20"
            >
              <QrCode className="w-5 h-5" />
              Llegué — mostrar QR al operador
            </button>
          </div>
        </div>
      )}

      {/* Fallback para estado pendiente */}
      {trip.status === "pendiente" && (
        <div className="fixed bottom-0 inset-x-0 z-20 bg-[var(--bg-card)]/95 backdrop-blur border-t border-[var(--border)] px-4 py-3 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
          <div className="max-w-2xl mx-auto space-y-3">
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-[var(--warn-bg)] border border-[var(--warn-border)] text-xs text-[var(--warn-text)]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Al iniciar el viaje, los envíos pasan a estado <strong>en tránsito</strong>.</span>
            </div>
            <button
              onClick={handleStart}
              disabled={starting}
              className="w-full h-14 rounded-2xl bg-[var(--sidebar-bg)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white text-lg font-bold flex items-center justify-center gap-2.5 cursor-pointer transition-all shadow-lg"
            >
              <Play className="w-5 h-5" />
              {starting ? "Iniciando viaje…" : "Iniciar viaje"}
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL QR FULLSCREEN ── */}
      {qrOpen && (
        <QRModal
          trip={trip}
          currentStop={currentStop}
          currentStopBranch={currentStopBranch}
          pickupsInTransit={pickupsInTransit}
          qrData={qrData}
          qrLoading={qrLoading}
          stopConfirmed={stopConfirmed}
          confirmedBranchName={confirmedBranchName}
          onClose={() => { setQrOpen(false); if (pollingRef.current) clearInterval(pollingRef.current); }}
        />
      )}

      {/* Overlay de bloqueo por fatiga — fixed encima de todo, no desmonta el mapa */}
      {fatigueBlocked && (
        <div className="fixed inset-0 z-[9999] bg-[#1a1a2e] flex flex-col items-center justify-center p-8 text-center gap-6">
          <AlertTriangle size={64} className="text-red-500" />
          <h2 className="text-white text-[22px] font-bold m-0">
            Alerta de fatiga detectada
          </h2>
          <p className="text-slate-400 text-base leading-relaxed m-0">
            Tu supervisor fue notificado.<br/>
            Esperá su indicación antes de continuar.
          </p>
        </div>
      )}

      {/* Cartelito de autorización — se muestra cuando el supervisor desbloqueó la ruta (LOGITRACK-501) */}
      {!fatigueBlocked && fatigueUnblockedBy && (
        <div className="fixed inset-0 z-[9999] bg-[#0d1f12] flex flex-col items-center justify-center p-8 text-center gap-6">
          <CheckCircle2 size={64} className="text-emerald-500" />
          <h2 className="text-white text-[22px] font-bold m-0">
            Ruta autorizada
          </h2>
          <p className="text-green-300 text-base leading-relaxed m-0">
            Tu supervisor <strong className="text-white">{fatigueUnblockedBy}</strong> autorizó<br/>
            que continúes la ruta.
          </p>
          <button
            onClick={() => {
              if (pendingAckRef.current) sessionStorage.setItem("lt_fatigue_ack", pendingAckRef.current);
              setFatigueUnblockedBy(null);
            }}
            className="mt-2 px-9 py-3 rounded-[10px] border-none bg-green-600 text-white text-base font-bold cursor-pointer"
          >
            Continuar
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepperBar
// ---------------------------------------------------------------------------
type TripStopShape = {
  branch_id: string;
  shipment_ids: string[];
  total_weight_kg: number;
  pickup_shipment_ids?: string[];
  pickup_weight_kg?: number;
  completed_at?: string;
  completed_by_user_id?: string;
};

function StepperBar({
  origin,
  stops,
  currentStopIdx,
  branches,
  tripStatus,
}: {
  origin?: Branch;
  stops: TripStopShape[];
  currentStopIdx: number;
  branches: Branch[];
  tripStatus: string;
}) {
  const allPoints = [
    { id: origin?.id ?? "origin", city: origin?.address.city ?? "Origen", isOrigin: true },
    ...stops.map((s) => {
      const b = branches.find((br) => br.id === s.branch_id);
      return { id: s.branch_id, city: b?.address.city ?? s.branch_id, isOrigin: false };
    }),
  ];

  return (
    <Card className="!p-4 border-[var(--border)]" variant="muted">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">Progreso</p>
      <div className="flex items-start gap-0 overflow-x-auto pb-1">
        {allPoints.map((pt, idx) => {
          const isOriginPt = pt.isOrigin;
          const stopIdx = idx - 1;
          const isCompleted = !isOriginPt && stopIdx < currentStopIdx;
          const isCurrent =
            !isOriginPt && stopIdx === currentStopIdx && tripStatus === "en_transito";
          const isPending = !isOriginPt && stopIdx > currentStopIdx;
          const isLast = idx === allPoints.length - 1;

          let dotCls = "bg-[var(--text-muted)]";
          let dotContent = <span className="text-[10px] font-bold text-white">{idx}</span>;
          if (isOriginPt) {
            dotCls = "bg-[var(--sidebar-bg)]";
            dotContent = <Truck className="w-3.5 h-3.5 text-white" />;
          } else if (isCompleted) {
            dotCls = "bg-emerald-500";
            dotContent = <CheckCircle2 className="w-3.5 h-3.5 text-white" />;
          } else if (isCurrent) {
            dotCls = "bg-sky-500";
            dotContent = <MapPin className="w-3.5 h-3.5 text-white" />;
          }

          return (
            <div key={pt.id + idx} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center min-w-[52px]">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${dotCls} ${
                    isCurrent ? "ring-[3px] ring-sky-200 dark:ring-sky-500/30" : ""
                  }`}
                >
                  {dotContent}
                </div>
                <p
                  className={`text-[10px] font-semibold mt-1.5 text-center leading-tight ${
                    isPending
                      ? "text-[var(--text-muted)]"
                      : isCompleted
                        ? "text-emerald-600 dark:text-emerald-400"
                        : isCurrent
                          ? "text-sky-700 dark:text-sky-300"
                          : "text-[var(--text-secondary)]"
                  }`}
                >
                  {cityAbbrev(pt.city)}
                </p>
              </div>
              {!isLast && (
                <div
                  className={`flex-1 h-[3px] mt-[16px] mx-0.5 rounded-full ${
                    isCompleted
                      ? "bg-emerald-500"
                      : isCurrent
                        ? "bg-gradient-to-r from-emerald-500 to-[var(--border)]"
                        : "bg-[var(--border)]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// HeroNextStop
// ---------------------------------------------------------------------------
function HeroNextStop({
  stop,
  stopNumber,
  totalStops,
  branch,
  distKm,
  etaHours,
  pickupsInTransit,
  pickupsInTransitWeightKg,
  shipmentsExpanded,
  onToggleShipments,
}: {
  stop: TripStopShape;
  stopNumber: number;
  totalStops: number;
  branch?: Branch;
  distKm: number | null;
  etaHours: number | null;
  pickupsInTransit: string[];
  pickupsInTransitWeightKg: number;
  shipmentsExpanded: boolean;
  onToggleShipments: () => void;
}) {
  const hasPickup = (stop.pickup_shipment_ids?.length ?? 0) > 0;
  const allDropoffs = [...stop.shipment_ids, ...pickupsInTransit];
  const mapsLink =
    branch?.latitude && branch?.longitude
      ? mapsUrl(branch.latitude, branch.longitude, branch.name)
      : null;

  return (
    <Card className="!p-5 border-2 border-[var(--sidebar-bg)]/10 dark:border-[var(--sidebar-bg)]/20 bg-gradient-to-br from-[var(--bg-card)] to-[var(--bg-subtle)]">
      {/* Chip de parada */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold px-3 py-1 rounded-full bg-[var(--sidebar-bg)]/10 text-[var(--sidebar-bg)] uppercase tracking-wider">
          Parada {stopNumber} de {totalStops}
        </span>
        {distKm !== null && (
          <span className="text-xs text-[var(--text-secondary)] font-medium">{distKm} km aprox.</span>
        )}
      </div>

      {/* Sucursal */}
      <div className="mb-4">
        <h2 className="text-xl font-bold text-[var(--text-primary)] leading-tight">{branch?.name ?? stop.branch_id}</h2>
        {branch?.address && (
          <div className="flex items-center gap-1.5 mt-1 text-[var(--text-secondary)]">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <p className="text-xs leading-snug">
              {branch.address.street && `${branch.address.street}, `}
              {branch.address.city}{branch.address.province ? `, ${branch.address.province}` : ""}
            </p>
          </div>
        )}
      </div>

      {/* ETA */}
      {etaHours !== null && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-[var(--bg-muted)] dark:bg-slate-800 flex items-center gap-3">
          <span className="text-xs font-semibold text-[var(--text-secondary)]">ETA estimada</span>
          <span className="ml-auto text-base font-bold text-[var(--sidebar-bg)]">~{formatDuration(etaHours)}</span>
        </div>
      )}

      {/* Carga que baja / sube */}
      <div className="space-y-2 mb-5">
        <div className="flex items-center gap-2 py-2.5 text-sm">
          <ArrowDown className="w-4 h-4 text-[var(--text-muted)]" />
          <span className="text-[var(--text-primary)]">
            Bajan: <strong>{allDropoffs.length} envío{allDropoffs.length !== 1 ? "s" : ""}</strong>
          </span>
          <Weight className="w-3.5 h-3.5 text-[var(--text-muted)] ml-auto" />
          <span className="text-[var(--text-secondary)] text-xs">{(stop.total_weight_kg + pickupsInTransitWeightKg).toFixed(1)} kg</span>
        </div>
        {pickupsInTransit.length > 0 && (
          <p className="text-[11px] text-sky-700 dark:text-sky-400 ml-6">
            Incluye {pickupsInTransit.length} envío{pickupsInTransit.length !== 1 ? "s" : ""} cargados en parada anterior
          </p>
        )}
        {hasPickup && (
          <div className="flex items-center gap-2 py-2.5 text-sm text-amber-700 dark:text-amber-400 font-medium">
            <ArrowUp className="w-4 h-4" />
            Cargás: <strong>{stop.pickup_shipment_ids!.length} envío{stop.pickup_shipment_ids!.length !== 1 ? "s" : ""}</strong>
            <span className="ml-auto text-xs font-normal">{(stop.pickup_weight_kg ?? 0).toFixed(1)} kg</span>
          </div>
        )}
      </div>

      {/* Botones */}
      <div className="flex flex-col gap-2.5">
        {mapsLink && (
          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-14 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-lg font-bold flex items-center justify-center gap-2.5 cursor-pointer transition-colors"
          >
            <Navigation className="w-5 h-5" />
            Navegar con Maps
          </a>
        )}
        <button
          onClick={onToggleShipments}
          className="w-full h-12 rounded-xl border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <Package className="w-4 h-4" />
          Ver lista de envíos
          {shipmentsExpanded ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
        </button>
        {shipmentsExpanded && allDropoffs.length > 0 && (
          <div className="mt-1 rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
            {stop.shipment_ids.map((tid) => (
              <div key={tid} className="px-4 py-3 flex items-center gap-2 min-h-[44px]">
                <span className="text-xs font-mono text-[var(--text-primary)]">{tid}</span>
              </div>
            ))}
            {pickupsInTransit.length > 0 && (
              <>
                <div className="px-4 py-2 bg-sky-50 dark:bg-sky-950/30">
                  <p className="text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                    Bajan — Cargados en parada anterior
                  </p>
                </div>
                {pickupsInTransit.map((tid) => (
                  <div key={tid} className="px-4 py-3 flex items-center gap-2 bg-sky-50/40 dark:bg-sky-950/20 min-h-[44px]">
                    <span className="text-xs font-mono text-sky-800 dark:text-sky-300">{tid}</span>
                  </div>
                ))}
              </>
            )}
            {hasPickup && (
              <>
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30">
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                    Para cargar
                  </p>
                </div>
                {stop.pickup_shipment_ids!.map((tid) => (
                  <div key={tid} className="px-4 py-3 flex items-center gap-2 bg-amber-50/50 dark:bg-amber-950/20 min-h-[44px]">
                    <span className="text-xs font-mono text-amber-800 dark:text-amber-300">{tid}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// QRModal
// ---------------------------------------------------------------------------
function QRModal({
  trip,
  currentStop,
  currentStopBranch,
  pickupsInTransit,
  qrData,
  qrLoading,
  stopConfirmed,
  confirmedBranchName,
  onClose,
}: {
  trip: InterBranchTrip;
  currentStop?: TripStopShape;
  currentStopBranch?: Branch;
  pickupsInTransit: string[];
  qrData: TripQRResponse | null;
  qrLoading: boolean;
  stopConfirmed: boolean;
  confirmedBranchName: string;
  onClose: () => void;
}) {
  return (
    /* Backdrop — z-[9999] para quedar por encima de Leaflet (z ~400) y del nav */
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-[#0f1b34]/70"
      onClick={onClose}
    >
      {/* Card — click dentro no cierra */}
      <div
        className="relative w-full sm:max-w-sm bg-[var(--bg-card)] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle / Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <div>
            <p className="text-sm font-bold text-[var(--text-primary)]">
              Entregando en {currentStopBranch?.name ?? currentStop?.branch_id}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">{currentStopBranch?.address.city}</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--bg-muted)] hover:bg-[var(--bg-inset)] flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Cuerpo con scroll */}
        <div className="flex flex-col items-center px-6 py-5 gap-4 overflow-y-auto">
          {stopConfirmed ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-base font-bold text-[var(--text-primary)]">Recepción confirmada</p>
              <p className="text-sm text-[var(--text-secondary)]">en {confirmedBranchName}</p>
            </div>
          ) : (
            <>
              {/* QR */}
              <div className="flex flex-col items-center gap-2 w-full">
                {qrLoading ? (
                  <div className="w-56 h-56 rounded-2xl bg-[var(--bg-muted)] animate-pulse" />
                ) : qrData ? (
                  <div className="p-3 bg-white rounded-2xl border-2 border-[var(--sidebar-bg)]/20 shadow-md">
                    <img
                      src={`data:image/png;base64,${qrData.qr_code_base64}`}
                      alt="QR del viaje"
                      className="w-56 h-56"
                    />
                  </div>
                ) : (
                  <div className="w-56 h-56 rounded-2xl border-2 border-dashed border-[var(--border)] flex items-center justify-center">
                    <p className="text-sm text-[var(--text-muted)] text-center px-4">No se pudo cargar el QR.</p>
                  </div>
                )}
                <p className="text-[11px] font-mono text-[var(--text-muted)]">{trip.id}</p>
              </div>

              {/* Indicador de espera */}
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
                Esperando que el operador escanee…
              </div>

              {/* Envíos que bajan — propios + pickups de paradas anteriores */}
              {currentStop && (currentStop.shipment_ids.length > 0 || pickupsInTransit.length > 0) && (() => {
                const allBajan = [...currentStop.shipment_ids, ...pickupsInTransit];
                return (
                  <div className="w-full">
                    <p className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
                      ↓ Bajan {allBajan.length} envío{allBajan.length !== 1 ? "s" : ""}
                    </p>
                    <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden max-h-36 overflow-y-auto">
                      {currentStop.shipment_ids.map((tid) => (
                        <div key={tid} className="px-3 py-1.5">
                          <span className="text-xs font-mono text-[var(--text-primary)]">{tid}</span>
                        </div>
                      ))}
                      {pickupsInTransit.length > 0 && (
                        <>
                          <div className="px-3 py-1 bg-sky-50 dark:bg-sky-950/30">
                            <p className="text-[10px] font-bold text-sky-600 dark:text-sky-400 uppercase tracking-wider">
                              Cargados en parada anterior
                            </p>
                          </div>
                          {pickupsInTransit.map((tid) => (
                            <div key={tid} className="px-3 py-1.5 bg-sky-50/30 dark:bg-sky-950/20">
                              <span className="text-xs font-mono text-sky-800 dark:text-sky-300">{tid}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / Loading views
// ---------------------------------------------------------------------------
function NoTripView() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--bg-page)]">
      <div className="w-24 h-24 rounded-full bg-[var(--bg-muted)] flex items-center justify-center mb-6">
        <Package className="w-12 h-12 text-[var(--text-muted)]" />
      </div>
      <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">Sin viajes asignados</h1>
      <p className="text-sm text-[var(--text-secondary)] text-center max-w-xs mb-8">
        No tenés ningún viaje inter-sucursal asignado por el momento. Si el operador ya asignó tu vehículo, escaneá el QR para tomar el viaje.
      </p>
      <Button
        onClick={() => navigate("/driver/scan")}
        className="h-14 px-8 rounded-xl text-base font-bold gap-2"
      >
        <QrCode className="w-5 h-5" />
        Escanear vehículo
      </Button>
    </div>
  );
}

function TripSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      {/* Header skeleton */}
      <div className="sticky top-0 z-10 bg-[var(--bg-card)] border-b border-[var(--border)]">
        <div className="px-4 max-w-2xl mx-auto py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-11 h-11 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </div>
      </div>

      {/* Content skeleton */}
      <div className="px-4 max-w-2xl mx-auto pt-4 space-y-4">
        {/* Stepper */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <Skeleton className="h-3 w-20 mb-3" />
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <Skeleton className="w-8 h-8 rounded-full" />
                <Skeleton className="h-2.5 w-10" />
              </div>
            ))}
          </div>
        </div>

        {/* Hero card */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
          <div className="flex justify-between">
            <Skeleton className="h-6 w-32 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>

        {/* Map */}
        <Skeleton className="h-48 w-full rounded-xl" />

        {/* Stop cards */}
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-8 w-14 shrink-0" />
            </div>
          </div>
        ))}
      </div>

      {/* Bottom CTA skeleton */}
      <div className="fixed bottom-0 inset-x-0 bg-[var(--bg-card)] border-t border-[var(--border)] px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
