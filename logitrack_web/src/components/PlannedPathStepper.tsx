import { branchLabelById, type Branch } from "../api/branches";

interface Props {
  path: string[];
  hopIndex: number;
  branches: Branch[];
}

// PlannedPathStepper muestra la trayectoria planificada del envío.
// Los hubs anteriores al hopIndex aparecen completados (verde),
// el actual se resalta en azul, los siguientes están pendientes (gris).
export function PlannedPathStepper({ path, hopIndex, branches }: Props) {
  return (
    <div style={{
      background: "var(--bg-page)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "12px 16px",
      marginBottom: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: "var(--text-secondary)",
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
      }}>
        Trayectoria planificada
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0 }}>
        {path.map((branchId, i) => {
          const label = branchLabelById(branchId, branches);
          const isDone = i < hopIndex;
          const isCurrent = i === hopIndex;
          return (
            <div key={branchId} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: isDone ? "var(--ok)" : isCurrent ? "var(--brand)" : "var(--text-faint)",
                  border: isCurrent ? "2px solid var(--brand)" : "none",
                }} />
                <span style={{
                  fontSize: 11, whiteSpace: "nowrap",
                  color: isDone ? "var(--ok)" : isCurrent ? "var(--brand)" : "var(--text-muted)",
                  fontWeight: isCurrent ? 700 : 400,
                }}>
                  {label}
                </span>
              </div>
              {i < path.length - 1 && (
                <div style={{
                  width: 28, height: 2, marginBottom: 14, flexShrink: 0,
                  background: i < hopIndex ? "var(--ok-border)" : "var(--border)",
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
