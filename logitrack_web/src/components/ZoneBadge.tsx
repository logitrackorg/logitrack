import type { BranchZoneType } from "../api/shipments";

const config: Record<BranchZoneType, { label: string; bg: string }> = {
  entrada:    { label: "Entrada", bg: "#3b82f6" },
  salida:     { label: "En depósito para despachar",  bg: "#10b981" },
  revision:   { label: "Revisión", bg: "#f59e0b" },
  devolucion: { label: "Listo para devolución", bg: "#8b5cf6" },
};

export function ZoneBadge({ zone }: { zone?: BranchZoneType | null }) {
  if (!zone) return null;
  const cfg = config[zone] ?? { label: zone, bg: "var(--text-muted)" };
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 10px",
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: "nowrap",
      background: cfg.bg,
      color: "#fff",
    }}>
      {cfg.label}
    </span>
  );
}
