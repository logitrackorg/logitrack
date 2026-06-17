import type { Award } from "../api/users";
import { categoryLabel } from "../api/employeeOfMonth";

function formatPeriod(isoDate: string): string {
  // Extraemos año y mes del string ISO para evitar el desfase UTC→ART.
  const [y, m] = isoDate.substring(0, 7).split("-").map(Number);
  return new Date(y, m - 1).toLocaleDateString("es-AR", { year: "numeric", month: "long" });
}

interface Props {
  award: Award;
}

export function AwardBadge({ award }: Props) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 20,
        background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
        color: "#78350f",
        fontWeight: 600,
        fontSize: 13,
        boxShadow: "0 1px 3px rgba(0,0,0,.15)",
        border: "1px solid #fde68a",
      }}
      title={`Score: ${award.score.toFixed(1)}`}
    >
      <span role="img" aria-label="trofeo">🏆</span>
      {categoryLabel(award.category)} — {formatPeriod(award.period)}
    </span>
  );
}
