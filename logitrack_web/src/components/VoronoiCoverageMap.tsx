import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  type CoverageCell,
  GAP_STYLE,
  COVERED_STYLE,
} from "../api/coverage";

interface VoronoiCoverageMapProps {
  cells: CoverageCell[];
  /** branch_id resaltado (p.ej. fila seleccionada en el panel). */
  highlightedBranchId?: string | null;
  onSelectBranch?: (branchId: string) => void;
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
}: VoronoiCoverageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const cellsLayer = useRef<L.LayerGroup | null>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
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
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    cellsLayer.current = L.layerGroup().addTo(map);
    markersLayer.current = L.layerGroup().addTo(map);

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
        poly.on("click", () => onSelectRef.current?.(cell.branch_id));
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

  return <div ref={containerRef} className="h-full w-full" />;
}

function formatKm2(v: number): string {
  return `${Math.round(v).toLocaleString("es-AR")} km²`;
}
