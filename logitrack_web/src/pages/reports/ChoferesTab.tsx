interface ChoferesTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function ChoferesTab(_props: ChoferesTabProps) {
  return (
    <div className="p-8 text-center text-slate-500">
      <p className="text-sm">Reporte de choferes — en construcción</p>
    </div>
  );
}
