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
