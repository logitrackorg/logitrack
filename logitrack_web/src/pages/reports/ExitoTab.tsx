interface ExitoTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function ExitoTab(_props: ExitoTabProps) {
  return (
    <div className="p-8 text-center text-slate-500">
      <p className="text-sm">Tasa de éxito por sucursal — en construcción</p>
    </div>
  );
}
