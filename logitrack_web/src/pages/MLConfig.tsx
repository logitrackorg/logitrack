import { useState, useEffect } from "react";
import { mlConfigApi, type MLConfig, type MLFactors } from "../api/mlConfig";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

const FACTOR_LABELS: Record<keyof MLFactors, { label: string; description: string }> = {
  shipment_type:    { label: "Tipo de envío",        description: "Express vs. estándar — los envíos express reciben mayor prioridad" },
  distance_km:      { label: "Distancia",             description: "Las rutas más largas tienen mayor riesgo de demora" },
  restrictions:     { label: "Restricciones",         description: "Los envíos frágiles requieren manejo especial" },
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

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-8 text-[var(--text-primary)]">
        <p className="text-[var(--text-secondary)]">Cargando configuración…</p>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8 text-[var(--text-primary)]">
      {activeConfig && activeConfig.id > 0 && (
        <div className="mb-4 text-[13px] text-[var(--text-strong)]">
          Configuración activa: <strong>#{activeConfig.id}</strong> — creada por{" "}
          <strong>{activeConfig.created_by}</strong> el{" "}
          {formatDate(activeConfig.created_at)}
          {activeConfig.notes && ` — "${activeConfig.notes}"`}
        </div>
      )}

      {error && (
        <div className="mb-4 px-3.5 py-2.5 rounded-md border text-sm bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger-text)]">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 px-3.5 py-2.5 rounded-md border text-sm bg-[var(--ok-bg)] border-[var(--ok-border)] text-[var(--ok-text)]">
          {success}
        </div>
      )}

      {/* Factor weights */}
      <Card className="mb-6 cursor-default">
        <CardHeader className="pb-2">
          <CardTitle>Pesos de los factores (1,0 – 5,0)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {FACTOR_ORDER.map((key) => (
              <div key={key}>
                <label className="block font-semibold text-[13px] text-[var(--text-strong)] mb-0.5">
                  {FACTOR_LABELS[key].label}
                </label>
                <p className="text-xs text-[var(--text-secondary)] mb-2">
                  {FACTOR_LABELS[key].description}
                </p>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={1.0}
                    max={5.0}
                    step={0.1}
                    value={factors[key]}
                    onChange={(e) => setFactors({ ...factors, [key]: parseFloat(e.target.value) })}
                    className="flex-1"
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
                    className="w-[70px] px-2.5 py-1.5 border border-[var(--border-strong)] rounded-md text-sm box-border bg-[var(--bg-card)] text-[var(--text-primary)]"
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Thresholds */}
      <Card className="mb-6 cursor-default">
        <CardHeader className="pb-2">
          <CardTitle>Umbrales de clasificación (0,0 – 1,0)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <label className="block font-semibold text-[13px] text-[var(--text-strong)] mb-0.5">
                Umbral de prioridad alta (alta)
              </label>
              <p className="text-xs text-[var(--text-secondary)] mb-2">
                Los puntajes por encima de este valor se clasifican como prioridad alta.
              </p>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={altaThreshold}
                  onChange={(e) => setAltaThreshold(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={altaThreshold}
                  onChange={(e) => setAltaThreshold(parseFloat(e.target.value))}
                  className="w-[70px] px-2.5 py-1.5 border border-[var(--border-strong)] rounded-md text-sm box-border bg-[var(--bg-card)] text-[var(--text-primary)]"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-[13px] text-[var(--text-strong)] mb-0.5">
                Umbral de prioridad media (media)
              </label>
              <p className="text-xs text-[var(--text-secondary)] mb-2">
                Los puntajes por encima de este valor (y por debajo del alto) son prioridad media.
              </p>
              <div className="flex items-center gap-2.5">
                <input
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={mediaThreshold}
                  onChange={(e) => setMediaThreshold(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={mediaThreshold}
                  onChange={(e) => setMediaThreshold(parseFloat(e.target.value))}
                  className="w-[70px] px-2.5 py-1.5 border border-[var(--border-strong)] rounded-md text-sm box-border bg-[var(--bg-card)] text-[var(--text-primary)]"
                />
              </div>
            </div>
          </div>
          <div className="mt-3 px-3 py-2 rounded-md text-[13px] text-[var(--text-strong)] bg-[var(--bg-subtle)]">
            Puntaje &gt; <strong>{altaThreshold.toFixed(2)}</strong> →{" "}
            <span className="text-[var(--danger-text)] font-semibold">Alta</span>
            {"  |  "}Puntaje &gt; <strong>{mediaThreshold.toFixed(2)}</strong> →{" "}
            <span className="text-[var(--warn-text)] font-semibold">Media</span>
            {"  |  "}De lo contrario →{" "}
            <span className="text-[var(--text-secondary)] font-semibold">Baja</span>
          </div>
        </CardContent>
      </Card>

      {/* Notes + submit */}
      <Card className="mb-6 cursor-default">
        <CardHeader className="pb-2">
          <CardTitle>Notas (opcional)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-[var(--text-secondary)] mb-2">
            Describí por qué cambiás la configuración — se guarda junto al historial.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ej. Se aumentó el peso de tipo de envío para priorizar los envíos express"
            rows={3}
            className="w-full px-2.5 py-1.5 border border-[var(--border-strong)] rounded-md text-sm box-border resize-y mb-4 bg-[var(--bg-card)] text-[var(--text-primary)]"
          />
          <button
            onClick={handleRegenerate}
            disabled={saving}
            className={`rounded-md px-6 py-2.5 font-semibold text-sm text-white cursor-pointer transition-colors disabled:cursor-not-allowed ${saving ? "bg-[var(--text-muted)]" : "bg-[var(--sidebar-bg)]"}`}
          >
            {saving ? "Regenerando modelo..." : "Regenerar modelo"}
          </button>
          {saving && (
            <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
              Entrenando el modelo RandomForest — esto puede tardar unos segundos.
            </p>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card className="cursor-default">
        <CardHeader className="pb-2">
          <CardTitle>Historial de configuraciones</CardTitle>
        </CardHeader>
        <CardContent>
          {(history ?? []).length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">Todavía no hay historial de configuraciones.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[var(--bg-subtle)]">
                    <th className="text-left px-2.5 py-2 font-semibold text-[12px] text-[var(--text-strong)] border-b border-[var(--border)]">ID</th>
                    <th className="text-left px-2.5 py-2 font-semibold text-[12px] text-[var(--text-strong)] border-b border-[var(--border)]">Fecha</th>
                    <th className="text-left px-2.5 py-2 font-semibold text-[12px] text-[var(--text-strong)] border-b border-[var(--border)]">Creada por</th>
                    <th className="text-left px-2.5 py-2 font-semibold text-[12px] text-[var(--text-strong)] border-b border-[var(--border)]">Notas</th>
                    <th className="text-left px-2.5 py-2 font-semibold text-[12px] text-[var(--text-strong)] border-b border-[var(--border)]">Factores</th>
                    <th className="text-left px-2.5 py-2 font-semibold text-[12px] text-[var(--text-strong)] border-b border-[var(--border)]">Estado</th>
                    <th className="text-left px-2.5 py-2 font-semibold text-[12px] text-[var(--text-strong)] border-b border-[var(--border)]"></th>
                  </tr>
                </thead>
                <tbody>
                  {(history ?? []).map((cfg) => (
                    <tr key={cfg.id} className="border-b border-[var(--border)]">
                      <td className="px-2.5 py-2.5 align-top">#{cfg.id}</td>
                      <td className="px-2.5 py-2.5 align-top">{formatDate(cfg.created_at)}</td>
                      <td className="px-2.5 py-2.5 align-top">{cfg.created_by}</td>
                      <td className="px-2.5 py-2.5 align-top max-w-[160px] text-[var(--text-secondary)]">
                        {cfg.notes || "—"}
                      </td>
                      <td className="px-2.5 py-2.5 align-top">
                        <div className="flex flex-wrap gap-1">
                          {FACTOR_ORDER.map((k) => (
                            <span key={k} className="inline-block rounded px-1.5 py-px text-[11px] bg-[var(--bg-muted)]">
                              {FACTOR_LABELS[k].label.split(" ")[0]}: <strong>{cfg.factors[k]?.toFixed(1)}</strong>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2.5 py-2.5 align-top">
                        {cfg.is_active ? (
                          <span className="inline-block rounded px-2 py-0.5 font-semibold text-[11px] bg-[var(--ok-bg)] text-[var(--ok-text)]">
                            Activa
                          </span>
                        ) : (
                          <span className="inline-block rounded px-2 py-0.5 text-[11px] bg-[var(--bg-muted)] text-[var(--text-secondary)]">
                            Inactiva
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-2.5 align-top">
                        {!cfg.is_active && (
                          <button
                            onClick={() => handleActivate(cfg.id)}
                            disabled={activating === cfg.id}
                            className="rounded px-2.5 py-0.5 text-xs border border-[var(--border-strong)] text-[var(--text-strong)] bg-transparent cursor-pointer disabled:cursor-not-allowed"
                          >
                            {activating === cfg.id ? "Activando..." : "Activar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
