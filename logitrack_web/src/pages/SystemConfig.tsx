import { useState, useEffect, useMemo } from "react";
import { AlertCircle, CheckCircle2, Minus, Plus, Clock, RotateCcw, ShieldCheck, Mail } from "lucide-react";
import { systemConfigApi, type SystemConfig as SystemConfigType } from "../api/systemConfig";
import { clockApi, type ClockState } from "../api/clock";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { fmtDateTimeSeconds } from "../utils/date";

const pad = (n: number) => String(n).padStart(2, "0");

// Convierte un Date a string apto para <input type="datetime-local"> (hora local).
const dateToLocalInput = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// Interpreta el valor de un datetime-local como hora local del navegador y lo
// serializa a ISO con timezone, que es lo que el backend espera (RFC3339).
const localInputToIso = (local: string): string => new Date(local).toISOString();

export function SystemConfig() {
  const [config, setConfig] = useState<SystemConfigType | null>(null);
  const [draft, setDraft] = useState<SystemConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Reloj del sistema
  const [clockState, setClockState] = useState<ClockState | null>(null);
  const [clockSaving, setClockSaving] = useState(false);
  const [clockError, setClockError] = useState("");
  const [overrideInput, setOverrideInput] = useState("");
  const [overrideInputInitialized, setOverrideInputInitialized] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    systemConfigApi
      .get()
      .then((cfg) => {
        setConfig(cfg);
        setDraft(cfg);
      })
      .catch(() => setError("No se pudo cargar la configuración."))
      .finally(() => setLoading(false));
  }, []);

  // Carga inicial del reloj + refresh periódico (por si otro admin lo cambió).
  useEffect(() => {
    const fetchClock = () => {
      clockApi
        .get()
        .then(setClockState)
        .catch(() => setClockError("No se pudo cargar el estado del reloj."));
    };
    fetchClock();
    const id = setInterval(fetchClock, 30000);
    return () => clearInterval(id);
  }, []);

  // Tick para refrescar el display del reloj cada segundo.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Pre-popula el input con la hora actual del sistema la primera vez que cargamos.
  useEffect(() => {
    if (!overrideInputInitialized && clockState) {
      const initial = new Date(Date.now() + clockState.offset_ms);
      setOverrideInput(dateToLocalInput(initial));
      setOverrideInputInitialized(true);
    }
  }, [clockState, overrideInputInitialized]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const updated = await systemConfigApi.update(draft);
      setConfig(updated);
      setDraft(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo guardar la configuración.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSetOverride = async () => {
    if (!overrideInput) return;
    setClockSaving(true);
    setClockError("");
    try {
      const iso = localInputToIso(overrideInput);
      const next = await clockApi.setOverride(iso);
      setClockState(next);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo aplicar el override.";
      setClockError(msg);
    } finally {
      setClockSaving(false);
    }
  };

  const handleClearOverride = async () => {
    setClockSaving(true);
    setClockError("");
    try {
      const next = await clockApi.clear();
      setClockState(next);
      // Reset input al ahora real para futuros usos.
      setOverrideInput(dateToLocalInput(new Date()));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudo limpiar el override.";
      setClockError(msg);
    } finally {
      setClockSaving(false);
    }
  };

  // Display del reloj: usa el offset conocido + Date.now() local para que el
  // segundero avance sin tener que repollear el backend.
  const { displayedSystemNow, displayedRealNow } = useMemo(() => {
    void tick;
    if (!clockState) return { displayedSystemNow: null, displayedRealNow: null };
    const realNow = new Date();
    const systemNow = new Date(realNow.getTime() + clockState.offset_ms);
    return { displayedSystemNow: systemNow, displayedRealNow: realNow };
  }, [tick, clockState]);

  const isDirty =
    draft !== null && config !== null && (
      draft.max_delivery_attempts !== config.max_delivery_attempts ||
      draft.draft_retention_days !== config.draft_retention_days ||
      draft.draft_purge_days !== config.draft_purge_days ||
      draft.pickup_deadline_days !== config.pickup_deadline_days ||
      draft.email_notifications_enabled !== config.email_notifications_enabled ||
      draft.whatsapp_notifications_enabled !== config.whatsapp_notifications_enabled ||
      draft.max_reschedules !== config.max_reschedules ||
      draft.max_reschedule_days !== config.max_reschedule_days ||
      draft.two_fa_cooldown_minutes !== config.two_fa_cooldown_minutes
    );

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      {loading ? (
        <Card className="p-10 text-center">
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : draft && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Intentos de entrega</CardTitle>
              <CardDescription>
                Cantidad máxima de intentos fallidos antes de que el envío pase automáticamente a <strong>Listo para retiro en mostrador</strong>. Rango permitido: 1–10.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-5">
                <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                  Máximo de intentos fallidos
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, max_delivery_attempts: Math.max(1, d.max_delivery_attempts - 1) } : d
                      )
                    }
                    disabled={draft.max_delivery_attempts <= 1}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4 text-slate-700" />
                  </button>
                  <span className="min-w-[40px] text-center text-2xl font-extrabold text-[var(--sidebar-bg)] tabular-nums">
                    {draft.max_delivery_attempts}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, max_delivery_attempts: Math.min(10, d.max_delivery_attempts + 1) } : d
                      )
                    }
                    disabled={draft.max_delivery_attempts >= 10}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 text-slate-700" />
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={draft.max_delivery_attempts}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, max_delivery_attempts: Number(e.target.value) } : d
                      )
                    }
                    className="w-32 accent-[var(--sidebar-bg)]"
                  />
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Draft lifecycle */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-slate-500" />
                <CardTitle>Ciclo de vida de borradores (Ley 25.326)</CardTitle>
              </div>
              <CardDescription>
                Define por cuántos días los borradores permanecen activos y cuándo se purgan los datos personales conforme a la normativa de protección de datos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Draft retention days */}
              <div className="flex items-center gap-4">
                <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                  Vigencia del borrador (días)
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, draft_retention_days: Math.max(1, d.draft_retention_days - 1) } : d
                      )
                    }
                    disabled={draft.draft_retention_days <= 1}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4 text-slate-700" />
                  </button>
                  <span className="min-w-[40px] text-center text-2xl font-extrabold text-[var(--sidebar-bg)] tabular-nums">
                    {draft.draft_retention_days}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, draft_retention_days: Math.min(365, d.draft_retention_days + 1) } : d
                      )
                    }
                    disabled={draft.draft_retention_days >= 365}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 text-slate-700" />
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={draft.draft_retention_days}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, draft_retention_days: Number(e.target.value) } : d
                      )
                    }
                    className="w-32 accent-[var(--sidebar-bg)]"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Transcurrido este período el borrador pasa a "Expirado" y deja de ser visible para operadores.
                </p>
              </div>

              {/* Draft purge days */}
              <div className="flex items-center gap-4">
                <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                  Retención tras expiración (días)
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, draft_purge_days: Math.max(1, d.draft_purge_days - 1) } : d
                      )
                    }
                    disabled={draft.draft_purge_days <= 1}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4 text-slate-700" />
                  </button>
                  <span className="min-w-[40px] text-center text-2xl font-extrabold text-[var(--sidebar-bg)] tabular-nums">
                    {draft.draft_purge_days}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, draft_purge_days: Math.min(1825, d.draft_purge_days + 1) } : d
                      )
                    }
                    disabled={draft.draft_purge_days >= 1825}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 text-slate-700" />
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={180}
                    value={draft.draft_purge_days}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, draft_purge_days: Number(e.target.value) } : d
                      )
                    }
                    className="w-32 accent-[var(--sidebar-bg)]"
                  />
                </div>
                <p className="text-xs text-slate-400">
                  Días después de expirar hasta que se eliminan nombre, DNI, email, teléfono y dirección de forma irreversible.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Pickup deadline */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Retiro en sucursal</CardTitle>
              <CardDescription>
                Plazo máximo de días para retirar un envío disponible en sucursal. El destinatario lo verá en el email de notificación. <strong>0 = sin límite</strong> (no se muestra fecha en el email). Rango: 0–365 días.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                  Días para retirar
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, pickup_deadline_days: Math.max(0, d.pickup_deadline_days - 1) } : d
                      )
                    }
                    disabled={draft.pickup_deadline_days <= 0}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4 text-slate-700" />
                  </button>
                  <span className="min-w-[40px] text-center text-2xl font-extrabold text-[var(--sidebar-bg)] tabular-nums">
                    {draft.pickup_deadline_days === 0 ? "∞" : draft.pickup_deadline_days}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, pickup_deadline_days: Math.min(365, d.pickup_deadline_days + 1) } : d
                      )
                    }
                    disabled={draft.pickup_deadline_days >= 365}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 text-slate-700" />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={draft.pickup_deadline_days}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, pickup_deadline_days: Number(e.target.value) } : d
                      )
                    }
                    className="w-32 accent-[var(--sidebar-bg)]"
                  />
                </div>
                {draft.pickup_deadline_days === 0 && (
                  <p className="text-xs text-slate-400">Sin límite — no se muestra fecha en el email.</p>
                )}
              </div>
            </CardContent>
          </Card>
          {/* Notificaciones */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-500" />
                <CardTitle>Canales de notificaciones al cliente</CardTitle>
              </div>
              <CardDescription>
                Controlá de forma independiente qué canales se usan para notificar a los clientes. Si ambos están activos, se envían por los dos canales en paralelo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Email */}
              <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={draft.email_notifications_enabled}
                    onChange={(e) =>
                      setDraft((d) => d ? { ...d, email_notifications_enabled: e.target.checked } : d)
                    }
                  />
                  <div
                    className={`w-11 h-6 rounded-full transition-colors ${draft.email_notifications_enabled ? "bg-[var(--sidebar-bg)]" : "bg-slate-200"}`}
                  />
                  <div
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform bg-white ${draft.email_notifications_enabled ? "translate-x-5" : "translate-x-0"}`}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-700">Notificaciones por email</span>
              </label>
              {/* WhatsApp */}
              <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={draft.whatsapp_notifications_enabled}
                    onChange={(e) =>
                      setDraft((d) => d ? { ...d, whatsapp_notifications_enabled: e.target.checked } : d)
                    }
                  />
                  <div
                    className={`w-11 h-6 rounded-full transition-colors ${draft.whatsapp_notifications_enabled ? "bg-[var(--sidebar-bg)]" : "bg-slate-200"}`}
                  />
                  <div
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform bg-white ${draft.whatsapp_notifications_enabled ? "translate-x-5" : "translate-x-0"}`}
                  />
                </div>
                <span className="text-sm font-semibold text-slate-700">Notificaciones por WhatsApp</span>
              </label>
              {!draft.email_notifications_enabled && !draft.whatsapp_notifications_enabled && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Ambos canales deshabilitados — no se enviarán notificaciones al cliente.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reprogramaciones vía chatbot */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-slate-500" />
                <CardTitle>Reprogramaciones vía chatbot</CardTitle>
              </div>
              <CardDescription>
                Cantidad máxima de veces que un cliente puede reprogramar la entrega desde el chatbot antes de requerir intervención manual. Rango permitido: 0–10.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                  Máximo de reprogramaciones
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, max_reschedules: Math.max(0, d.max_reschedules - 1) } : d
                      )
                    }
                    disabled={draft.max_reschedules <= 0}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4 text-slate-700" />
                  </button>
                  <span className="min-w-[40px] text-center text-2xl font-extrabold text-[var(--sidebar-bg)] tabular-nums">
                    {draft.max_reschedules}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, max_reschedules: Math.min(10, d.max_reschedules + 1) } : d
                      )
                    }
                    disabled={draft.max_reschedules >= 10}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 text-slate-700" />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={draft.max_reschedules}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, max_reschedules: Number(e.target.value) } : d
                      )
                    }
                    className="w-32 accent-[var(--sidebar-bg)]"
                  />
                </div>
              </div>

              {/* Helper text */}
              <div className="mt-3 text-xs text-slate-500">
                {draft.max_reschedules === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Los clientes no podrán reprogramar entregas vía chatbot.
                  </div>
                ) : (
                  <p>
                    Los clientes podrán reprogramar hasta <strong>{draft.max_reschedules}</strong> {draft.max_reschedules === 1 ? 'vez' : 'veces'} desde el chatbot. Los cambios se aplican inmediatamente para nuevas solicitudes.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          {/*Ventana de reprogramación */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500" />
                <CardTitle>Ventana de reprogramación</CardTitle>
              </div>
              <CardDescription>
                Cantidad máxima de días hacia adelante (desde la fecha original) que un cliente puede reprogramar la entrega desde el chatbot. Rango permitido: 1–7 días.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                  Días permitidos para reprogramar
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, max_reschedule_days: Math.max(1, d.max_reschedule_days - 1) } : d
                      )
                    }
                    disabled={draft.max_reschedule_days <= 1}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4 text-slate-700" />
                  </button>
                  <span className="min-w-[40px] text-center text-2xl font-extrabold text-[var(--sidebar-bg)] tabular-nums">
                    {draft.max_reschedule_days}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, max_reschedule_days: Math.min(7, d.max_reschedule_days + 1) } : d
                      )
                    }
                    disabled={draft.max_reschedule_days >= 7}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 text-slate-700" />
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={7}
                    value={draft.max_reschedule_days}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, max_reschedule_days: Number(e.target.value) } : d
                      )
                    }
                    className="w-32 accent-[var(--sidebar-bg)]"
                  />
                </div>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                <p>
                  Los clientes podrán reprogramar dentro de los próximos <strong>{draft.max_reschedule_days}</strong> {draft.max_reschedule_days === 1 ? 'día' : 'días'} desde la fecha original. Cambios aplicados inmediatamente para nuevas solicitudes.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ✅ NUEVO: Seguridad 2FA */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-slate-500" />
                <CardTitle>Seguridad 2FA</CardTitle>
              </div>
              <CardDescription>
                Tiempo de bloqueo obligatorio después de 3 intentos fallidos de código durante la activación o verificación de autenticación de doble factor. Rango permitido: 1–10 minutos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <label className="text-sm font-semibold text-slate-700 min-w-[200px]">
                  Bloqueo tras 3 intentos fallidos
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, two_fa_cooldown_minutes: Math.max(1, d.two_fa_cooldown_minutes - 1) } : d
                      )
                    }
                    disabled={draft.two_fa_cooldown_minutes <= 1}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Minus className="w-4 h-4 text-slate-700" />
                  </button>
                  <span className="min-w-[60px] text-center text-2xl font-extrabold text-[var(--sidebar-bg)] tabular-nums">
                    {draft.two_fa_cooldown_minutes} min
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) =>
                        d ? { ...d, two_fa_cooldown_minutes: Math.min(10, d.two_fa_cooldown_minutes + 1) } : d
                      )
                    }
                    disabled={draft.two_fa_cooldown_minutes >= 10}
                    className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Plus className="w-4 h-4 text-slate-700" />
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={draft.two_fa_cooldown_minutes}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, two_fa_cooldown_minutes: Number(e.target.value) } : d
                      )
                    }
                    className="w-32 accent-[var(--sidebar-bg)]"
                  />
                </div>
              </div>

              <div className="mt-3 text-xs text-slate-500">
                <p>
                  Después de 3 códigos incorrectos, el usuario debe esperar <strong>{draft.two_fa_cooldown_minutes}</strong> {draft.two_fa_cooldown_minutes === 1 ? 'minuto' : 'minutos'} antes de poder reintentar. Aplica tanto en la configuración inicial como en el login con 2FA activo.
                </p>
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                  <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-800">
                    <strong className="font-semibold">Recomendación:</strong> Se sugiere configurar al menos <strong>5 minutos</strong> para mitigar ataques de fuerza bruta. Un cooldown muy bajo (1-2 minutos) puede facilitar intentos automatizados de adivinación de códigos TOTP.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          {/* Save / discard — always below all config cards */}
          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Configuración guardada correctamente.
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="h-10 px-5 rounded-lg bg-[var(--sidebar-bg)] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              {isDirty && (
                <button
                  onClick={() => setDraft(config)}
                  disabled={saving}
                  className="h-10 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 cursor-pointer transition-colors"
                >
                  Descartar
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[var(--sidebar-bg)]" />
            Reloj del sistema (testing)
          </CardTitle>
          <CardDescription>
            Permite simular una fecha y hora distintas para que todo el sistema (ruteo, SLA, timestamps) se comporte como si fuese ese momento. El override vive solo en memoria: si reiniciás el backend se limpia automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clockState?.is_active && (
            <div className="flex items-start gap-2 mb-4 px-4 py-3 rounded-lg border-2 border-rose-300 bg-rose-50 text-sm text-rose-800">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <strong className="font-bold">Override activo —</strong> el sistema NO está usando el reloj real. Acordate de restaurarlo cuando termines.
              </div>
            </div>
          )}

          <div className="mb-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Hora del sistema
            </div>
            <div
              className={`text-3xl font-extrabold tabular-nums ${clockState?.is_active ? "text-rose-700" : "text-[var(--sidebar-bg)]"
                }`}
            >
              {displayedSystemNow ? fmtDateTimeSeconds(displayedSystemNow) : "—"}
            </div>
            {clockState?.is_active && displayedRealNow && (
              <div className="text-xs text-slate-500 mt-1 tabular-nums">
                Hora real: {fmtDateTimeSeconds(displayedRealNow)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-600">
                Nueva fecha y hora
              </label>
              <input
                type="datetime-local"
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                disabled={clockSaving}
                className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 focus:outline-none focus:ring-[3px] focus:ring-[var(--brand)]/20 focus:border-[var(--brand)] transition-all tabular-nums"
              />
            </div>
            <button
              onClick={handleSetOverride}
              disabled={clockSaving || !overrideInput}
              className="h-10 px-5 rounded-lg bg-[var(--sidebar-bg)] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer"
            >
              {clockSaving ? "Aplicando…" : "Aplicar override"}
            </button>
          </div>

          {clockState?.is_active && (
            <button
              onClick={handleClearOverride}
              disabled={clockSaving}
              className="h-10 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold transition-colors disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Restaurar hora real
            </button>
          )}

          {clockError && (
            <div className="flex items-center gap-2 mt-3 px-4 py-2.5 rounded-lg border border-rose-200 bg-rose-50 text-sm text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {clockError}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
