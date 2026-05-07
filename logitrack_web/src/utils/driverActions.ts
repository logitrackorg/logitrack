import type { Shipment, TimeWindow } from "../api/shipments";

export const TIME_WINDOW_LABEL: Record<string, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
  flexible: "Flexible",
};

export const TIME_WINDOW_HOURS: Record<string, string> = {
  morning: "9–13h",
  afternoon: "14–18h",
  flexible: "Sin horario",
};

const TIME_WINDOW_RANK: Record<string, number> = {
  morning: 0,
  afternoon: 1,
  flexible: 2,
};

export function timeWindowTone(tw?: TimeWindow): {
  bg: string;
  text: string;
  border: string;
} {
  switch (tw) {
    case "morning":
      return { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" };
    case "afternoon":
      return { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" };
    default:
      return { bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-200" };
  }
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/\s+/g, "")}`;
}

// WhatsApp deeplink. AR-friendly: si el número viene como 54+area+nro
// (12 dígitos, sin el 9 de móvil), inserta "9" después de "54" para que
// wa.me lo entienda como móvil argentino.
export function waHref(phone: string): string {
  const d = phone.replace(/\D/g, "");
  let normalized = d;
  if (d.startsWith("54") && !d.startsWith("549")) {
    normalized = `549${d.slice(2)}`;
  }
  return `https://wa.me/${normalized}`;
}

export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Orden recomendado para una ruta de chofer:
// 1) ventana horaria primero (mañana antes que tarde antes que flexible)
// 2) priority_score DESC dentro de la misma ventana
// 3) created_at ASC como desempate estable
export function sortPendingShipments<T extends Shipment>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ta = TIME_WINDOW_RANK[a.time_window ?? "flexible"] ?? 2;
    const tb = TIME_WINDOW_RANK[b.time_window ?? "flexible"] ?? 2;
    if (ta !== tb) return ta - tb;
    const sa = a.priority_score ?? 0;
    const sb = b.priority_score ?? 0;
    if (sa !== sb) return sb - sa;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

// Para "Completados" mostramos los más recientes arriba; usamos delivered_at
// si existe, si no updated_at.
export function sortCompletedShipments<T extends Shipment>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const da = a.delivered_at ?? a.updated_at ?? "";
    const db = b.delivered_at ?? b.updated_at ?? "";
    return db.localeCompare(da);
  });
}

// Extrae el nombre y dirección del destinatario considerando correcciones.
export function recipientView(shipment: Shipment) {
  const cor = shipment.corrections ?? {};
  const street = cor.destination_street ?? shipment.recipient.address?.street ?? "";
  const city = cor.destination_city ?? shipment.recipient.address?.city ?? "";
  const province = cor.destination_province ?? shipment.recipient.address?.province ?? "";
  const postal = cor.destination_postal_code ?? shipment.recipient.address?.postal_code ?? "";
  return {
    name: cor.recipient_name ?? shipment.recipient.name,
    phone: cor.recipient_phone ?? shipment.recipient.phone,
    street,
    city,
    province,
    postal,
    fullAddress: [street, city, province].filter(Boolean).join(", "),
    specialInstructions: cor.special_instructions ?? shipment.special_instructions ?? "",
  };
}

export const FAILED_REASONS: { id: string; label: string }[] = [
  { id: "ausente", label: "Ausente" },
  { id: "direccion_incorrecta", label: "Dirección incorrecta" },
  { id: "rechazado", label: "Rechazado" },
  { id: "sin_acceso", label: "Sin acceso" },
  { id: "otro", label: "Otro" },
];
