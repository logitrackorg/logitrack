import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  type CoverageCell,
  type SuggestedLocation,
  type SnappedCity,
  GAP_STYLE,
  COVERED_STYLE,
} from "../api/coverage";

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
export function VoronoiCoverageMap({
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
}: VoronoiCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const cellsLayer = useRef<L.LayerGroup | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const simLayer = useRef<L.LayerGroup | null>(null);
  const suggestionsLayer = useRef<L.LayerGroup | null>(null);
  const boundaryLayer = useRef<L.LayerGroup | null>(null);
  const drawLayer = useRef<L.LayerGroup | null>(null);

  // Refs para manejar el estado de dibujo sin stale closures en los event handlers.
  const isDrawingRef = useRef(isDrawingBoundary);
  const draftVerticesRef = useRef<[number, number][]>([]);
  const onBoundaryCompleteRef = useRef(onBoundaryComplete);
  const onBoundaryCancelRef = useRef(onBoundaryCancel);
  const onSelectRef = useRef(onSelectBranch);

  useEffect(() => { isDrawingRef.current = isDrawingBoundary; }, [isDrawingBoundary]);
  useEffect(() => { onBoundaryCompleteRef.current = onBoundaryComplete; }, [onBoundaryComplete]);
  useEffect(() => { onBoundaryCancelRef.current = onBoundaryCancel; }, [onBoundaryCancel]);
  useEffect(() => { onSelectRef.current = onSelectBranch; }, [onSelectBranch]);

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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    cellsLayer.current = L.layerGroup().addTo(map);
    markersLayer.current = L.layerGroup().addTo(map);
    simLayer.current = L.layerGroup().addTo(map);
    suggestionsLayer.current = L.layerGroup().addTo(map);
    boundaryLayer.current = L.layerGroup().addTo(map);
    drawLayer.current = L.layerGroup().addTo(map);

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
  useEffect(() => {
    const layer = boundaryLayer.current;
    if (!layer) return;
    layer.clearLayers();
    if (!customBoundary || customBoundary.length < 3) return;

    L.polygon(customBoundary, {
      color: "#2563eb",
      weight: 2.5,
      dashArray: "8 5",
      fillColor: "#2563eb",
      fillOpacity: 0.06,
    })
      .bindTooltip("Área personalizada activa", { sticky: true })
      .addTo(layer);
  }, [customBoundary]);

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

  return <div ref={containerRef} className="h-full w-full" />;
}

function formatKm2(v: number): string {
  return `${Math.round(v).toLocaleString("es-AR")} km²`;
}
