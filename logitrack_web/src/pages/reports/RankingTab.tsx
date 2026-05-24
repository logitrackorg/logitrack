interface RankingTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
}

export default function RankingTab(_props: RankingTabProps) {
  return (
    <div className="p-8 text-center text-slate-500">
      <p className="text-sm">Ranking de sucursales — en construcción</p>
    </div>
  );
}
