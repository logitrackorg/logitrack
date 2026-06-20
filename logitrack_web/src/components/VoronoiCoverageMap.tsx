import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.heat";
import {
  coverageApi,
  type CoverageCell,
  type SuggestedLocation,
  type SnappedCity,
  type RejectedLocation,
  GAP_STYLE,
  COVERED_STYLE,
} from "../api/coverage";

export interface VoronoiCoverageMapHandle {
  /** Animate the map to the given coordinates and zoom level. */
  flyTo(lat: number, lng: number, zoom?: number): void;
  /** Fit the viewport to a polygon (e.g. a selected region boundary). */
  fitBoundsToPolygon(points: [number, number][]): void;
}

interface VoronoiCoverageMapProps {
  cells: CoverageCell[];
  /** branch_id resaltado (p.ej. fila seleccionada en el panel). */
  highlightedBranchId?: string | null;
  /** Recibe `null` cuando se hace click sobre la celda ya seleccionada (toggle). */
  onSelectBranch?: (branchId: string | null) => void;
  /**
   * Área simulada (km²) para previsualizar un radio de cobertura con un
   * círculo punteado. Si `highlightedBranchId` está seteado, el círculo se
   * dibuja solo sobre esa sucursal; si es `null`, se dibuja uno por sucursal.
   * `null`/`0` = sin simulación activa.
   */
  simulationAreaKm2?: number | null;
  /**
   * Ubicaciones sugeridas para nuevas sucursales (gaps críticos detectados por
   * el último diagnóstico del simulador). Se dibujan con el ícono de sucursal
   * "apagado" (escala de grises) y un círculo gris punteado del mismo radio
   * que el simulador.
   */
  suggestedLocations?: SuggestedLocation[];
  /**
   * "Aterrizar sugerencias en ciudades reales": resultado de Snap to City para
   * cada entrada de `suggestedLocations`, en el mismo orden (mismo largo). Las
   * entradas con `is_snapped = true` mueven el marcador y su círculo a la
   * coordenada real (animado vía transición CSS), los pintan de verde y
   * actualizan el tooltip con el nombre de la ciudad. Las entradas con
   * `is_snapped = false` mantienen el color gris (no se encontró ciudad real).
   */
  snappedCities?: SnappedCity[] | null;
  /**
   * Cuando true, el cursor cambia a crosshair y cada click en el mapa agrega
   * un vértice al polígono de área personalizada. Enter lo cierra, Esc cancela,
   * Cmd/Ctrl+Z deshace el último vértice.
   */
  isDrawingBoundary?: boolean;
  /** Llamado con los vértices cuando el usuario cierra el polígono (Enter o ≥3 puntos). */
  onBoundaryComplete?: (pts: [number, number][]) => void;
  /** Llamado cuando el usuario presiona Esc durante el dibujo. */
  onBoundaryCancel?: () => void;
  /**
   * Polígono personalizado ya confirmado: se dibuja como un borde azul
   * punteado sobre el mapa para indicar la zona activa del simulador.
   */
  customBoundary?: [number, number][] | null;
  /**
   * Forma original de una zona que se está re-dibujando: se pinta con un
   * relleno claro de fondo como referencia mientras el usuario traza el nuevo
   * polígono. `null` = no hay re-dibujo en curso.
   */
  redrawReference?: [number, number][] | null;
  /**
   * Cuando true, el mapa entra en modo edición de vértices: muestra handles
   * arrastrables en cada vértice del polígono activo y marcadores en los
   * puntos medios para insertar nuevos vértices. Enter confirma, Esc cancela.
   */
  isEditingBoundary?: boolean;
  /** Llamado con los vértices finales cuando el usuario confirma la edición (Enter). */
  onBoundaryEdited?: (pts: [number, number][]) => void;
  /** Llamado cuando el usuario presiona Esc durante la edición. */
  onBoundaryEditCancel?: () => void;
  /**
   * Cuando true, superpone un mapa de calor de zonas industriales OSM sobre
   * la vista actual. Se actualiza automáticamente en cada paneo/zoom (moveend).
   * Solo activo a partir del zoom 7 (vista regional); se borra al deshabilitar.
   */
  showIndustrialHeatmap?: boolean;
  /** Ciudades descartadas por el filtro de densidad: se dibujan como círculos grises semitransparentes. */
  rejectedLocations?: RejectedLocation[];
}

