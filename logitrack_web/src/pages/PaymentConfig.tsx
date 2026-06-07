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

// ── Inputs style ──────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 36,
  padding: "0 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "monospace",
  outline: "none",
  minWidth: 0,
};

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
      <div style={{ padding: 32, color: "var(--text-secondary)", fontSize: 14 }}>
        Cargando configuración…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
          Métodos de pago
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
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
        <CardContent style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {draft &&
            TOGGLES.map((t, i) => (
              <div
                key={t.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "16px 0",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                      {t.label}
                    </span>
                    {t.badge && <Badge label={t.badge} />}
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>
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
          <CardContent style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {(["alias", "cbu"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setQrType(opt)}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 8,
                    border: `1px solid ${qrType === opt ? "var(--info)" : "var(--border)"}`,
                    background: qrType === opt ? "var(--info-bg)" : "var(--bg-card)",
                    color: qrType === opt ? "var(--info)" : "var(--text-secondary)",
                    fontWeight: qrType === opt ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
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
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button
          onClick={() => draft && config && setDraft({ ...config })}
          disabled={!isDirty || saving}
          style={secondaryBtnStyle(!isDirty || saving)}
        >
          Descartar
        </button>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          style={primaryBtnStyle(!isDirty || saving)}
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>

      {/* ── Credentials ── */}
      <Card>
        <CardHeader>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <KeyRound size={16} style={{ color: "var(--text-secondary)" }} />
            <CardTitle>Credenciales de Mercado Pago</CardTitle>
          </div>
          <CardDescription>
            Para modificar una credencial debés ingresar primero su valor actual. Los valores se guardan cifrados (AES-256) en la base de datos.
          </CardDescription>
        </CardHeader>
        <CardContent style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {credError && <FeedbackBar type="error" message={credError} />}
          {credSuccess && <FeedbackBar type="success" message="Credenciales actualizadas correctamente." />}

          {config && CREDENTIAL_FIELDS.map((f) => {
            const configKey = (f.newKey === "newToken" ? "mp_access_token" : "mp_webhook_secret") as keyof PaymentConfigType;
            const isSet = Boolean(config[configKey]);
            return (
              <div key={f.newKey} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    {f.label}
                  </span>
                  {isSet && (
                    <span style={{ fontSize: 11, color: "var(--ok)", fontWeight: 600 }}>
                      ● Configurado
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
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

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleCredSave}
              disabled={!hasCredDirty || credSaving}
              style={primaryBtnStyle(!hasCredDirty || credSaving)}
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        background: isErr ? "var(--error-bg, #fef2f2)" : "var(--ok-bg)",
        border: `1px solid ${isErr ? "var(--error-border, #fecaca)" : "var(--ok-border)"}`,
        borderRadius: 10,
        fontSize: 13,
        color: isErr ? "var(--error, #dc2626)" : "var(--ok)",
      }}
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
      style={{
        flex: "0 0 auto",
        position: "relative",
        width: 44,
        height: 24,
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        background: checked ? "var(--ok)" : "var(--border)",
        transition: "background 150ms",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
          transition: "left 150ms",
        }}
      />
    </button>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 20,
        background: "var(--warn-bg)",
        color: "var(--warn-text)",
        border: "1px solid var(--warn-border)",
        letterSpacing: "0.03em",
        textTransform: "uppercase",
      }}
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
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ flex: "0 0 80px", fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
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
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: "0 0 100px", fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
        {label}
      </span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <input
          type={show ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          title={show ? "Ocultar" : "Mostrar"}
          style={{
            flex: "0 0 auto",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 7,
            padding: "6px 8px",
            cursor: "pointer",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
          }}
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 20px",
    borderRadius: 9,
    border: "none",
    background: disabled ? "var(--border)" : "var(--info)",
    color: disabled ? "var(--text-secondary)" : "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function secondaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    color: "var(--text-secondary)",
    fontWeight: 600,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
