// eslint-disable-next-line react-refresh/only-export-components
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function defaultRange() {
  const to = new Date(), from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: toDateInput(from), to: toDateInput(to) };
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded-lg ${className??""}`} />;
}
