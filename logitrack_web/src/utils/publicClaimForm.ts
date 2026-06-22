import type { ClaimType } from "../api/publicTracking";
import type { PublicClaimFormValues } from "../components/PublicClaimFormFields";
import {
  CLAIM_CATEGORIES,
  DAMAGE_SUBTYPE_OPTIONS,
  DELIVERY_SUBTYPE_OPTIONS,
  classifyClaimType,
  damageRequiresEvidence,
  isAllowedClaimEvidenceFile,
  MAX_CLAIM_EVIDENCE_BYTES,
  type ClaimCategory,
  type DamageSubtype,
  type DeliverySubtype,
} from "./claimDecisionTree";

// publicClaimForm.ts es la fachada del formulario público: arma descripción,
// valida campos y reexporta del árbol de decisión compartido los helpers que
// usa el form. No define el árbol — ese vive en claimDecisionTree.ts y lo
// comparte con el chatbot.

export type ClaimMainCategory = ClaimCategory;

export {
  DAMAGE_SUBTYPE_OPTIONS,
  DELIVERY_SUBTYPE_OPTIONS,
  isAllowedClaimEvidenceFile,
  MAX_CLAIM_EVIDENCE_BYTES,
};
export type { DamageSubtype, DeliverySubtype };

// CLAIM_MAIN_OPTIONS deriva del árbol compartido (sin "incomplete_damage" no
// es "Entrega dañada" porque ahora missing es su propia categoría).
export const CLAIM_MAIN_OPTIONS: { value: ClaimCategory; label: string }[] =
  CLAIM_CATEGORIES.map((c) => ({ value: c.value, label: c.label }));

export function damageSubtypeRequiresEvidence(subtypes: DamageSubtype[]): boolean {
  return damageRequiresEvidence(subtypes);
}

export const emptyClaimFormValues: PublicClaimFormValues = {
  createdBy: "",
  dni: "",
  category: "",
  damageSubtypes: [],
  deliverySubtype: "",
  deliveryDescription: "",
  staffDescription: "",
  delayDescription: "",
  otherDescription: "",
  evidence: null,
};

export function resolveClaimType(
  category: ClaimCategory,
  damageSubtypes: DamageSubtype[],
  deliverySubtype: DeliverySubtype | "",
): ClaimType {
  return classifyClaimType(category, damageSubtypes, deliverySubtype);
}

export interface BuildDescriptionInput {
  category: ClaimCategory;
  damageSubtypes: DamageSubtype[];
  deliverySubtype: DeliverySubtype | "";
  deliveryDescription: string;
  staffDescription: string;
  delayDescription: string;
  otherDescription: string;
  evidenceName?: string;
}

export function buildClaimDescription(input: BuildDescriptionInput): string {
  const { category } = input;
  switch (category) {
    case "staff_conduct":
      return input.staffDescription.trim();
    case "delivery_delay":
      return input.delayDescription.trim();
    case "other":
      return input.otherDescription.trim();
    case "delivery_problem": {
      const label =
        DELIVERY_SUBTYPE_OPTIONS.find((o) => o.value === input.deliverySubtype)?.label ??
        input.deliverySubtype;
      let text = `Problema con la entrega: ${label}.`;
      const comment = input.deliveryDescription.trim();
      if (comment) text += ` ${comment}`;
      if (input.evidenceName) text += ` Evidencia adjunta: ${input.evidenceName}.`;
      return text;
    }
    case "incomplete_damage": {
      const labels = input.damageSubtypes
        .map((s) => DAMAGE_SUBTYPE_OPTIONS.find((o) => o.value === s)?.label)
        .filter(Boolean);
      let text = `Daño / Faltante: ${labels.join(", ")}.`;
      if (input.evidenceName) text += ` Evidencia adjunta: ${input.evidenceName}.`;
      return text;
    }
  }
}

export interface ValidatePublicClaimInput {
  category: ClaimCategory | "";
  damageSubtypes: DamageSubtype[];
  deliverySubtype: DeliverySubtype | "";
  deliveryDescription: string;
  staffDescription: string;
  delayDescription: string;
  otherDescription: string;
  evidence: File | null;
  createdBy: string;
  dni: string;
}

export function validatePublicClaimForm(input: ValidatePublicClaimInput): string | null {
  const {
    category,
    damageSubtypes,
    deliverySubtype,
    deliveryDescription,
    staffDescription,
    delayDescription,
    otherDescription,
    evidence,
    createdBy,
    dni,
  } = input;

  // El nombre debe coincidir exactamente con el del remitente o destinatario
  // del envío — el backend hace el matching real (matchesCustomer). Acá solo
  // chequeamos que no esté vacío; no exigimos dos palabras porque una razón
  // social (ej. "MercadoLocal") es un reclamante válido.
  const normalizedName = createdBy.trim().replace(/\s+/g, " ");
  if (!normalizedName) {
    return "Ingresá tu nombre tal cual figura en el envío. No es posible crear un reclamo sin esos datos.";
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
    if (evidence && evidence.size > MAX_CLAIM_EVIDENCE_BYTES) {
      return "La evidencia no puede superar 1 MB.";
    }
    const desc = buildClaimDescription({
      category,
      damageSubtypes,
      deliverySubtype: "",
      deliveryDescription: "",
      staffDescription: "",
      delayDescription: "",
      otherDescription: "",
      evidenceName: evidence?.name,
    });
    if (!desc || desc.length < 10 || desc.length > 400) {
      return "No se pudo armar la descripción del reclamo.";
    }
    return null;
  }

  if (category === "delivery_problem") {
    if (!deliverySubtype) return "Seleccioná qué problema tuviste con la entrega.";
    if (!deliveryDescription.trim()) return "Contanos qué pasó con la entrega.";
    if (deliveryDescription.trim().length < 10 || deliveryDescription.trim().length > 400) {
      return "La descripción debe tener entre 10 y 400 caracteres.";
    }
    const desc = buildClaimDescription({
      category,
      damageSubtypes: [],
      deliverySubtype,
      deliveryDescription,
      staffDescription: "",
      delayDescription: "",
      otherDescription: "",
      evidenceName: evidence?.name,
    });
    if (!desc || desc.length > 400) {
      return "No se pudo armar la descripción del reclamo.";
    }
    return null;
  }

  // Categorías de texto libre — staff_conduct, delivery_delay, other.
  const freeText =
    category === "staff_conduct"
      ? staffDescription
      : category === "delivery_delay"
        ? delayDescription
        : otherDescription;
  if (!freeText.trim()) return "Describí lo ocurrido.";
  if (freeText.trim().length < 10 || freeText.trim().length > 400) {
    return "La descripción debe tener entre 10 y 400 caracteres.";
  }
  return null;
}
