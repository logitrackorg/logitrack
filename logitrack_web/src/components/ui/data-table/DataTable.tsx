import type { MouseEvent } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state/EmptyState";
import type { DataTableProps } from "./types";

/**
 * Names of interactive HTML elements whose clicks should NOT
 * trigger the row-level onRowClick handler.
 */
const INTERACTIVE_TAGS = new Set([
  "BUTTON",
  "A",
  "INPUT",
  "SELECT",
  "TEXTAREA",
]);

/**
 * Shared DataTable component.
 *
 * Renders a responsive table with column headers, loading skeleton,
 * empty state fallback, and row click support.
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField,
  isLoading = false,
  skeletonRowCount = 5,
  emptyState,
  onRowClick,
}: DataTableProps<T>) {
  // ---- Helpers -----------------------------------------------------------

  const resolveKey = (row: T): string =>
    typeof keyField === "function" ? keyField(row) : String(row[keyField] ?? "");

  /**
   * Fire onRowClick only when the user didn't click an interactive child
   * element (button, link, input, etc.).
   */
  const handleRowClick =
    onRowClick
      ? (row: T) => (e: MouseEvent<HTMLTableRowElement>) => {
          const target = e.target as HTMLElement;
          if (INTERACTIVE_TAGS.has(target.tagName)) return;
          onRowClick(row);
        }
      : undefined;

  const colSpan = columns.length;

  // ---- Loading skeleton --------------------------------------------------

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={
                    "px-4 py-3 text-xs font-semibold uppercase tracking-wider text-left " +
                    "text-slate-600 dark:text-slate-400 " +
                    (col.className ?? "")
                  }
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: skeletonRowCount }, (_, i) => (
              <tr key={`skeleton-${i}`}>
                <td colSpan={colSpan} className="px-4 py-2">
                  <Skeleton className="h-12 w-full" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ---- Empty state -------------------------------------------------------

  if (data.length === 0) {
    if (emptyState) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={
                      "px-4 py-3 text-xs font-semibold uppercase tracking-wider text-left " +
                      "text-slate-600 dark:text-slate-400 " +
                      (col.className ?? "")
                    }
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
          {emptyState}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={
                    "px-4 py-3 text-xs font-semibold uppercase tracking-wider text-left " +
                    "text-slate-600 dark:text-slate-400 " +
                    (col.className ?? "")
                  }
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={colSpan}>
                <EmptyState
                  title="Sin resultados"
                  description="No se encontraron datos para mostrar."
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // ---- Data --------------------------------------------------------------

  const interactive = Boolean(handleRowClick);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {/* ---- Header ---- */}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={
                  "px-4 py-3 text-xs font-semibold uppercase tracking-wider text-left " +
                  "text-slate-600 dark:text-slate-400 " +
                  (col.className ?? "")
                }
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        {/* ---- Body ---- */}
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={resolveKey(row)}
              className={
                interactive
                  ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                  : ""
              }
              onClick={handleRowClick?.(row)}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={"px-4 py-3 " + (col.className ?? "")}
                >
                  {col.render(row, idx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
