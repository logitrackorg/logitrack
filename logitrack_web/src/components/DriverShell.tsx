import { DriverNav } from "./DriverNav";

interface DriverShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DriverShell({ title, subtitle, children }: DriverShellProps) {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex flex-col max-w-3xl mx-auto w-full md:border-x md:border-[var(--border)] md:shadow-lg md:my-0">
      <DriverNav title={title} subtitle={subtitle} />
      <main className="flex-1 flex flex-col pb-[calc(env(safe-area-inset-bottom,0px)+16px)] px-4 md:px-6">
        {children}
      </main>
    </div>
  );
}
