import { Skeleton } from "../../utils/dashboard";

interface ResumenTabProps {
  dateFrom: string;
  dateTo: string;
  branchId: string;
  onRefresh?: () => void;
  lastRefresh?: Date | null;
  isRefreshing?: boolean;
}

export default function ResumenTab(_props: ResumenTabProps) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28" />
      <Skeleton className="h-56" />
      <Skeleton className="h-48" />
    </div>
  );
}
