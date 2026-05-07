export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// fmtMinutesAsTime convierte minutos desde medianoche a "HH:MM" (24h).
// Acepta valores >=24*60 (envuelve cíclicamente). Devuelve "—" para valores
// negativos (representan paradas unsequenced sin tiempo estimado).
export const fmtMinutesAsTime = (min: number): string => {
  if (!Number.isFinite(min) || min < 0) return "—";
  const total = Math.floor(min);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// fmtDuration devuelve duraciones en formato corto: "2h 15min" o "45min".
export const fmtDuration = (min: number): string => {
  if (!Number.isFinite(min) || min <= 0) return "—";
  const total = Math.round(min);
  if (total < 60) return `${total}min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
};