const FACTORY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>`;
const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

const SUGGESTION_COLOR_UNSNAPPED = "#808080";
const SUGGESTION_COLOR_SNAPPED = "#28a745";

/** Ícono de fábrica circular usado para los marcadores de sugerencia, en el color dado. */
function suggestionIcon(color: string): L.DivIcon {
  return L.divIcon({
    html: `<div class="coverage-suggestion-icon" style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center">${FACTORY_SVG}</div>`,
    className: "coverage-suggestion-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/**
 * VoronoiCoverageMap renderiza el diagrama de cobertura por sucursal: cada celda
 * de Voronoi como polígono translúcido coloreado por severidad de gap, con un
 * marcador en la sucursal y, en las celdas con gap, una estrella en la ubicación
 * sugerida para una nueva sucursal.
 *
 * Cuando `isDrawingBoundary` es true, el mapa pasa a modo dibujo: cada click
 * agrega un vértice al polígono de área personalizada (mismo patrón que
 * ZoneManagement). Enter cierra el polígono, Esc cancela, Cmd/Ctrl+Z deshace.
 *
 * El mapa es responsive: un ResizeObserver llama invalidateSize() cuando el
 * contenedor cambia de tamaño.
 */
export const VoronoiCoverageMap = forwardRef<VoronoiCoverageMapHandle, VoronoiCoverageMapProps>(
function VoronoiCoverageMap({
  cells,
  highlightedBranchId,
  onSelectBranch,
  simulationAreaKm2,
  suggestedLocations,
  snappedCities,
  isDrawingBoundary = false,
  onBoundaryComplete,
  onBoundaryCancel,
  customBoundary,
  redrawReference,
  isEditingBoundary = false,
  onBoundaryEdited,
  onBoundaryEditCancel,
  showIndustrialHeatmap = false,
  rejectedLocations,
}: VoronoiCoverageMapProps, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom = 8) {
      mapRef.current?.flyTo([lat, lng], zoom, { duration: 1.5 });
    },
    fitBoundsToPolygon(points) {
      if (mapRef.current && points.length >= 2) {
        mapRef.current.fitBounds(L.latLngBounds(points), { padding: [24, 24], animate: true });
      }
    },
  }));
  const cellsLayer = useRef<L.LayerGroup | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const simLayer = useRef<L.LayerGroup | null>(null);
  const suggestionsLayer = useRef<L.LayerGroup | null>(null);
  const boundaryLayer = useRef<L.LayerGroup | null>(null);
  const referenceLayer = useRef<L.LayerGroup | null>(null);
  const drawLayer = useRef<L.LayerGroup | null>(null);
  const editLayer = useRef<L.LayerGroup | null>(null);
  const heatmapLayerRef = useRef<L.HeatLayer | null>(null);
  const rejectedLayer = useRef<L.LayerGroup | null>(null);

  // Refs para manejar el estado de dibujo sin stale closures en los event handlers.
  const isDrawingRef = useRef(isDrawingBoundary);
  const draftVerticesRef = useRef<[number, number][]>([]);
  const onBoundaryCompleteRef = useRef(onBoundaryComplete);
  const onBoundaryCancelRef = useRef(onBoundaryCancel);
  const onSelectRef = useRef(onSelectBranch);
  const editVerticesRef = useRef<[number, number][]>([]);
  const onBoundaryEditedRef = useRef(onBoundaryEdited);
  const onBoundaryEditCancelRef = useRef(onBoundaryEditCancel);

  useEffect(() => { isDrawingRef.current = isDrawingBoundary; }, [isDrawingBoundary]);
  useEffect(() => { onBoundaryCompleteRef.current = onBoundaryComplete; }, [onBoundaryComplete]);
  useEffect(() => { onBoundaryCancelRef.current = onBoundaryCancel; }, [onBoundaryCancel]);
  useEffect(() => { onSelectRef.current = onSelectBranch; }, [onSelectBranch]);
  useEffect(() => { onBoundaryEditedRef.current = onBoundaryEdited; }, [onBoundaryEdited]);
  useEffect(() => { onBoundaryEditCancelRef.current = onBoundaryEditCancel; }, [onBoundaryEditCancel]);

  const suggestionMarkersRef = useRef<
    { marker: L.Marker; circle: L.Circle | null; loc: SuggestedLocation }[]
  >([]);

  // Inicializar el mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [-38.0, -63.0],
      zoom: 4,
      zoomControl: true,
      scrollWheelZoom: true,
    });
    const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    const topoLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a>, © OpenStreetMap',
      maxZoom: 17,
    });
    L.control.layers(
      { "🏙 Vista Urbana": osmLayer, "🗺 Vista Topográfica": topoLayer },
      {},
      { position: "topright" },
    ).addTo(map);
    heatmapLayerRef.current = L.heatLayer([], {
      radius: 25,
      blur: 20,
      gradient: { 0.3: "#fef3c7", 0.6: "#f59e0b", 1.0: "#b45309" },
    }).addTo(map);
    mapRef.current = map;
    cellsLayer.current = L.layerGroup().addTo(map);
    markersLayer.current = L.layerGroup().addTo(map);
    simLayer.current = L.layerGroup().addTo(map);
    suggestionsLayer.current = L.layerGroup().addTo(map);
    boundaryLayer.current = L.layerGroup().addTo(map);
    referenceLayer.current = L.layerGroup().addTo(map);
    drawLayer.current = L.layerGroup().addTo(map);
    editLayer.current = L.layerGroup().addTo(map);
    rejectedLayer.current = L.layerGroup().addTo(map);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Modo dibujo: click para agregar vértices, preview del polígono borrador.
  useEffect(() => {
    const map = mapRef.current;
    const layer = drawLayer.current;
    if (!map || !layer) return;

    if (!isDrawingBoundary) {
      map.getContainer().style.cursor = "";
      layer.clearLayers();
      draftVerticesRef.current = [];
      return;
    }

    map.getContainer().style.cursor = "crosshair";
    draftVerticesRef.current = [];

    const redrawDraft = (verts: [number, number][]) => {
      layer.clearLayers();
      if (verts.length === 0) return;
      // Vértices como marcadores pequeños.
      verts.forEach(([lat, lng]) => {
        L.circleMarker([lat, lng], {
          radius: 5,
          color: "#3b82f6",
          fillColor: "#3b82f6",
          fillOpacity: 1,
          weight: 2,
        }).addTo(layer);
      });
      // Preview del polígono (cerrado si ≥3 vértices).
      if (verts.length >= 2) {
        L.polygon(verts, {
          color: "#3b82f6",
          weight: 2,
          dashArray: "6 4",
          fillColor: "#3b82f6",
          fillOpacity: 0.1,
        }).addTo(layer);
      }
    };

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (!isDrawingRef.current) return;
      const pt: [number, number] = [e.latlng.lat, e.latlng.lng];
      const newVerts = [...draftVerticesRef.current, pt];
      draftVerticesRef.current = newVerts;
      redrawDraft(newVerts);
    };

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [isDrawingBoundary]);

  // Teclado: Enter cierra el polígono, Esc cancela, Cmd/Ctrl+Z deshace.
  useEffect(() => {
    if (!isDrawingBoundary) return;

    const handler = (e: KeyboardEvent) => {
      if (!isDrawingRef.current) return;
      if (e.key === "Escape") {
        draftVerticesRef.current = [];
        drawLayer.current?.clearLayers();
        onBoundaryCancelRef.current?.();
      } else if (e.key === "Enter" && draftVerticesRef.current.length >= 3) {
        const verts = [...draftVerticesRef.current];
        draftVerticesRef.current = [];
        drawLayer.current?.clearLayers();
        onBoundaryCompleteRef.current?.(verts);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        const prev = draftVerticesRef.current.slice(0, -1);
        draftVerticesRef.current = prev;
        // Redibujar el draft con el último vértice eliminado.
        const layer = drawLayer.current;
        if (!layer) return;
        layer.clearLayers();
        if (prev.length >= 2) {
          prev.forEach(([lat, lng]) => {
            L.circleMarker([lat, lng], {
              radius: 5, color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 1, weight: 2,
            }).addTo(layer);
          });
          L.polygon(prev, {
            color: "#3b82f6", weight: 2, dashArray: "6 4", fillColor: "#3b82f6", fillOpacity: 0.1,
          }).addTo(layer);
        } else if (prev.length === 1) {
          L.circleMarker([prev[0][0], prev[0][1]], {
            radius: 5, color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 1, weight: 2,
          }).addTo(layer);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDrawingBoundary]);

  // Renderizar el polígono personalizado confirmado (borde azul permanente).
  // Se omite cuando está en modo edición — editLayer dibuja la versión editable.
  useEffect(() => {
    const layer = boundaryLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (isEditingBoundary || !customBoundary || customBoundary.length < 3) return;

    L.polygon(customBoundary, {
      color: "#2563eb",
      weight: 2.5,
      dashArray: "8 5",
      fillColor: "#2563eb",
      fillOpacity: 0.06,
    })
      .bindTooltip("Área personalizada activa", { sticky: true })
      .addTo(layer);
  }, [customBoundary, isEditingBoundary]);

  // Modo edición de vértices: handles arrastrables + puntos medios para insertar.
  useEffect(() => {
    const layer = editLayer.current;
    if (!layer) return;

    if (!isEditingBoundary || !customBoundary || customBoundary.length < 3) {
      layer.clearLayers();
      return;
    }

    editVerticesRef.current = [...customBoundary];

    const vertexIcon = (total: number) =>
      L.divIcon({
        html: `<div style="width:12px;height:12px;border-radius:50%;background:#6d28d9;border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);cursor:grab" title="${total > 3 ? "Arrastrar · clic derecho para eliminar" : "Arrastrar para mover"}"></div>`,
        className: "",
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

    let editPoly: L.Polygon | null = null;

    const rebuild = () => {
      const verts = editVerticesRef.current;
      layer.clearLayers();

      editPoly = L.polygon(verts, {
        color: "#7c3aed",
        weight: 2,
        dashArray: "6 4",
        fillColor: "#7c3aed",
        fillOpacity: 0.07,
      }).addTo(layer);

      const n = verts.length;

      // Vertex handles (draggable L.Marker with DivIcon)
      verts.forEach((pt, i) => {
        const marker = L.marker(pt, {
          draggable: true,
          icon: vertexIcon(n),
        }).addTo(layer);

        marker.on("drag", (e) => {
          const latlng = (e.target as L.Marker).getLatLng();
          editVerticesRef.current[i] = [latlng.lat, latlng.lng];
          if (editPoly) editPoly.setLatLngs(editVerticesRef.current as L.LatLngExpression[]);
        });

        marker.on("dragend", () => rebuild());

        if (n > 3) {
          marker.on("contextmenu", (e) => {
            L.DomEvent.stopPropagation(e);
            editVerticesRef.current = [
              ...editVerticesRef.current.slice(0, i),
              ...editVerticesRef.current.slice(i + 1),
            ];
            rebuild();
          });
        }
      });

      // Midpoint handles (click to insert new vertex)
      verts.forEach((pt, i) => {
        const nextPt = verts[(i + 1) % n];
        const midPt: [number, number] = [(pt[0] + nextPt[0]) / 2, (pt[1] + nextPt[1]) / 2];
        L.circleMarker(midPt, {
          radius: 5,
          color: "#7c3aed",
          fillColor: "#ede9fe",
          fillOpacity: 1,
          weight: 2,
          bubblingMouseEvents: false,
        } as L.CircleMarkerOptions)
          .bindTooltip("Clic para agregar vértice", { direction: "top", offset: [0, -8] })
          .on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            editVerticesRef.current = [
              ...editVerticesRef.current.slice(0, i + 1),
              midPt,
              ...editVerticesRef.current.slice(i + 1),
            ];
            rebuild();
          })
          .addTo(layer);
      });
    };

    rebuild();

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && editVerticesRef.current.length >= 3) {
        onBoundaryEditedRef.current?.([...editVerticesRef.current]);
      } else if (e.key === "Escape") {
        onBoundaryEditCancelRef.current?.();
      }
    };
    window.addEventListener("keydown", keyHandler);

    return () => {
      window.removeEventListener("keydown", keyHandler);
      layer.clearLayers();
    };
  }, [isEditingBoundary, customBoundary]);

  // Forma original de referencia mientras se re-dibuja una zona: relleno claro
  // de fondo, lo bastante visible para ubicarse pero más tenue que el borrador.
  useEffect(() => {
    const layer = referenceLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!redrawReference || redrawReference.length < 3) return;

    L.polygon(redrawReference, {
      color: "#64748b",
      weight: 1.5,
      opacity: 0.6,
      fillColor: "#94a3b8",
      fillOpacity: 0.25,
    })
      .bindTooltip("Zona original (referencia)", { sticky: true })
      .addTo(layer);
  }, [redrawReference]);

  // Redibujar celdas + marcadores cuando cambian los datos o el resaltado.
  useEffect(() => {
    const map = mapRef.current;
    const cLayer = cellsLayer.current;
    const mLayer = markersLayer.current;
    if (!map || !cLayer || !mLayer) return;

    cLayer.clearLayers();
    mLayer.clearLayers();

    const allLatLngs: [number, number][] = [];

    cells.forEach((cell) => {
      const rings = cell.polygon
        .filter((ring) => ring.length >= 3)
        .map((ring) => ring.map((p) => [p.lat, p.lng] as [number, number]));
      if (rings.length > 0) {
        rings.forEach((ring) => allLatLngs.push(...ring));
        const style =
          cell.is_gap && cell.gap_severity
            ? GAP_STYLE[cell.gap_severity]
            : COVERED_STYLE;
        const isHighlighted = cell.branch_id === highlightedBranchId;
        const poly = L.polygon(rings, {
          color: style.stroke,
          fillColor: style.fill,
          fillOpacity: 1,
          weight: isHighlighted ? 3.5 : 1.5,
          opacity: isHighlighted ? 1 : 0.8,
          dashArray: cell.is_gap ? "6, 5" : undefined,
        });
        poly.on("click", () => {
          if (isDrawingRef.current) return; // ignorar clicks de dibujo
          onSelectRef.current?.(cell.branch_id === highlightedBranchId ? null : cell.branch_id);
        });
        poly.bindTooltip(
          `<strong>${cell.branch_name}</strong><br/>${cell.province}<br/>Cobertura: ${formatKm2(cell.area_km2)}${
            cell.is_gap ? `<br/><em>Zona sub-cubierta (${cell.gap_severity})</em>` : ""
          }`,
          { sticky: true }
        );
        poly.addTo(cLayer);
      }

      const branchIcon = L.divIcon({
        html: `<div style="width:28px;height:28px;border-radius:50%;background:#1e3a5f;border:2px solid white;box-shadow:0 1px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center">${FACTORY_SVG}</div>`,
        className: "",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([cell.site.lat, cell.site.lng], { icon: branchIcon })
        .bindPopup(`<strong>${cell.branch_name}</strong><br/>${cell.province}`)
        .addTo(mLayer);

      if (cell.is_gap && cell.suggestion) {
        const sevColor = cell.gap_severity
          ? GAP_STYLE[cell.gap_severity].stroke
          : "#ef4444";
        const sugIcon = L.divIcon({
          html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${sevColor};border:2px solid white;box-shadow:0 1px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(45deg)">${STAR_SVG}</div></div>`,
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 26],
        });
        L.marker([cell.suggestion.lat, cell.suggestion.lng], { icon: sugIcon })
          .bindPopup(
            `<strong>Ubicación sugerida</strong><br/>Nueva sucursal para cubrir la zona de <em>${cell.branch_name}</em>`
          )
          .addTo(mLayer);
      }
    });

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [30, 30] });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [cells, highlightedBranchId]);

  // Círculo de previsualización del simulador.
  useEffect(() => {
    const sLayer = simLayer.current;
    if (!sLayer) return;

    sLayer.clearLayers();
    if (!simulationAreaKm2 || simulationAreaKm2 <= 0) return;

    const radiusMeters = 1000 * Math.sqrt(simulationAreaKm2 / Math.PI);
    const targets = highlightedBranchId
      ? cells.filter((c) => c.branch_id === highlightedBranchId)
      : cells;

    targets.forEach((cell) => {
      L.circle([cell.site.lat, cell.site.lng], {
        radius: radiusMeters,
        color: "#ff9900",
        weight: 2,
        dashArray: "8, 8",
        fillColor: "#ff9900",
        fillOpacity: 0.1,
      }).addTo(sLayer);
    });
  }, [cells, highlightedBranchId, simulationAreaKm2]);

  // Ubicaciones sugeridas para nuevas sucursales.
  useEffect(() => {
    const sgLayer = suggestionsLayer.current;
    if (!sgLayer) return;

    sgLayer.clearLayers();
    suggestionMarkersRef.current = [];
    if (!suggestedLocations || suggestedLocations.length === 0) return;

    const radiusMeters =
      simulationAreaKm2 && simulationAreaKm2 > 0
        ? 1000 * Math.sqrt(simulationAreaKm2 / Math.PI)
        : null;

    suggestedLocations.forEach((loc) => {
      let circle: L.Circle | null = null;
      if (radiusMeters) {
        circle = L.circle([loc.lat, loc.lng], {
          radius: radiusMeters,
          color: SUGGESTION_COLOR_UNSNAPPED,
          weight: 2,
          dashArray: "5, 5",
          fillColor: SUGGESTION_COLOR_UNSNAPPED,
          fillOpacity: 0.1,
        }).addTo(sgLayer);
      }

      const marker = L.marker([loc.lat, loc.lng], {
        icon: suggestionIcon(SUGGESTION_COLOR_UNSNAPPED),
        zIndexOffset: 1000,
      })
        .bindTooltip(
          `<strong>Ubicación sugerida para nueva sucursal</strong><br/>Cubre zona sin cobertura de ${loc.branch_name}<br/>Área sin cubrir: ${formatKm2(loc.gap_area_km2)}`,
          { sticky: true }
        )
        .addTo(sgLayer);

      suggestionMarkersRef.current.push({ marker, circle, loc });
    });
  }, [suggestedLocations, simulationAreaKm2]);

  // Snap to City: mueve marcadores a ciudades reales.
  useEffect(() => {
    if (!snappedCities || snappedCities.length === 0) return;

    suggestionMarkersRef.current.forEach(({ marker, circle, loc }, i) => {
      const snapped = snappedCities[i];
      if (!snapped || !snapped.is_snapped) return;

      const latLng: L.LatLngTuple = [snapped.lat, snapped.lng];
      marker.setLatLng(latLng);
      marker.setIcon(suggestionIcon(SUGGESTION_COLOR_SNAPPED));
      circle?.setLatLng(latLng);
      circle?.setStyle({ color: SUGGESTION_COLOR_SNAPPED, fillColor: SUGGESTION_COLOR_SNAPPED });
      marker.setTooltipContent(
        `<strong>Sugerencia viable: ${snapped.city_name}</strong> - Ciudad real cercana al centro de déficit<br/>Cubre zona sin cobertura de ${loc.branch_name}<br/>Área sin cubrir: ${formatKm2(loc.gap_area_km2)}`
      );
    });
  }, [snappedCities]);

  // Mapa de calor industrial: suscribe al evento moveend, fetcha Overpass por bbox
  // y actualiza la heatLayer. Solo activo cuando showIndustrialHeatmap es true.
  useEffect(() => {
    const map = mapRef.current;
    const heat = heatmapLayerRef.current;
    if (!map || !heat) return;

    let cancelled = false;

    const fetchHeatmap = () => {
      if (!showIndustrialHeatmap || map.getZoom() < 7) {
        heat.setLatLngs([]);
        return;
      }
      const b = map.getBounds();
      const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
      coverageApi
        .getIndustrialHeatmap(bbox)
        .then((pts) => { if (!cancelled) heat.setLatLngs(pts as [number, number][]); })
        .catch(() => {});
    };

    map.on("moveend", fetchHeatmap);
    if (showIndustrialHeatmap) fetchHeatmap();

    return () => {
      cancelled = true;
      map.off("moveend", fetchHeatmap);
      heat.setLatLngs([]);
    };
  }, [showIndustrialHeatmap]);

  // Rejected locations: grey semi-transparent circles with a tooltip showing the reject reason.
  useEffect(() => {
    const layer = rejectedLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!rejectedLocations?.length) return;
    for (const r of rejectedLocations) {
      L.circleMarker([r.lat, r.lng], {
        radius: 8,
        color: "#6b7280",
        weight: 1.5,
        fillColor: "#9ca3af",
        fillOpacity: 0.35,
        dashArray: "4 3",
      })
        .bindTooltip(`<strong>${r.city_name}</strong><br/><span style="font-size:11px">${r.reject_reason}</span>`, {
          direction: "top",
          offset: [0, -6],
        })
        .addTo(layer);
    }
  }, [rejectedLocations]);

  return <div ref={containerRef} className="h-full w-full" />;
});

function formatKm2(v: number): string {
  return `${Math.round(v).toLocaleString("es-AR")} km²`;
}
