import type { ClaimType } from "../api/publicTracking";
import type { PublicClaimFormValues } from "../components/PublicClaimFormFields";

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
  return subtypes.includes("product_damaged");
}

export function isAllowedClaimEvidenceFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".pdf") ||
    file.type === "text/plain" ||
    file.type === "application/pdf" ||
    file.type.startsWith("image/")
  );
}

export const emptyClaimFormValues: PublicClaimFormValues = {
  createdBy: "",
  dni: "",
  category: "",
  damageSubtypes: [],
  deliverySubtype: "",
  staffDescription: "",
  evidence: null,
};

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

  const normalizedName = createdBy.trim().replace(/\s+/g, " ");
  if (!normalizedName) {
    return "Ingresá tu nombre y apellido. No es posible crear un reclamo sin esos datos.";
  }
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'\s]+$/.test(normalizedName)) {
    return "El nombre y apellido solo puede contener letras y espacios.";
  }
  if (normalizedName.split(" ").length < 2) {
    return "Ingresá tu nombre y apellido completos.";
  }
  const normalizedDni = dni.trim();
  if (!normalizedDni) {
    return "Ingresá tu DNI. No es posible crear un reclamo sin esos datos.";
  }
  if (!/^[0-9]{7,8}$/.test(normalizedDni)) {
    return "El DNI debe tener 7 u 8 dígitos.";
  }
  if (!category) return "Seleccioná qué problema tuviste con el envío.";

  if (category === "incomplete_damage") {
    if (damageSubtypes.length === 0) return "Seleccioná al menos un subtipo.";
    if (damageSubtypeRequiresEvidence(damageSubtypes) && !evidence) {
      return "Adjuntá un archivo TXT, PDF o una imagen pequeña como evidencia (obligatorio para producto dañado).";
    }
    if (evidence && !isAllowedClaimEvidenceFile(evidence)) {
      return "La evidencia debe ser un archivo TXT, PDF o una imagen pequeña.";
    }
    if (evidence && evidence.size > 1024 * 1024) {
      return "La evidencia no puede superar 1 MB.";
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
