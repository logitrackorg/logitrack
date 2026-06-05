import * as React from "react";
import { cn } from "@/lib/utils";

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  helperText?: string;
  className?: string;
  children: React.ReactNode;
}

export function FormField({
  label,
  htmlFor,
  error,
  required = false,
  helperText,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          "text-sm font-semibold text-[var(--text-primary)]",
          htmlFor && "cursor-pointer",
        )}
      >
        {label}
        {required && (
          <span className="ml-0.5 text-red-500 dark:text-red-400" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p
          className="text-xs font-medium text-red-600 dark:text-red-400 leading-tight"
          role="alert"
        >
          {error}
        </p>
      )}
      {helperText && !error && (
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {helperText}
        </p>
      )}
    </div>
  );
}
