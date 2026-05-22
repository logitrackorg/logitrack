import type { ClaimType } from "../api/publicTracking";

export type ClaimMainCategory = "incomplete_damage" | "delivery_problem" | "staff_conduct";

export type DamageSubtype = "product_damaged" | "missing_products" | "packaging_damaged";

export type DeliverySubtype = "marked_delivered" | "wrong_person" | "wrong_address";

export const CLAIM_MAIN_OPTIONS: { value: ClaimMainCategory; label: string }[] = [
  { value: "incomplete_damage", label: "Entrega incompleta o dañada" },
  { value: "delivery_problem", label: "Problema con la entrega" },
  { value: "staff_conduct", label: "Atención o conducta del personal" },
];

export const DAMAGE_SUBTYPE_OPTIONS: { value: DamageSubtype; label: string }[] = [
  { value: "product_damaged", label: "Producto dañado" },
  { value: "missing_products", label: "Faltan productos" },
  { value: "packaging_damaged", label: "Embalaje dañado" },
];

export const DELIVERY_SUBTYPE_OPTIONS: { value: DeliverySubtype; label: string }[] = [
  { value: "marked_delivered", label: "Figuró entregado pero no lo recibí" },
  { value: "wrong_person", label: "Entregado a otra persona" },
  { value: "wrong_address", label: "Dirección incorrecta" },
];

export function damageSubtypeRequiresEvidence(subtypes: DamageSubtype[]): boolean {
  return subtypes.some((s) => s === "product_damaged" || s === "packaging_damaged");
}

export function resolveClaimType(
  category: ClaimMainCategory,
  damageSubtypes: DamageSubtype[],
  deliverySubtype: DeliverySubtype | "",
): ClaimType {
  if (category === "staff_conduct") return "bad_treatment";
  if (category === "delivery_problem") {
    if (deliverySubtype === "wrong_address") return "wrong_data";
    return "not_delivered";
  }
  const onlyMissing =
    damageSubtypes.includes("missing_products") &&
    !damageSubtypes.includes("product_damaged") &&
    !damageSubtypes.includes("packaging_damaged");
  return onlyMissing ? "missing" : "damage";
}

export function buildClaimDescription(input: {
  category: ClaimMainCategory;
  damageSubtypes: DamageSubtype[];
  deliverySubtype: DeliverySubtype | "";
  staffDescription: string;
  evidenceName?: string;
}): string {
  const { category, damageSubtypes, deliverySubtype, staffDescription, evidenceName } = input;

  if (category === "staff_conduct") {
    return staffDescription.trim();
  }

  if (category === "delivery_problem") {
    const label = DELIVERY_SUBTYPE_OPTIONS.find((o) => o.value === deliverySubtype)?.label ?? deliverySubtype;
    let text = `Problema con la entrega: ${label}.`;
    if (evidenceName) text += ` Evidencia adjunta: ${evidenceName}.`;
    return text;
  }

  const labels = damageSubtypes
    .map((s) => DAMAGE_SUBTYPE_OPTIONS.find((o) => o.value === s)?.label)
    .filter(Boolean);
  let text = `Entrega incompleta o dañada: ${labels.join(", ")}.`;
  if (evidenceName) text += ` Evidencia adjunta: ${evidenceName}.`;
  return text;
}

export function validatePublicClaimForm(input: {
  category: ClaimMainCategory | "";
  damageSubtypes: DamageSubtype[];
  deliverySubtype: DeliverySubtype | "";
  staffDescription: string;
  evidence: File | null;
  createdBy: string;
  dni: string;
}): string | null {
  const { category, damageSubtypes, deliverySubtype, staffDescription, evidence, createdBy, dni } = input;

  if (!createdBy.trim()) return "Indicá tu nombre para continuar.";
  if (!dni.trim()) return "El DNI es requerido.";
  if (!/^[0-9]+$/.test(dni.trim()) || dni.trim().length < 7) {
    return "El DNI debe contener solo dígitos y tener al menos 7 números.";
  }
  if (!category) return "Seleccioná qué problema tuviste con el envío.";

  if (category === "incomplete_damage") {
    if (damageSubtypes.length === 0) return "Seleccioná al menos un subtipo.";
    if (damageSubtypeRequiresEvidence(damageSubtypes) && !evidence) {
      return "Adjuntá una imagen como evidencia (obligatorio para daños).";
    }
    if (evidence && !evidence.type.startsWith("image/")) {
      return "La evidencia para daños debe ser una imagen.";
    }
    const desc = buildClaimDescription({
      category,
      damageSubtypes,
      deliverySubtype: "",
      staffDescription: "",
      evidenceName: evidence?.name,
    });
    if (desc.length < 10 || desc.length > 400) return "No se pudo armar la descripción del reclamo.";
    return null;
  }

  if (category === "delivery_problem") {
    if (!deliverySubtype) return "Seleccioná qué problema tuviste con la entrega.";
    const desc = buildClaimDescription({
      category,
      damageSubtypes: [],
      deliverySubtype,
      staffDescription: "",
      evidenceName: evidence?.name,
    });
    if (desc.length < 10 || desc.length > 400) return "No se pudo armar la descripción del reclamo.";
    return null;
  }

  if (!staffDescription.trim()) return "Describí lo ocurrido.";
  if (staffDescription.trim().length < 10 || staffDescription.trim().length > 400) {
    return "La descripción debe tener entre 10 y 400 caracteres.";
  }
  return null;
}
