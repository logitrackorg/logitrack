import React from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon = <Package className="size-16 text-[var(--text-muted)]" />,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4",
      )}
    >
      <div className="text-[var(--text-muted)]">{icon}</div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] dark:text-white mt-4 text-center">
        {title}
      </h3>
      <p className="text-sm text-[var(--text-muted)] dark:text-slate-400 mt-2 text-center max-w-md">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
