interface RetornoTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function RetornoTab(_props: RetornoTabProps) {
  return (
    <div className="p-8 text-center text-slate-500">
      <p className="text-sm">Métricas de retorno — en construcción</p>
    </div>
  );
}
