import { DriverNav } from "./DriverNav";

interface DriverShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function DriverShell({ title, subtitle: _subtitle, children }: DriverShellProps) {
  return (
    <div className="min-h-screen md:flex md:justify-center">
      <div className="md:max-w-sm md:w-full md:min-h-screen md:bg-[var(--bg-page)] flex flex-col">
        <DriverNav title={title} />
        <main className="flex-1 pb-[calc(env(safe-area-inset-bottom,0px)+80px)]">
          {children}
        </main>
      </div>
    </div>
  );
}
