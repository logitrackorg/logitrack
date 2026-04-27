import { useState, useEffect } from "react";
import { organizationApi, type OrganizationConfig } from "../api/organizationApi";
import { fmtDateTime } from "../utils/date";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "20px 24px",
  marginBottom: 20,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  display: "block",
  marginBottom: 6,
};

export function OrganizationConfig() {
  const [config, setConfig] = useState<OrganizationConfig | null>(null);
  const [form, setForm] = useState({ name: "", cuit: "", address: "", phone: "", email: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    organizationApi.get().then((cfg) => {
      setConfig(cfg);
      setForm({
        name: cfg.name ?? "",
        cuit: cfg.cuit ?? "",
        address: cfg.address ?? "",
        phone: cfg.phone ?? "",
        email: cfg.email ?? "",
      });
    }).catch(() => {
      setError("No se pudo cargar la configuración de la organización.");
    }).finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const updated = await organizationApi.update(form);
      setConfig(updated);
      setSuccess("Configuración guardada correctamente.");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Cargando...</div>;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 640 }}>
      <h1 style={{ fontSize: "1.3rem", marginBottom: 4 }}>Configuración de la organización</h1>
      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 24 }}>
        Esta información aparece en los comprobantes de alta de envíos generados por el sistema.
      </p>

      <form onSubmit={handleSave}>
        <div style={cardStyle}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Nombre de la organización *</label>
            <input
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Transportes García S.A."
              required
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>CUIT</label>
              <input
                style={inputStyle}
                value={form.cuit}
                onChange={(e) => setForm({ ...form, cuit: e.target.value })}
                placeholder="Ej: 30-12345678-9"
              />
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input
                style={inputStyle}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Ej: +54 11 1234-5678"
              />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Dirección</label>
            <input
              style={inputStyle}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Ej: Av. Corrientes 1234, Buenos Aires"
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Ej: contacto@empresa.com.ar"
            />
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !form.name.trim()}
          style={{
            background: saving || !form.name.trim() ? "#e5e7eb" : "#1e3a5f",
            color: saving || !form.name.trim() ? "#9ca3af" : "#fff",
            border: "none",
            borderRadius: 6,
            padding: "10px 24px",
            cursor: saving || !form.name.trim() ? "not-allowed" : "pointer",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </form>

      {config?.updated_at && config.updated_by && (
        <p style={{ marginTop: 16, fontSize: 12, color: "#9ca3af" }}>
          Última actualización: {fmtDateTime(config.updated_at)} por <strong>{config.updated_by}</strong>
        </p>
      )}
    </div>
  );
}
