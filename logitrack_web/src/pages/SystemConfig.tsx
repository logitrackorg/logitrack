import { useState, useEffect } from "react";
import { systemConfigApi, type SystemConfig } from "../api/systemConfig";

const cardStyle: React.CSSProperties = {
  background: "#f9fafb",
  borderRadius: 10,
  padding: 24,
  border: "1px solid #e5e7eb",
};

export function SystemConfig() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [draft, setDraft] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

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
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "No se pudo guardar la configuración.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    draft !== null && config !== null &&
    draft.max_delivery_attempts !== config.max_delivery_attempts;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 640 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, color: "#111827" }}>
        Configuración del sistema
      </h1>
      <p style={{ margin: "0 0 28px", fontSize: 14, color: "#6b7280" }}>
        Parámetros operativos globales del sistema logístico.
      </p>

      {loading && (
        <p style={{ color: "#6b7280", fontSize: 14 }}>Cargando...</p>
      )}

      {!loading && draft && (
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 6px", fontSize: 15, color: "#1e3a5f" }}>
            Intentos de entrega
          </h2>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
            Cantidad máxima de intentos fallidos de entrega antes de que el envío pase
            automáticamente a <strong>Listo para retiro en mostrador</strong>. Rango permitido: 1–10.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", minWidth: 200 }}>
              Máximo de intentos fallidos
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() =>
                  setDraft((d) =>
                    d ? { ...d, max_delivery_attempts: Math.max(1, d.max_delivery_attempts - 1) } : d
                  )
                }
                disabled={draft.max_delivery_attempts <= 1}
                style={{
                  width: 32, height: 32, borderRadius: 6, border: "1px solid #d1d5db",
                  background: draft.max_delivery_attempts <= 1 ? "#f3f4f6" : "#fff",
                  cursor: draft.max_delivery_attempts <= 1 ? "not-allowed" : "pointer",
                  fontSize: 18, fontWeight: 700, color: "#374151",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                −
              </button>
              <span style={{
                minWidth: 36, textAlign: "center",
                fontSize: 22, fontWeight: 800, color: "#1e3a5f",
              }}>
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
                style={{
                  width: 32, height: 32, borderRadius: 6, border: "1px solid #d1d5db",
                  background: draft.max_delivery_attempts >= 10 ? "#f3f4f6" : "#fff",
                  cursor: draft.max_delivery_attempts >= 10 ? "not-allowed" : "pointer",
                  fontSize: 18, fontWeight: 700, color: "#374151",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                +
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
                style={{ width: 140, accentColor: "#1e3a5f" }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626",
              padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d",
              padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 12,
            }}>
              Configuración guardada correctamente.
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              style={{
                background: isDirty && !saving ? "#1e3a5f" : "#e5e7eb",
                color: isDirty && !saving ? "#fff" : "#9ca3af",
                border: "none", borderRadius: 6, padding: "8px 20px",
                cursor: isDirty && !saving ? "pointer" : "not-allowed",
                fontWeight: 700, fontSize: 14,
              }}
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>
            {isDirty && (
              <button
                onClick={() => setDraft(config)}
                disabled={saving}
                style={{
                  background: "#fff", color: "#374151", border: "1px solid #d1d5db",
                  borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 14,
                }}
              >
                Descartar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
