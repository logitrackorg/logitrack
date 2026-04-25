import { useState, useEffect } from "react";
import { mlConfigApi, type MLConfig, type MLFactors } from "../api/mlConfig";

const FACTOR_LABELS: Record<keyof MLFactors, { label: string; description: string }> = {
  shipment_type:    { label: "Tipo de envío",        description: "Express vs. estándar — los envíos express reciben mayor prioridad" },
  distance_km:      { label: "Distancia",             description: "Las rutas más largas tienen mayor riesgo de demora" },
  restrictions:     { label: "Restricciones",         description: "Los envíos frágiles o con cadena de frío requieren manejo especial" },
  time_window:      { label: "Ventana horaria",       description: "Los plazos de mañana son más ajustados que las ventanas flexibles" },
  volume_score:     { label: "Volumen / Peso",        description: "Los paquetes más grandes agregan complejidad logística" },
  route_saturation: { label: "Saturación de ruta",   description: "Las rutas con mayor demanda enfrentan más riesgo de congestión" },
};

const FACTOR_ORDER: (keyof MLFactors)[] = [
  "shipment_type",
  "distance_km",
  "restrictions",
  "time_window",
  "volume_score",
  "route_saturation",
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function MLConfig() {
  const [activeConfig, setActiveConfig] = useState<MLConfig | null>(null);
  const [history, setHistory] = useState<MLConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [factors, setFactors] = useState<MLFactors>({
    shipment_type: 3.0,
    distance_km: 2.5,
    restrictions: 2.0,
    time_window: 1.5,
    volume_score: 1.0,
    route_saturation: 0.8,
  });
  const [altaThreshold, setAltaThreshold] = useState(0.65);
  const [mediaThreshold, setMediaThreshold] = useState(0.35);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [cfg, hist] = await Promise.all([
        mlConfigApi.getActive(),
        mlConfigApi.getHistory(),
      ]);
      setActiveConfig(cfg);
      setHistory(hist);
      setFactors({ ...cfg.factors });
      setAltaThreshold(cfg.alta_threshold);
      setMediaThreshold(cfg.media_threshold);
    } catch {
      setError("No se pudo cargar la configuración de ML.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate() {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const result = await mlConfigApi.regenerate({
        factors,
        alta_threshold: altaThreshold,
        media_threshold: mediaThreshold,
        notes: notes.trim(),
      });
      setSuccess(
        `Modelo regenerado correctamente. Se recalcularon ${result.recalculated_count} envío(s) activo(s).`
      );
      setNotes("");
      await loadData();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo regenerar el modelo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: number) {
    setError(null);
    setSuccess(null);
    setActivating(id);
    try {
      const result = await mlConfigApi.activate(id);
      setSuccess(
        `Configuración #${id} activada. Se recalcularon ${result.recalculated_count} envío(s) activo(s).`
      );
      await loadData();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? "No se pudo activar la configuración.");
    } finally {
      setActivating(null);
    }
  }

  const containerStyle: React.CSSProperties = {
    maxWidth: 900,
    margin: "0 auto",
    padding: "32px 24px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#1f2937",
  };

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: 24,
    marginBottom: 24,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontWeight: 600,
    fontSize: 13,
    color: "#374151",
    marginBottom: 2,
  };

  const descStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 8,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box",
  };

  const btnPrimaryStyle: React.CSSProperties = {
    background: saving ? "#9ca3af" : "#1e3a5f",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "10px 24px",
    fontWeight: 600,
    fontSize: 14,
    cursor: saving ? "not-allowed" : "pointer",
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <p style={{ color: "#6b7280" }}>Cargando configuración…</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Configuración de prioridad ML</h1>
      <p style={{ color: "#6b7280", marginBottom: 24, fontSize: 14 }}>
        Ajustá los pesos de cada factor para calcular el puntaje de prioridad de los envíos. Al guardar,
        el modelo se reentrenará y se recalcularán todos los envíos activos.
      </p>

      {activeConfig && activeConfig.id > 0 && (
        <div style={{ marginBottom: 16, fontSize: 13, color: "#374151" }}>
          Configuración activa: <strong>#{activeConfig.id}</strong> — creada por{" "}
          <strong>{activeConfig.created_by}</strong> el{" "}
          {formatDate(activeConfig.created_at)}
          {activeConfig.notes && ` — "${activeConfig.notes}"`}
        </div>
      )}

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "10px 14px", marginBottom: 16, color: "#b91c1c", fontSize: 14 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "10px 14px", marginBottom: 16, color: "#166534", fontSize: 14 }}>
          {success}
        </div>
      )}

      {/* Factor weights */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Pesos de los factores (1,0 – 5,0)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 24px" }}>
          {FACTOR_ORDER.map((key) => (
            <div key={key}>
              <label style={labelStyle}>{FACTOR_LABELS[key].label}</label>
              <p style={descStyle}>{FACTOR_LABELS[key].description}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={1.0}
                  max={5.0}
                  step={0.1}
                  value={factors[key]}
                  onChange={(e) => setFactors({ ...factors, [key]: parseFloat(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min={1.0}
                  max={5.0}
                  step={0.1}
                  value={factors[key]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (v >= 1 && v <= 5) setFactors({ ...factors, [key]: v });
                  }}
                  style={{ ...inputStyle, width: 70 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Thresholds */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Umbrales de clasificación (0,0 – 1,0)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 24px" }}>
          <div>
            <label style={labelStyle}>Umbral de prioridad alta (alta)</label>
            <p style={descStyle}>Los puntajes por encima de este valor se clasifican como prioridad alta.</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={0.0}
                max={1.0}
                step={0.05}
                value={altaThreshold}
                onChange={(e) => setAltaThreshold(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min={0.0}
                max={1.0}
                step={0.05}
                value={altaThreshold}
                onChange={(e) => setAltaThreshold(parseFloat(e.target.value))}
                style={{ ...inputStyle, width: 70 }}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Umbral de prioridad media (media)</label>
            <p style={descStyle}>Los puntajes por encima de este valor (y por debajo del alto) son prioridad media.</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={0.0}
                max={1.0}
                step={0.05}
                value={mediaThreshold}
                onChange={(e) => setMediaThreshold(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min={0.0}
                max={1.0}
                step={0.05}
                value={mediaThreshold}
                onChange={(e) => setMediaThreshold(parseFloat(e.target.value))}
                style={{ ...inputStyle, width: 70 }}
              />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, padding: "8px 12px", background: "#f9fafb", borderRadius: 6, fontSize: 13, color: "#374151" }}>
          Puntaje &gt; <strong>{altaThreshold.toFixed(2)}</strong> → <span style={{ color: "#dc2626", fontWeight: 600 }}>Alta</span>
          {"  |  "}Puntaje &gt; <strong>{mediaThreshold.toFixed(2)}</strong> → <span style={{ color: "#d97706", fontWeight: 600 }}>Media</span>
          {"  |  "}De lo contrario → <span style={{ color: "#6b7280", fontWeight: 600 }}>Baja</span>
        </div>
      </div>

      {/* Notes + submit */}
      <div style={cardStyle}>
        <label style={labelStyle}>Notas (opcional)</label>
        <p style={descStyle}>Describí por qué cambiás la configuración — se guarda junto al historial.</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="ej. Se aumentó el peso de tipo de envío para priorizar los envíos express"
          rows={3}
          style={{ ...inputStyle, resize: "vertical", marginBottom: 16 }}
        />
        <button
          onClick={handleRegenerate}
          disabled={saving}
          style={btnPrimaryStyle}
        >
          {saving ? "Regenerando modelo..." : "Regenerar modelo"}
        </button>
        {saving && (
          <p style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>
            Entrenando el modelo RandomForest — esto puede tardar unos segundos.
          </p>
        )}
      </div>

      {/* History */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Historial de configuraciones</h2>
        {(history ?? []).length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>Todavía no hay historial de configuraciones.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Fecha</th>
                <th style={thStyle}>Creada por</th>
                <th style={thStyle}>Notas</th>
                <th style={thStyle}>Factores</th>
                <th style={thStyle}>Estado</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((cfg) => (
                <tr key={cfg.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={tdStyle}>#{cfg.id}</td>
                  <td style={tdStyle}>{formatDate(cfg.created_at)}</td>
                  <td style={tdStyle}>{cfg.created_by}</td>
                  <td style={{ ...tdStyle, maxWidth: 160, color: "#6b7280" }}>
                    {cfg.notes || "—"}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {FACTOR_ORDER.map((k) => (
                        <span key={k} style={{ background: "#f3f4f6", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
                          {FACTOR_LABELS[k].label.split(" ")[0]}: <strong>{cfg.factors[k]?.toFixed(1)}</strong>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    {cfg.is_active ? (
                      <span style={{ background: "#dcfce7", color: "#166534", borderRadius: 4, padding: "2px 8px", fontWeight: 600, fontSize: 11 }}>
                        Activa
                      </span>
                    ) : (
                      <span style={{ background: "#f3f4f6", color: "#6b7280", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                        Inactiva
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {!cfg.is_active && (
                      <button
                        onClick={() => handleActivate(cfg.id)}
                        disabled={activating === cfg.id}
                        style={{
                          background: "transparent",
                          border: "1px solid #d1d5db",
                          borderRadius: 4,
                          padding: "3px 10px",
                          fontSize: 12,
                          cursor: activating === cfg.id ? "not-allowed" : "pointer",
                          color: "#374151",
                        }}
                      >
                        {activating === cfg.id ? "Activando..." : "Activar"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 600,
  color: "#374151",
  fontSize: 12,
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 10px",
  verticalAlign: "top",
};
