import domtoimage from "dom-to-image-more";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { toast } from "../utils/toast";

export async function exportToPDF(ref: React.RefObject<HTMLDivElement | null>, filename: string) {
  try {
    await new Promise((r) => setTimeout(r, 100));
    const el = ref.current;
    if (!el) return;
    toast.success("Generando PDF…");
    const imgData = await domtoimage.toPng(el, { quality: 1, bgcolor: "#ffffff" });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = imgData;
    });
    const pdf = new jsPDF({ orientation: "l", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const pageAspect = pageW / pageH;
    let imgW: number, imgH: number;
    if (imgAspect > pageAspect) {
      imgW = pageW;
      imgH = pageW / imgAspect;
    } else {
      imgH = pageH;
      imgW = pageH * imgAspect;
    }
    pdf.addImage(imgData, "PNG", 0, 0, imgW, imgH);
    pdf.save(filename);
  } catch (e) {
    console.error("Error exporting PDF:", e);
    toast.error("Error al exportar PDF. Revisá la consola para más detalles.");
  }
}

export interface BranchSuggestionPdfMeta {
  scopeLabel: string;
  modeLabel: string;
  areaKm2: number;
  radiusKm: number;
  generatedAt: Date;
}

export interface BranchSuggestionPdfRow {
  rank: number;
  cityName: string;
  score: number;
  population?: number;
  density?: number;
  netAreaKm2?: number;
  affectedBranches?: string[];
  flags?: string[];
}

/**
 * Genera un PDF con las recomendaciones de nuevas sucursales del simulador de
 * Cobertura territorial: una captura opcional del mapa centrado en las
 * recomendaciones, seguida de una entrada de texto por ciudad recomendada.
 * Estructurado y paginado.
 *
 * mapImageDataUrl: PNG (data URL) del mapa ya centrado; si es undefined o falla
 * la captura, el reporte se genera igual, solo sin la imagen.
 */
export async function exportBranchSuggestionsToPDF(
  meta: BranchSuggestionPdfMeta,
  rows: BranchSuggestionPdfRow[],
  filename: string,
  mapImageDataUrl?: string,
) {
  try {
    toast.success("Generando PDF…");
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginX = 15;
    const contentW = pageW - marginX * 2;
    let y = 18;

    const fmtInt = (n: number) => Math.round(n).toLocaleString("es-AR");
    const ensureSpace = (needed: number) => {
      if (y + needed > pageH - 15) {
        pdf.addPage();
        y = 18;
      }
    };

    // Título.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Recomendaciones de nuevas sucursales", marginX, y);
    y += 7;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(110);
    pdf.text("Cobertura territorial", marginX, y);
    y += 8;

    // Metadatos del diagnóstico.
    pdf.setFontSize(9);
    pdf.setTextColor(80);
    const metaLines = [
      `Zona de análisis: ${meta.scopeLabel}`,
      `Modo de diagnóstico: ${meta.modeLabel}`,
      `Radio de cobertura simulado: ${meta.areaKm2.toLocaleString("es-AR")} km² (radio aprox. ${meta.radiusKm.toFixed(1)} km)`,
      `Recomendaciones: ${rows.length}`,
      `Generado: ${meta.generatedAt.toLocaleString("es-AR")}`,
    ];
    for (const line of metaLines) {
      pdf.text(line, marginX, y);
      y += 5;
    }
    y += 2;
    pdf.setDrawColor(200);
    pdf.line(marginX, y, pageW - marginX, y);
    y += 7;
    pdf.setTextColor(0);

    // Captura del mapa centrado en las recomendaciones (si está disponible).
    if (mapImageDataUrl) {
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = mapImageDataUrl;
        });
        const aspect = img.naturalWidth / img.naturalHeight || 1.6;
        let imgW = contentW;
        let imgH = imgW / aspect;
        const maxH = 110;
        if (imgH > maxH) {
          imgH = maxH;
          imgW = imgH * aspect;
        }
        const imgX = marginX + (contentW - imgW) / 2;
        pdf.addImage(mapImageDataUrl, "PNG", imgX, y, imgW, imgH);
        y += imgH + 6;
        pdf.setDrawColor(200);
        pdf.line(marginX, y, pageW - marginX, y);
        y += 7;
      } catch {
        // Si la imagen no carga, seguimos con el reporte de texto.
      }
    }

    if (rows.length === 0) {
      pdf.setFontSize(11);
      pdf.setTextColor(120);
      pdf.text("No hay recomendaciones aterrizadas en ciudades reales para exportar.", marginX, y);
      pdf.save(filename);
      return;
    }

    // Una entrada por recomendación.
    for (const r of rows) {
      ensureSpace(16);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.text(`${r.rank}. ${r.cityName}`, marginX, y);
      pdf.text(`${r.score}/100`, pageW - marginX, y, { align: "right" });
      y += 6;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      pdf.setTextColor(60);
      const detailLines: string[] = [];
      if (r.population != null && r.population > 0) detailLines.push(`Población estimada: ${fmtInt(r.population)} hab.`);
      if (r.density != null && r.density > 0) detailLines.push(`Densidad de nueva cobertura: ${r.density >= 1 ? fmtInt(r.density) : "< 1"} hab./km²`);
      if (r.netAreaKm2 != null && r.netAreaKm2 > 0) detailLines.push(`Cobertura neta aportada: ~${fmtInt(r.netAreaKm2)} km²`);
      for (const d of detailLines) {
        ensureSpace(5);
        pdf.text(d, marginX + 2, y);
        y += 5;
      }

      if (r.affectedBranches && r.affectedBranches.length > 0) {
        const wrapped = pdf.splitTextToSize(`Descomprime las zonas de: ${r.affectedBranches.join(", ")}.`, contentW - 2);
        ensureSpace(wrapped.length * 5);
        pdf.text(wrapped, marginX + 2, y);
        y += wrapped.length * 5;
      }

      if (r.flags && r.flags.length > 0) {
        const wrapped = pdf.splitTextToSize(r.flags.join(" · "), contentW - 2);
        ensureSpace(wrapped.length * 5);
        pdf.setTextColor(150, 60, 60);
        pdf.text(wrapped, marginX + 2, y);
        y += wrapped.length * 5;
      }

      pdf.setTextColor(0);
      y += 4;
    }

    pdf.save(filename);
  } catch (e) {
    console.error("Error exporting PDF:", e);
    toast.error("Error al exportar PDF. Revisá la consola para más detalles.");
  }
}

export function exportToExcel(
  sheets: { name: string; data: Record<string, unknown>[] }[],
  filename: string,
) {
  try {
    toast.success("Generando Excel…");
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.json_to_sheet(s.data);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    XLSX.writeFile(wb, filename);
  } catch (e) {
    console.error("Error exporting Excel:", e);
    toast.error("Error al exportar Excel. Revisá la consola para más detalles.");
  }
}
