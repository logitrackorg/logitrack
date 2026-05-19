import { useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, MapPin, Plus, Trash2, Edit3, Power, X, Check, Undo2, Pencil,
} from "lucide-react";
import { zoneApi, ZONE_COLOR, type Zone } from "../api/zones";
import { PageHeader } from "../components/ui/page-header";
import { Card } from "../components/ui/card";

delete (L.Icon.Default.prototype as typeof L.Icon.Default.prototype & { _getIconUrl?: unknown })._getIconUrl;

type DrawingMode = "none" | "new" | "edit";

export function ZoneManagement() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(true);

  // Drawing
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("none");
  const drawingModeRef = useRef<DrawingMode>("none");
  const [draftVertices, setDraftVertices] = useState<[number, number][]>([]);
  const draftVerticesRef = useRef<[number, number][]>([]);

  // Form modal (create + edit)
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Selection
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  // Confirm-delete modal
  const [confirmDelete, setConfirmDelete] = useState<Zone | null>(null);
  const [deleting, setDeleting] = useState(false);

  const selectZoneRef = useRef<(id: string) => void>(() => {});
  const redrawDraftRef = useRef<(verts: [number, number][]) => void>(() => {});
  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);

  const load = () =>
    zoneApi.list(true).then((zs) => { setZones(zs); setLoading(false); }).catch(() => setLoading(false));

  useEffect(() => { load(); }, []);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, { center: [-34.6037, -58.3816], zoom: 12 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);
    mapInstance.current = map;
    zonesLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = L.layerGroup().addTo(map);
    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, []);

  // Render zones
  useEffect(() => {
    const layer = zonesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    zones.forEach((z) => {
      const isBeingRedrawn = drawingMode === "edit" && editingZone?.id === z.id;
      if (isBeingRedrawn) {
        // Polígono viejo desvanecido como referencia
        const latLngs = z.polygon.map((p) => [p.lat, p.lng] as [number, number]);
        L.polygon(latLngs, {
          color: ZONE_COLOR.stroke, fillColor: ZONE_COLOR.stroke,
          fillOpacity: 0.05, opacity: 0.3, weight: 1, dashArray: "4, 4",
        }).addTo(layer!);
        return;
      }

      const latLngs = z.polygon.map((p) => [p.lat, p.lng] as [number, number]);
      const poly = L.polygon(latLngs, {
        color: ZONE_COLOR.stroke,
        fillColor: ZONE_COLOR.stroke,
        fillOpacity: z.active ? 0.2 : 0.05,
        opacity: z.active ? 0.8 : 0.3,
        weight: z.id === selectedZoneId ? 3 : 1.5,
        dashArray: z.active ? undefined : "6, 4",
      });
      poly.bindPopup(`
        <div style="font-family:system-ui;min-width:160px">
          <p style="font-weight:700;font-size:14px;margin:0 0 4px">⚠️ ${z.name}</p>
          ${z.description ? `<p style="font-size:12px;color:#64748b;margin:0">${z.description}</p>` : ""}
          ${!z.active ? '<span style="font-size:11px;color:#94a3b8;margin-top:4px;display:inline-block">Pausada</span>' : ""}
        </div>
      `);
      poly.on("click", (e: L.LeafletMouseEvent) => {
        if (drawingModeRef.current !== "none") return;
        L.DomEvent.stopPropagation(e);
        selectZoneRef.current(z.id);
      });
      poly.addTo(layer);
    });
  }, [zones, selectedZoneId, drawingMode, editingZone]);

  // Drawing mode: click-to-add-vertex handler
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    if (drawingMode === "none") {
      map.getContainer().style.cursor = "";
      return;
    }
    map.getContainer().style.cursor = "crosshair";

    const handleClick = (e: L.LeafletMouseEvent) => {
      const pt: [number, number] = [e.latlng.lat, e.latlng.lng];
      const newVerts = [...draftVerticesRef.current, pt];
      draftVerticesRef.current = newVerts;
      setDraftVertices([...newVerts]);
      redrawDraftRef.current(newVerts);
    };
    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [drawingMode]);

  // Keyboard shortcuts: Esc, Enter, Cmd/Ctrl+Z
  useEffect(() => {
    if (drawingMode === "none") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelDrawing();
      } else if (e.key === "Enter" && draftVerticesRef.current.length >= 3) {
        e.preventDefault();
        closePolygon();
      } else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undoLastVertex();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingMode]);

  const redrawDraft = (verts: [number, number][]) => {
    const layer = drawLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (verts.length === 0) return;

    verts.forEach((v, i) => {
      const isFirst = i === 0;
      const canCloseHere = isFirst && verts.length >= 3;
      const marker = L.circleMarker(v, {
        radius: canCloseHere ? 8 : 5,
        color: canCloseHere ? "#10b981" : "#1e3a5f",
        fillColor: canCloseHere ? "#10b981" : "#1e3a5f",
        fillOpacity: 1,
        weight: 2,
      });
      if (canCloseHere) {
        marker.bindTooltip("Click para cerrar el polígono", { direction: "top", offset: [0, -8] });
        marker.on("click", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          closePolygon();
        });
      }
      marker.addTo(layer!);
    });
    if (verts.length >= 2) {
      L.polyline(verts, { color: "#1e3a5f", weight: 2, dashArray: "6, 4" }).addTo(layer!);
    }
    if (verts.length >= 3) {
      L.polygon(verts, { color: "#1e3a5f", fillColor: "#1e3a5f", fillOpacity: 0.1, weight: 1.5, dashArray: "6, 4" }).addTo(layer!);
    }
  };
  useLayoutEffect(() => { redrawDraftRef.current = redrawDraft; });

  const startDrawingNew = () => {
    setEditingZone(null);
    setPendingPolygon(null);
    draftVerticesRef.current = [];
    setDraftVertices([]);
    drawLayerRef.current?.clearLayers();
    setDrawingMode("new");
  };

  const startDrawingEdit = (zone: Zone) => {
    setEditingZone(zone);
    draftVerticesRef.current = [];
    setDraftVertices([]);
    drawLayerRef.current?.clearLayers();
    setShowFormModal(false);
    setDrawingMode("edit");
  };

  const cancelDrawing = () => {
    setDrawingMode("none");
    draftVerticesRef.current = [];
    setDraftVertices([]);
    drawLayerRef.current?.clearLayers();
    if (editingZone) {
      setShowFormModal(true);
    }
  };

  const undoLastVertex = () => {
    const verts = draftVerticesRef.current.slice(0, -1);
    draftVerticesRef.current = verts;
    setDraftVertices([...verts]);
    redrawDraft(verts);
  };

  const closePolygon = () => {
    const verts = draftVerticesRef.current;
    if (verts.length < 3) return;
    setDrawingMode("none");
    setPendingPolygon(verts);
    if (!editingZone) {
      setFormName(""); setFormDesc(""); setFormError("");
    }
    setShowFormModal(true);
    draftVerticesRef.current = [];
    setDraftVertices([]);
    drawLayerRef.current?.clearLayers();
  };

  const openEditModal = (zone: Zone) => {
    setEditingZone(zone);
    setPendingPolygon(null);
    setFormName(zone.name);
    setFormDesc(zone.description);
    setFormError("");
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingZone(null);
    setPendingPolygon(null);
  };

  const handleSave = async () => {
    if (!formName.trim()) { setFormError("El nombre es obligatorio."); return; }
    setSaving(true); setFormError("");
    try {
      if (editingZone) {
        const updates: Record<string, unknown> = {
          name: formName,
          description: formDesc,
        };
        if (pendingPolygon) {
          updates.polygon = pendingPolygon.map(([lat, lng]) => ({ lat, lng }));
        }
        await zoneApi.update(editingZone.id, updates);
      } else if (pendingPolygon) {
        await zoneApi.create({
          name: formName,
          description: formDesc,
          polygon: pendingPolygon.map(([lat, lng]) => ({ lat, lng })),
        });
      }
      closeFormModal();
      load();
    } catch {
      setFormError("No se pudo guardar la zona.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (zone: Zone) => {
    await zoneApi.update(zone.id, { active: !zone.active });
    load();
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await zoneApi.remove(confirmDelete.id);
      setConfirmDelete(null);
      load();
    } finally {
      setDeleting(false);
    }
  };

  const selectZone = (id: string) => {
    setSelectedZoneId(id);
    const zone = zones.find((z) => z.id === id);
    if (zone && mapInstance.current && zone.polygon.length >= 3) {
      const bounds = L.latLngBounds(zone.polygon.map((p) => [p.lat, p.lng] as [number, number]));
      mapInstance.current.flyToBounds(bounds, { padding: [80, 80], duration: 0.7 });
    }
  };
  useLayoutEffect(() => { selectZoneRef.current = selectZone; });

  const totalCount = zones.length;
  const activeCount = zones.filter((z) => z.active).length;
  const visibleZones = showInactive ? zones : zones.filter((z) => z.active);
  const isDrawing = drawingMode !== "none";

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* Sidebar */}
      <div className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <PageHeader
            title="Zonas peligrosas"
            description={`${activeCount} de ${totalCount} activa${activeCount !== 1 ? "s" : ""}`}
            icon={<AlertTriangle className="w-5 h-5" />}
          />
          {!isDrawing ? (
            <button
              onClick={startDrawingNew}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 h-9 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] text-white text-sm font-semibold cursor-pointer transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dibujar nueva zona
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={closePolygon}
                  disabled={draftVertices.length < 3}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Cerrar ({draftVertices.length})
                </button>
                <button
                  onClick={undoLastVertex}
                  disabled={draftVertices.length === 0}
                  title="Deshacer último punto (⌘Z)"
                  className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-300 text-slate-600 text-sm font-semibold cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={cancelDrawing}
                  title="Cancelar (Esc)"
                  className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-sm font-semibold cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {drawingMode === "edit" ? "Re-dibujando " : ""}
                Click en el mapa para agregar vértices.{" "}
                <span className="text-slate-400">⌘Z deshace, Enter cierra, Esc cancela.</span>
              </p>
            </div>
          )}
        </div>

        {/* Filter */}
        {!isDrawing && totalCount > 0 && (
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {visibleZones.length} mostrada{visibleZones.length !== 1 ? "s" : ""}
            </span>
            <label className="text-xs text-slate-600 inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="cursor-pointer"
              />
              Incluir inactivas
            </label>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <p className="text-sm text-slate-500 text-center py-8">Cargando…</p>}
          {!loading && visibleZones.length === 0 && (
            <div className="text-center py-12">
              <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                {totalCount === 0 ? "Sin zonas definidas." : "No hay zonas que coincidan."}
              </p>
              {totalCount === 0 && (
                <p className="text-xs text-slate-400 mt-1">Dibujá una zona en el mapa.</p>
              )}
            </div>
          )}
          {visibleZones.map((zone) => {
            const isSelected = zone.id === selectedZoneId;
            return (
              <Card
                key={zone.id}
                onClick={() => selectZone(zone.id)}
                className={`p-3 cursor-pointer transition-all ${isSelected ? "ring-2 ring-[#1e3a5f]" : "hover:bg-slate-50"} ${!zone.active ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      <p className="text-sm font-semibold text-slate-900 truncate">{zone.name}</p>
                      {!zone.active && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                          Pausada
                        </span>
                      )}
                    </div>
                    {zone.description && (
                      <p className="text-xs text-slate-500 truncate mt-0.5 ml-5">{zone.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditModal(zone); }}
                      className="w-7 h-7 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
                      title="Editar"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleActive(zone); }}
                      className={`w-7 h-7 rounded-md hover:bg-slate-100 flex items-center justify-center cursor-pointer ${zone.active ? "text-emerald-600" : "text-slate-400 hover:text-slate-700"}`}
                      title={zone.active ? "Pausar (queda en la lista)" : "Reactivar"}
                    >
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(zone); }}
                      className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-500 cursor-pointer"
                      title="Eliminar definitivamente"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapRef} className="w-full h-full" />
        {isDrawing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-[#1e3a5f]/95 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg">
            {drawingMode === "edit" ? "🖍 Re-dibujando " : "✏ Dibujando "}
            — click para agregar puntos
            {draftVertices.length >= 3 && <span className="ml-1 text-emerald-300">· tocá el primer punto para cerrar</span>}
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {showFormModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-base font-bold text-slate-900 mb-1">
              {editingZone ? "Editar zona peligrosa" : "Nueva zona peligrosa"}
            </h2>
            <p className="text-xs text-red-600 mb-4">
              ⚠️ Las zonas peligrosas aplican recargo en envíos de última milla.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 block">Nombre *</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ej: Villa Soldati - noche"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 block">Descripción (opcional)</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Ej: Reportes de robos a repartidores en horario nocturno"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                />
              </div>

              {/* Solo en edit: opción re-dibujar polígono */}
              {editingZone && (
                <div className="pt-2 border-t border-slate-100">
                  <button
                    onClick={() => startDrawingEdit(editingZone)}
                    className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold cursor-pointer transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {pendingPolygon ? "Volver a re-dibujar polígono" : "Re-dibujar polígono"}
                  </button>
                  {pendingPolygon && (
                    <p className="text-[11px] text-emerald-600 mt-1.5 text-center">
                      ✓ Nuevo polígono listo ({pendingPolygon.length} vértices)
                    </p>
                  )}
                </div>
              )}
            </div>

            {formError && <p className="mt-3 text-sm text-red-600">{formError}</p>}

            <div className="flex gap-2 mt-5">
              <button
                onClick={closeFormModal}
                className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 h-10 rounded-lg bg-[#1e3a5f] hover:bg-[#15294a] disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Guardando…" : editingZone ? "Guardar cambios" : "Crear zona"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmación de borrado */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px]">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Eliminar zona</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Vas a eliminar definitivamente <strong>{confirmDelete.name}</strong>. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 mb-4">
              💡 Si solo querés que deje de aplicar temporalmente, pausala con el botón <Power className="inline w-3 h-3" /> y mantenela en la lista.
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="flex-1 h-10 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 h-10 rounded-lg bg-red-500 hover:bg-red-600 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-bold cursor-pointer disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
