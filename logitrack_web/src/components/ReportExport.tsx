import { useState } from "react";
import { Download } from "lucide-react";

interface ReportExportProps {
  onExportPDF: () => void;
  onExportExcel: () => void;
  loading?: boolean;
}

export function ReportExport({ onExportPDF, onExportExcel, loading }: ReportExportProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        aria-label="Exportar dashboard"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-slate-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors cursor-pointer shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="w-3.5 h-3.5" />
        Exportar
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden origin-top-right transition-all duration-150">
            <button
              onClick={() => { setOpen(false); onExportPDF(); }}
              className="w-full px-4 py-2.5 text-sm text-slate-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-gray-700 hover:text-blue-700 dark:hover:text-blue-300 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/50 focus-visible:bg-blue-50"
              aria-label="Exportar como PDF"
            >
              Descargar como PDF
            </button>
            <button
              onClick={() => { setOpen(false); onExportExcel(); }}
              className="w-full px-4 py-2.5 text-sm text-slate-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-gray-700 hover:text-blue-700 dark:hover:text-blue-300 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]/50 focus-visible:bg-blue-50"
              aria-label="Exportar como Excel"
            >
              Descargar como Excel (CSV)
            </button>
          </div>
        </>
      )}
    </div>
  );
}