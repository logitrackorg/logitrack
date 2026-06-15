import { DriverNav } from "./DriverNav";

interface DriverShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DriverShell({ title, subtitle: _subtitle, children }: DriverShellProps) {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex flex-col max-w-2xl mx-auto w-full">
      <DriverNav title={title} />
      <main className="flex-1 flex flex-col pb-[calc(env(safe-area-inset-bottom,0px)+80px)]">
        {children}
      </main>
    </div>
  );
}
