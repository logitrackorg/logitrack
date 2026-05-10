export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const fmtDateTimeSeconds = (d: Date): string =>
  d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

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

// fmtRelative devuelve un string relativo en español ("hace 5 min", "hace 2 días",
// "en 3 h", "ahora"). Para fechas alejadas (>30 días) cae a fmtDate.
export const fmtRelative = (iso: string, now: Date = new Date()): string => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = t - now.getTime();
  const past = diffMs <= 0;
  const abs = Math.abs(diffMs);
  const sec = Math.round(abs / 1000);
  if (sec < 45) return past ? "hace instantes" : "en instantes";
  const min = Math.round(sec / 60);
  if (min < 60) return past ? `hace ${min} min` : `en ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return past ? `hace ${hr} h` : `en ${hr} h`;
  const day = Math.round(hr / 24);
  if (day < 30) return past ? `hace ${day} día${day === 1 ? "" : "s"}` : `en ${day} día${day === 1 ? "" : "s"}`;
  return fmtDate(iso);
};
