interface VolumenTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function VolumenTab(_props: VolumenTabProps) {
  return (
    <div className="p-8 text-center text-slate-500">
      <p className="text-sm">Volumen por ventana horaria — en construcción</p>
    </div>
  );
}
