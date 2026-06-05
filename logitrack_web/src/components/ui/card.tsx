import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — surface for grouping related content.
 * Default style: white background, subtle border, soft shadow.
 * Use `variant="muted"` for a softer gray-50 surface (default for sidebar widgets).
 */
type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "muted";
};

export function Card({ className, variant = "default", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border transition-shadow duration-200",
        variant === "default"
          ? "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md cursor-pointer"
          : "bg-slate-50 dark:bg-gray-800/50 border-slate-200 dark:border-gray-700",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("text-base font-semibold text-slate-900 dark:text-white tracking-tight", className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-slate-500 dark:text-slate-400", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2 px-5 py-3 border-t border-slate-100 dark:border-gray-700", className)}
      {...props}
    />
  );
}
