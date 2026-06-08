import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react";
import { paymentApi, type PaymentConfig as PaymentConfigType } from "../api/payments";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

// ── Toggle section ────────────────────────────────────────────────────────────

interface ToggleDef {
  key: keyof Pick<PaymentConfigType, "mp_enabled" | "mock_enabled">;
  label: string;
  description: string;
  badge?: string;
}

const TOGGLES: ToggleDef[] = [
  {
    key: "mp_enabled",
    label: "Mercado Pago",
    description: "Permite cobrar mediante link de pago o código QR de Mercado Pago.",
  },
  {
    key: "mock_enabled",
    label: "Transferencia bancaria",
    description:
      "Permite registrar pagos por transferencia bancaria (CBU/CVU). La confirmación es manual por el operador.",
    badge: "Próximamente",
  },
];

// ── Credentials section ───────────────────────────────────────────────────────

interface CredentialField {
  currentKey: "currentToken" | "currentSecret";
  newKey: "newToken" | "newSecret";
  label: string;
  hint: string;
}

const CREDENTIAL_FIELDS: CredentialField[] = [
  {
    currentKey: "currentToken",
    newKey: "newToken",
    label: "Access Token",
    hint: "El token de acceso de tu cuenta de Mercado Pago (APP_USR-… o TEST-…).",
  },
];

interface CredentialDraft {
  currentToken: string;
  newToken: string;
  currentSecret: string;
  newSecret: string;
}

const emptyCredentials = (): CredentialDraft => ({
  currentToken: "",
  newToken: "",
  currentSecret: "",
  newSecret: "",
});

// ── Component ─────────────────────────────────────────────────────────────────

