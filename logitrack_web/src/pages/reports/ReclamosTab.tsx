interface ReclamosTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function ReclamosTab(_props: ReclamosTabProps) {
  return (
    <div className="p-8 text-center text-slate-500">
      <p className="text-sm">Reporte de reclamos — en construcción</p>
    </div>
  );
}
