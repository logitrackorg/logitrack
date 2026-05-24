interface FacturacionTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function FacturacionTab(_props: FacturacionTabProps) {
  return (
    <div className="p-8 text-center text-slate-500">
      <p className="text-sm">Reporte de facturación — en construcción</p>
    </div>
  );
}
