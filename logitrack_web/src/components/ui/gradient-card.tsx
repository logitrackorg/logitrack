import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * GradientCard — high-emphasis surface with corporate gradient.
 * Use to draw attention to a single key piece of information (price, key stat, alert).
 * Mirrors the styling introduced by the price card on ShipmentDetail.
 */
type GradientCardProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: "brand" | "emerald" | "amber" | "rose";
};

const TONES: Record<NonNullable<GradientCardProps["tone"]>, string> = {
  brand: "from-blue-600 to-blue-800 shadow-[0_4px_12px_rgba(37,99,235,0.2)]",
  emerald: "from-emerald-700 to-emerald-500 shadow-[0_4px_12px_rgba(5,150,105,0.18)]",
  amber: "from-orange-500 to-orange-700 shadow-[0_4px_12px_rgba(249,115,22,0.2)]",
  rose: "from-rose-700 to-rose-500 shadow-[0_4px_12px_rgba(225,29,72,0.18)]",
};

export function GradientCard({ className, tone = "brand", ...props }: GradientCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl bg-gradient-to-br p-5 text-white cursor-pointer hover:shadow-lg transition-shadow duration-200",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function GradientCardLabel({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wider text-white/70",
        className,
      )}
      {...props}
    />
  );
}

export function GradientCardValue({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "text-2xl font-extrabold tabular-nums tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Small badge-like icon container for use inside GradientCard headers.
 */
export function GradientCardIcon({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center shrink-0",
        className,
      )}
      {...props}
    />
  );
}
