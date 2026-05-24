import { Calendar, ChevronDown, MapPin, ArrowRight, RefreshCw } from "lucide-react";
import type { Branch } from "../api/branches";
import { ReportExport } from "./ReportExport";

const inputClass =
  "h-9 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 focus:border-[#2563eb] transition-all";

const selectClass = inputClass + " appearance-none cursor-pointer pr-8";

interface ReportFiltersProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  selectedBranch: string;
  onBranchChange: (value: string) => void;
  branches: Branch[];
  isSupervisor: boolean;
  showExport?: boolean;
  onExportPDF?: () => void;
  onExportExcel?: () => void;
  exporting?: boolean;
  showAutoRefresh?: boolean;
  lastRefresh?: Date | null;
  isRefreshing?: boolean;
}

export function ReportFilters({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  selectedBranch,
  onBranchChange,
  branches,
  isSupervisor,
  showExport,
  onExportPDF,
  onExportExcel,
  exporting,
  showAutoRefresh,
  lastRefresh,
  isRefreshing,
}: ReportFiltersProps) {
  const branchesByProvince = branches.reduce<Record<string, Branch[]>>(
    (acc, b) => {
      const prov = b.address.province;
      if (!acc[prov]) acc[prov] = [];
      acc[prov].push(b);
      return acc;
    },
    {}
  );
  const sortedProvinces = Object.keys(branchesByProvince).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const prov of sortedProvinces) {
    branchesByProvince[prov].sort((a, b) => a.name.localeCompare(b.name));
  }

  const supervisorBranch = isSupervisor ? selectedBranch : "";
  const branchLabel = (() => {
    if (isSupervisor) {
      const b = branches.find((br) => br.id === supervisorBranch);
      return b ? b.name : supervisorBranch || "Tu sucursal";
    }
    if (!selectedBranch) return "Todas las sucursales";
    const b = branches.find((br) => br.id === selectedBranch);
    return b ? b.name : selectedBranch;
  })();

  return (
    <>
      {isSupervisor ? (
        <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-blue-50 border border-blue-200 text-sm font-semibold text-[#1e3a5f] shadow-sm">
          <MapPin className="w-3.5 h-3.5" />
          {branchLabel}
        </span>
      ) : (
        <div className="relative">
          <select
            value={selectedBranch}
            onChange={(e) => onBranchChange(e.target.value)}
            className={selectClass}
            aria-label="Filtrar por sucursal"
          >
            <option value="">Todas las sucursales</option>
            {sortedProvinces.map((prov) => (
              <optgroup key={prov} label={prov}>
                {branchesByProvince[prov].map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.address.city}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="date"
          value={dateFrom}
          max={dateTo}
          onChange={(e) => onDateFromChange(e.target.value)}
          className={inputClass + " w-[130px]"}
          aria-label="Fecha desde"
        />
        <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />
        <input
          type="date"
          value={dateTo}
          min={dateFrom}
          onChange={(e) => onDateToChange(e.target.value)}
          className={inputClass + " w-[130px]"}
          aria-label="Fecha hasta"
        />
      </div>
      {showExport && (
        <ReportExport
          onExportPDF={onExportPDF ?? (() => {})}
          onExportExcel={onExportExcel ?? (() => {})}
          loading={exporting}
        />
      )}
      {showAutoRefresh && lastRefresh && (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 ml-1 whitespace-nowrap">
          {isRefreshing && <RefreshCw className="w-3 h-3 animate-spin" />}
          Última actualización:{" "}
          {lastRefresh.toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </>
  );
}