export function PaymentConfig() {
  const [config, setConfig] = useState<PaymentConfigType | null>(null);
  const [draft, setDraft] = useState<PaymentConfigType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // QR destination type selector
  const [qrType, setQrType] = useState<"alias" | "cbu">("alias");

  // Credentials section state
  const [credDraft, setCredDraft] = useState<CredentialDraft>(emptyCredentials());
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState("");
  const [credSuccess, setCredSuccess] = useState(false);
  const [showFields, setShowFields] = useState<Record<string, boolean>>({});

  useEffect(() => {
    paymentApi
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setDraft(cfg);
        setQrType(cfg.mp_cvu !== "" ? "cbu" : "alias");
      })
      .catch(() => setError("No se pudo cargar la configuración de métodos de pago."))
      .finally(() => setLoading(false));
  }, []);

  // ── Toggle & text handlers ────────────────────────────────────────────────

  const handleToggle = (key: keyof Pick<PaymentConfigType, "mp_enabled" | "mock_enabled">) => {
    if (!draft) return;
    if (key === "mock_enabled" && !draft.mock_enabled) {
      const activeDestValue = qrType === "alias" ? draft.mp_alias : draft.mp_cvu;
      if (!activeDestValue.trim()) {
        setError("Ingresá un alias o CBU/CVU antes de activar la transferencia bancaria.");
        return;
      }
    }
    setError("");
    setDraft({ ...draft, [key]: !draft[key] });
  };

  const handleText = (key: keyof PaymentConfigType, value: string) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  };

  const isDirty = draft && config && JSON.stringify(draft) !== JSON.stringify(config);

  const handleSave = async () => {
    if (!draft) return;
    const activeDestValue = qrType === "alias" ? draft.mp_alias : draft.mp_cvu;
    if (draft.mock_enabled && !activeDestValue.trim()) {
      setError("Para activar la transferencia bancaria debés ingresar un alias o CBU/CVU destino.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      // Only persist the active QR destination type; clear the other.
      const payload = {
        ...draft,
        mp_alias: qrType === "alias" ? draft.mp_alias : "",
        mp_cvu:   qrType === "cbu"   ? draft.mp_cvu   : "",
      };
      const updated = await paymentApi.updateConfig(payload);
      setConfig(updated);
      setDraft(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  // ── Credentials handlers ──────────────────────────────────────────────────

  const hasCredDirty = credDraft.newToken !== "" || credDraft.newSecret !== "";

  const handleCredSave = async () => {
    if (!hasCredDirty) return;
    setCredSaving(true);
    setCredError("");
    setCredSuccess(false);
    try {
      const updated = await paymentApi.updateCredentials({
        current_access_token: credDraft.currentToken || undefined,
        new_access_token: credDraft.newToken || undefined,
        current_webhook_secret: credDraft.currentSecret || undefined,
        new_webhook_secret: credDraft.newSecret || undefined,
      });
      setConfig(updated);
      setDraft(updated);
      setCredDraft(emptyCredentials());
      setCredSuccess(true);
      setTimeout(() => setCredSuccess(false), 3000);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCredError(msg ?? "No se pudieron actualizar las credenciales.");
    } finally {
      setCredSaving(false);
    }
  };

  const toggleShow = (field: string) =>
    setShowFields((prev) => ({ ...prev, [field]: !prev[field] }));

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 text-[var(--text-secondary)] text-sm">
        Cargando configuración…
      </div>
    );
  }

  return (
    <div className="max-w-[640px] mx-auto px-4 py-8 flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-[22px] font-bold text-[var(--text-primary)] tracking-[-0.02em]">
          Métodos de pago
        </h1>
        <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] leading-[1.5]">
          Habilitá métodos de cobro y configurá las credenciales de Mercado Pago.
        </p>
      </div>

      {/* ── Global feedback ── */}
      {error && <FeedbackBar type="error" message={error} />}
      {success && <FeedbackBar type="success" message="Cambios guardados correctamente." />}

      {/* ── Toggle cards ── */}
      <Card>
        <CardHeader>
          <CardTitle>Métodos disponibles</CardTitle>
          <CardDescription>
            Los métodos deshabilitados no aparecen en el panel de cobro para operadores.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-0 p-0">
          {draft &&
            TOGGLES.map((t, i) => (
              <div
                key={t.key}
                className={`flex items-center justify-between gap-4 py-4 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {t.label}
                    </span>
                    {t.badge && <Badge label={t.badge} />}
                  </div>
                  <p className="mt-[3px] text-xs text-[var(--text-secondary)] leading-[1.45]">
                    {t.description}
                  </p>
                </div>
                <Toggle checked={draft[t.key]} onChange={() => handleToggle(t.key)} />
              </div>
            ))}
        </CardContent>
      </Card>

      {/* ── Alias / CVU ── */}
      {draft && (
        <Card>
          <CardHeader>
            <CardTitle>Cuenta destino para QR</CardTitle>
            <CardDescription>
              El dato que se codifica en el QR de cobro. El cliente escanea y transfiere el monto exacto del envío.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5">
            <div className="flex gap-2">
              {(["alias", "cbu"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setQrType(opt)}
                  className={`py-1.5 px-4 rounded-lg border text-[13px] font-medium cursor-pointer transition-colors ${
                    qrType === opt
                      ? "border-[var(--info)] bg-[var(--info-bg)] text-[var(--info)] font-bold"
                      : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]"
                  }`}
                >
                  {opt === "alias" ? "Alias" : "CBU/CVU"}
                </button>
              ))}
            </div>
            {qrType === "alias" ? (
              <TextRow
                label="Alias"
                value={draft.mp_alias}
                placeholder="ej: logitrack.pagos"
                onChange={(v) => handleText("mp_alias", v)}
              />
            ) : (
              <TextRow
                label="CBU/CVU"
                value={draft.mp_cvu}
                placeholder="22 dígitos"
                onChange={(v) => handleText("mp_cvu", v)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Save flags + alias ── */}
      <div className="flex gap-2.5 justify-end">
        <button
          onClick={() => draft && config && setDraft({ ...config })}
          disabled={!isDirty || saving}
          className="py-[9px] px-[18px] rounded-[9px] border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] font-semibold text-[13px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-slate-50 transition-colors"
        >
          Descartar
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="py-[9px] px-5 rounded-[9px] bg-[var(--info)] hover:brightness-110 text-white font-bold text-[13px] cursor-pointer disabled:cursor-not-allowed disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)] transition-all"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>

      {/* ── Credentials ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-[var(--text-secondary)]" />
            <CardTitle>Credenciales de Mercado Pago</CardTitle>
          </div>
          <CardDescription>
            Para modificar una credencial debés ingresar primero su valor actual. Los valores se guardan cifrados (AES-256) en la base de datos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {credError && <FeedbackBar type="error" message={credError} />}
          {credSuccess && <FeedbackBar type="success" message="Credenciales actualizadas correctamente." />}

          {config && CREDENTIAL_FIELDS.map((f) => {
            const configKey = (f.newKey === "newToken" ? "mp_access_token" : "mp_webhook_secret") as keyof PaymentConfigType;
            const isSet = Boolean(config[configKey]);
            return (
              <div key={f.newKey} className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {f.label}
                  </span>
                  {isSet && (
                    <span className="text-[11px] text-[var(--ok)] font-semibold">
                      ● Configurado
                    </span>
                  )}
                </div>
                <p className="m-0 text-xs text-[var(--text-secondary)] leading-[1.4]">
                  {f.hint}
                </p>
                {isSet && (
                  <PasswordRow
                    label="Valor actual"
                    field={f.currentKey}
                    value={credDraft[f.currentKey]}
                    show={!!showFields[f.currentKey]}
                    placeholder="Ingresá el valor actual para confirmar"
                    onChange={(v) => setCredDraft((d) => ({ ...d, [f.currentKey]: v }))}
                    onToggleShow={() => toggleShow(f.currentKey)}
                  />
                )}
                <PasswordRow
                  label={isSet ? "Nuevo valor" : "Valor"}
                  field={f.newKey}
                  value={credDraft[f.newKey]}
                  show={!!showFields[f.newKey]}
                  placeholder={isSet ? "Ingresá el nuevo valor" : "Ingresá el valor"}
                  onChange={(v) => setCredDraft((d) => ({ ...d, [f.newKey]: v }))}
                  onToggleShow={() => toggleShow(f.newKey)}
                />
              </div>
            );
          })}

          <div className="flex justify-end">
            <button
              onClick={handleCredSave}
              disabled={!hasCredDirty || credSaving}
              className="py-[9px] px-5 rounded-[9px] bg-[var(--info)] hover:brightness-110 text-white font-bold text-[13px] cursor-pointer disabled:cursor-not-allowed disabled:bg-[var(--border)] disabled:text-[var(--text-secondary)] transition-all"
            >
              {credSaving ? "Guardando…" : "Actualizar credenciales"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FeedbackBar({ type, message }: { type: "error" | "success"; message: string }) {
  const isErr = type === "error";
  return (
    <div
      className={`flex items-center gap-2 py-2.5 px-3.5 rounded-[10px] text-[13px] ${
        isErr
          ? "bg-[var(--error-bg,#fef2f2)] border border-[var(--error-border,#fecaca)] text-[var(--error,#dc2626)]"
          : "bg-[var(--ok-bg)] border border-[var(--ok-border)] text-[var(--ok)]"
      }`}
    >
      {isErr ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
      {message}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative w-11 h-6 rounded-xl border-none cursor-pointer transition-colors duration-150 p-0 shrink-0 ${
        checked ? "bg-[var(--ok)]" : "bg-[var(--border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.18)] transition-transform duration-150 ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span
      className="text-[10px] font-bold py-0.5 px-[7px] rounded-[20px] bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)] tracking-[0.03em] uppercase"
    >
      {label}
    </span>
  );
}

function TextRow({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[13px] text-[var(--text-secondary)] font-medium">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-9 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-[13px] font-mono outline-none min-w-0 focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
      />
    </div>
  );
}

function PasswordRow({
  label,
  value,
  show,
  placeholder,
  onChange,
  onToggleShow,
}: {
  label: string;
  field: string;
  value: string;
  show: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  onToggleShow: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[100px] shrink-0 text-xs text-[var(--text-secondary)] font-medium">
        {label}
      </span>
      <div className="flex-1 flex items-center gap-1.5 min-w-0">
        <input
          type={show ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className="flex-1 h-9 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-[13px] font-mono outline-none min-w-0 focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
        />
        <button
          type="button"
          onClick={onToggleShow}
          title={show ? "Ocultar" : "Mostrar"}
          className="shrink-0 bg-transparent border border-[var(--border)] rounded-md p-1.5 cursor-pointer text-[var(--text-secondary)] flex items-center hover:bg-slate-50 transition-colors"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}
