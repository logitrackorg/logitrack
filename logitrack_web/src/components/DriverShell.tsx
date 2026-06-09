import { DriverNav } from "./DriverNav";

interface DriverShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DriverShell({ title, subtitle: _subtitle, children }: DriverShellProps) {
  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      <DriverNav title={title} />
      <main className="pb-[calc(env(safe-area-inset-bottom,0px)+80px)]">
        {children}
      </main>
    </div>
  );
}
