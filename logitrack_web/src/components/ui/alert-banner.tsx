import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Info,
  CheckCircle,
  AlertTriangle,
  XCircle,
  X,
  type LucideIcon,
} from "lucide-react";

const variantIcons: Record<AlertVariant, LucideIcon> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  danger: XCircle,
};

const variantStyles: Record<AlertVariant, string> = {
  info: "bg-[var(--info-bg)] border-[var(--info-border)] text-[var(--info-text)]",
  success: "bg-[var(--ok-bg)] border-[var(--ok-border)] text-[var(--ok-text)]",
  warning:
    "bg-[var(--warn-bg)] border-[var(--warn-border)] text-[var(--warn-text)]",
  danger:
    "bg-[var(--danger-bg)] border-[var(--danger-border)] text-[var(--danger-text)]",
};

type AlertVariant = "info" | "success" | "warning" | "danger";

type AlertBannerProps = {
  /** Visual variant. Defaults to "info". */
  variant?: AlertVariant;
  /** Bold title above the description. */
  title?: string;
  /** Secondary descriptive text. Ignored if children are provided. */
  description?: string;
  /** Main body content. Overrides `description`. */
  children?: React.ReactNode;
  /** Custom icon element. Falls back to the variant's default lucide icon. */
  icon?: React.ReactNode;
  /** Slot for action controls (buttons, links) on the right side. */
  action?: React.ReactNode;
  /** When provided, renders a dismiss (X) button that calls this callback. */
  onDismiss?: () => void;
  className?: string;
};

/**
 * AlertBanner — coloured notification strip for status messages,
 * warnings and informational prompts across LogiTrack.
 *
 * Uses the platform's semantic CSS custom properties for theming
 * (light + dark) so it stays consistent with every other surface.
 */
export function AlertBanner({
  variant = "info",
  title,
  description,
  children,
  icon,
  action,
  onDismiss,
  className,
}: AlertBannerProps) {
  const Icon = variantIcons[variant];

  return (
    <div
      role="alert"
      className={cn(
        "relative flex items-start gap-2.5 rounded-xl border-l-4 px-4 py-3 transition-colors duration-200",
        variantStyles[variant],
        className,
      )}
    >
      {/* Left icon */}
      <span className="mt-px shrink-0" aria-hidden>
        {icon ?? <Icon className="size-[18px]" />}
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children ??
          (description && <p className="text-sm">{description}</p>)}
      </div>

      {/* Action slot */}
      {action && (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}

      {/* Dismiss button */}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar"
          className="shrink-0 cursor-pointer rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current focus-visible:outline-none"
        >
          <X className="size-[18px]" />
        </button>
      )}
    </div>
  );
}
