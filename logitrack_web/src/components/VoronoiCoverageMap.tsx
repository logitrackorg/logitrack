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
   * entradas con `found = true` mueven el marcador y su círculo a la
   * coordenada real (animado vía transición CSS) y actualizan el tooltip.
   */
  snappedCities?: SnappedCity[] | null;
}

const FACTORY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>`;
const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

/**
 * VoronoiCoverageMap renderiza el diagrama de cobertura por sucursal: cada celda
 * de Voronoi como polígono translúcido coloreado por severidad de gap, con un
 * marcador en la sucursal y, en las celdas con gap, una estrella en la ubicación
 * sugerida para una nueva sucursal.
 *
 * El mapa es responsive: un ResizeObserver llama invalidateSize() cuando el
 * contenedor cambia de tamaño, de modo que se adapta al espacio del dashboard y
 * a la pantalla sin recortes.
 */
export function VoronoiCoverageMap({
  cells,
  highlightedBranchId,
  onSelectBranch,
  simulationAreaKm2,
  suggestedLocations,
  snappedCities,
}: VoronoiCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const cellsLayer = useRef<L.LayerGroup | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const simLayer = useRef<L.LayerGroup | null>(null);
  const suggestionsLayer = useRef<L.LayerGroup | null>(null);
  // Marcadores/círculos de sugerencias geométricas, en el mismo orden que
  // `suggestedLocations`, para que el efecto de Snap to City pueda moverlos
  // (setLatLng anima vía la transición CSS de .coverage-suggestion-marker) y
  // actualizar su tooltip sin reconstruir toda la capa.
  const suggestionMarkersRef = useRef<
    { marker: L.Marker; circle: L.Circle | null; loc: SuggestedLocation }[]
  >([]);
  const onSelectRef = useRef(onSelectBranch);
  useEffect(() => {
    onSelectRef.current = onSelectBranch;
  }, [onSelectBranch]);

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

    // Responsive: re-ajustar el tamaño del mapa cuando cambia el contenedor.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
        // rings puede contener varios fragmentos desconectados (p.ej.
        // continente + Tierra del Fuego); L.polygon los renderiza como una
        // sola layer con un anillo por fragmento.
        const poly = L.polygon(rings, {
          color: style.stroke,
          fillColor: style.fill,
          fillOpacity: 1,
          weight: isHighlighted ? 3.5 : 1.5,
          opacity: isHighlighted ? 1 : 0.8,
          dashArray: cell.is_gap ? "6, 5" : undefined,
        });
        poly.on("click", () => {
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

      // Marcador de la sucursal.
      const branchIcon = L.divIcon({
        html: `<div style="width:28px;height:28px;border-radius:50%;background:#1e3a5f;border:2px solid white;box-shadow:0 1px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center">${FACTORY_SVG}</div>`,
        className: "",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([cell.site.lat, cell.site.lng], { icon: branchIcon })
        .bindPopup(`<strong>${cell.branch_name}</strong><br/>${cell.province}`)
        .addTo(mLayer);

      // Estrella de sugerencia en celdas con gap.
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
    // Asegurar el cálculo correcto tras el primer render del contenedor.
    setTimeout(() => map.invalidateSize(), 0);
  }, [cells, highlightedBranchId]);

  // Círculo de previsualización del simulador de cobertura: radio = sqrt(área/π)
  // convertido de km a metros (Leaflet espera metros). Si hay una sucursal
  // resaltada, se dibuja solo sobre esa; si no, uno por sucursal.
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

  // Ubicaciones sugeridas para nuevas sucursales: ícono de sucursal "apagado"
  // (mismo ícono que las sucursales reales, en escala de grises y con opacidad
  // reducida) más un círculo gris punteado con el mismo radio del simulador,
  // derivados de los gaps críticos del último diagnóstico. Se guarda cada
  // marcador/círculo en suggestionMarkersRef para que el efecto de Snap to
  // City pueda moverlos sin reconstruir la capa.
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
          color: "#808080",
          weight: 2,
          dashArray: "5, 5",
          fillColor: "#808080",
          fillOpacity: 0.1,
        }).addTo(sgLayer);
      }

      const icon = L.divIcon({
        html: `<div class="coverage-suggestion-icon" style="width:28px;height:28px;border-radius:50%;background:#1e3a5f;border:2px solid white;box-shadow:0 1px 6px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center">${FACTORY_SVG}</div>`,
        className: "coverage-suggestion-marker",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const marker = L.marker([loc.lat, loc.lng], { icon, zIndexOffset: 1000 })
        .bindTooltip(
          `<strong>Ubicación sugerida para nueva sucursal</strong><br/>Cubre zona sin cobertura de ${loc.branch_name}<br/>Área sin cubrir: ${formatKm2(loc.gap_area_km2)}`,
          { sticky: true }
        )
        .addTo(sgLayer);

      suggestionMarkersRef.current.push({ marker, circle, loc });
    });
  }, [suggestedLocations, simulationAreaKm2]);

  // "Aterrizar sugerencias en ciudades reales": mueve cada marcador (y su
  // círculo, si lo tiene) a la coordenada real devuelta por Snap to City y
  // actualiza el tooltip. setLatLng sobre el marcador existente anima la
  // transición vía la clase CSS .coverage-suggestion-marker (transform).
  useEffect(() => {
    if (!snappedCities || snappedCities.length === 0) return;

    suggestionMarkersRef.current.forEach(({ marker, circle, loc }, i) => {
      const snapped = snappedCities[i];
      if (!snapped || !snapped.found) return;

      const latLng: L.LatLngTuple = [snapped.lat, snapped.lng];
      marker.setLatLng(latLng);
      circle?.setLatLng(latLng);
      marker.setTooltipContent(
        `<strong>Sugerencia real: ${snapped.name}</strong> - Cerca del centro de déficit<br/>Cubre zona sin cobertura de ${loc.branch_name}<br/>Área sin cubrir: ${formatKm2(loc.gap_area_km2)}`
      );
    });
  }, [snappedCities]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function formatKm2(v: number): string {
  return `${Math.round(v).toLocaleString("es-AR")} km²`;
}
