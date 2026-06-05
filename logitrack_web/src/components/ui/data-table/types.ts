/**
 * DataTable component — shared TypeScript API.
 *
 * # Survey findings (2025-06-04)
 *
 * Examined all 4 list pages to extract common patterns:
 *
 * ## ShipmentList.tsx (most complex — ~743 LOC)
 * - 10 columns: text, badges (StatusBadge, PriorityBadge, incident), code (tracking ID),
 *   composite inline (origin → destination), formatted dates (fmtDate), conditional draft weight
 * - Loading: skeleton table with 5 rows using <Skeleton>/<SkeletonLine>
 * - Empty state: rich <Card> with icon, contextual message, action buttons (clear filters, create new)
 * - Row click: navigates to /shipments/:trackingId; skips for <input> clicks
 * - Key field: tracking_id
 * - Conditional checkbox column for bulk actions (role-gated, external to table data)
 * - Sorts client-side by priority_score DESC (always, not via header)
 *
 * ## BranchList.tsx (simplest — ~576 LOC)
 * - 7–8 columns: text, status badge pill (inline), CapacityIndicator (progress bar),
 *   Action buttons (Edit/Estado), formatted dates (fmtDateTime)
 * - Columns react to: isMobile (hides some), canViewCapacity (shows capacity),
 *   isAdmin (shows actions column)
 * - Loading: simple "Cargando…" card
 * - Empty state: Filter icon + contextual message (no branches vs no search results)
 * - No row click — uses action buttons in cells
 * - Sortable headers with ↑/↓ indicators; client-side sort by name/city/province/status/updated_at
 * - Key field: b.id
 *
 * ## VehicleList.tsx (medium — ~777+ LOC)
 * - 8–9 columns: code (license plate), text, colored status badge with dot,
 *   color-coded available capacity, action button ("Cargar envíos")
 * - Mode-dependent columns: inter_sucursal shows destination branch + driver;
 *   ultima_milla shows driver only
 * - Loading: simple "Cargando…" card
 * - Empty state: Filter icon, generic message
 * - Row click: opens detail modal; skips for button/link clicks
 * - No sorting
 * - Key field: v.id
 *
 * ## AdminUsers.tsx (643 LOC)
 * - 7 columns: text (muted ID, bold name + email subtext, username),
 *   role badge pill, branch badge, status badge, Edit button
 * - Inactive rows: reduced opacity (0.65)
 * - Loading: simple "Cargando…" card
 * - Empty state: none (just empty <tbody>)
 * - No row click — uses hover highlight + per-row Edit button
 * - No sorting
 * - Key field: u.id
 * - Uses inline styles (predates Tailwind migration)
 *
 * ## Common patterns across all 4 pages
 * 1. Loading: all show a centered <Card>; ShipmentList has rich skeleton, others use text
 * 2. Empty state: 3 of 4 have icon + contextual message; ShipmentList/BranchList add action buttons
 * 3. Row click: 2 of 4 navigate/modals on row click; others use action buttons in cells
 * 4. Column rendering: always ReactNode (never plain string mapping); renders are arbitrary JSX
 * 5. Sorting: only BranchList has sortable column headers (client-side)
 * 6. Filtering: always client-side, filters are external to the table markup
 * 7. Key field: always a simple string identifier from row data
 * 8. Outer wrapping: <Card> + overflow-x-auto — but ad-hoc per page; DataTable
 *    should NOT own the Card (pages add count headers, bulk toolbars, etc.)
 *
 * ## Design decisions
 * - No built-in sorting: each page handles it differently (or not at all) — YAGNI.
 *   BranchList page will keep managing its own sortKey/sortAsc state.
 * - No built-in filtering: always external to the table — YAGNI.
 * - No pagination: no page uses it — YAGNI.
 * - No built-in row selection: only ShipmentList has checkboxes, and the state
 *   lives in the page component alongside bulk action logic — too specific.
 * - No tanstack-table or other third-party dependency: overkill for this scope.
 * - Columns are always { header, render } — no "accessor" field (string path to
 *   data property) because every single column in the codebase uses custom render
 *   logic (formatting, badges, conditional display).
 *
 * ## What DataTable provides (once implemented)
 * 1. Standard <table> markup with consistent styling
 * 2. Loading skeleton (lightweight fallback when no custom skeleton is provided)
 * 3. Empty state rendering (custom ReactNode)
 * 4. Row click with built-in stopPropagation for interactive children
 * 5. Consistent header/row/cell structure
 *
 * The component itself will live in index.tsx. This file only exports the types.
 */

import type { ReactNode } from "react";

/**
 * A single column definition in the table.
 *
 * `key` must match one of the column identifiers — used internally for stable
 * React keys and for potential future features (e.g. column visibility toggles).
 * It does NOT map to a data property; use `render` for all display logic.
 */
export interface DataTableColumn<T> {
  /** Stable identifier for this column (used as React key). */
  key: string;
  /** Column header text. Rendered inside a <th>. */
  header: string;
  /**
   * Render the cell content for a given row.
   *
   * @param row  - the row data object
   * @param index - 0-based position in the data array (for zebra striping, etc.)
   * @returns ReactNode — can be anything: plain text, badge component, icon, etc.
   */
  render: (row: T, index: number) => ReactNode;
  /**
   * Optional CSS class applied to <th> and <td> elements of this column.
   * Useful for width constraints (w-32), text alignment (text-right), etc.
   * When omitted, defaults to left-aligned with standard padding.
   */
  className?: string;
}

/**
 * Props for the DataTable component.
 *
 * Minimal but sufficient for all 4 surveyed pages:
 * ShipmentList, BranchList, VehicleList, AdminUsers.
 */
export interface DataTableProps<T extends Record<string, unknown>> {
  /** Column definitions. */
  columns: DataTableColumn<T>[];
  /** Row data to display. Empty array triggers the empty state. */
  data: T[];
  /**
   * Unique row key — either a property name or a function.
   *
   * Examples:
   * - `keyField="tracking_id"` (most pages)
   * - `keyField={(row) => row.id}` (when the property is complex)
   */
  keyField: keyof T | ((row: T) => string);
  /** Show loading skeleton while data is being fetched. */
  isLoading?: boolean;
  /**
   * Rich empty state displayed when `data` is empty and `isLoading` is false.
   * Pass any ReactNode — icon, message, action buttons, etc.
   * If omitted, a minimal "No results" fallback is shown.
   */
  emptyState?: ReactNode;
  /**
   * Called when a row is clicked.
   * DataTable automatically skips the callback when the click targets
   * an interactive child element (<button>, <a>, <input>, <select>, <textarea>).
   * Pages don't need to implement stopPropagation themselves.
   */
  onRowClick?: (row: T) => void;
  /**
   * Number of skeleton rows to render during loading.
   * Default: 5 (matches the ShipmentList pattern).
   */
  skeletonRowCount?: number;
}
