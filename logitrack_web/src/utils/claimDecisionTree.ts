import type { ClaimType } from "../api/publicTracking";
import {
  canFileClaimOfType,
  CLAIM_INELIGIBLE_MESSAGE,
  type ClaimEligibilityShipment,
} from "./claimEligibility";

// ────────────────────────────────────────────────────────────────────────────
// Único árbol de decisión de reclamos para AMBOS canales (chatbot y formulario
// público). El backend tiene su espejo en
// logitrack_core/internal/service/claim_classification.go
// (ClassifyClaimType, ClaimCategoryInput). Cualquier cambio acá debe
// reflejarse del otro lado para que un mismo intent del cliente termine
// produciendo el mismo `claim_type`.
// ────────────────────────────────────────────────────────────────────────────

export type ClaimCategory =
  | "incomplete_damage"
  | "delivery_problem"
  | "delivery_delay"
  | "staff_conduct"
  | "other";

export type DamageSubtype = "product_damaged" | "missing_products" | "packaging_damaged";

export type DeliverySubtype = "marked_delivered" | "wrong_person" | "wrong_address";

export interface ClaimCategoryDef {
  value: ClaimCategory;
  /** Etiqueta para el formulario público. */
  label: string;
  /** Etiqueta para el chatbot — corta y con emoji al inicio. */
  chatbotLabel: string;
  /** ClaimType final al que mapea esta categoría, asumiendo no hay subtipo que
   *  lo desambigue (delivery_problem desambigua entre `not_delivered` y
   *  `wrong_data` según el DeliverySubtype). */
  defaultClaimType: ClaimType;
  /** True si la categoría necesita uno o más DamageSubtype (incomplete_damage). */
  requiresDamageSubtype?: boolean;
  /** True si la categoría necesita un DeliverySubtype (delivery_problem). */
  requiresDeliverySubtype?: boolean;
  /** True si la categoría usa un textarea de texto libre como descripción
   *  (missing, staff_conduct, delivery_delay, other). */
  requiresFreeText?: boolean;
}

export const CLAIM_CATEGORIES: ClaimCategoryDef[] = [
  {
    value: "incomplete_damage",
    label: "Daño / Faltante",
    chatbotLabel: "📦 Daño / Faltante",
    defaultClaimType: "damage",
    requiresDamageSubtype: true,
  },
  {
    value: "delivery_problem",
    label: "No lo recibí",
    chatbotLabel: "🚫 No lo recibí",
    defaultClaimType: "not_delivered",
    requiresDeliverySubtype: true,
  },
  {
    value: "delivery_delay",
    label: "Demora en entrega",
    chatbotLabel: "🕐 Demora en entrega",
    defaultClaimType: "delay",
    requiresFreeText: true,
  },
  {
    value: "staff_conduct",
    label: "Maltrato del personal",
    chatbotLabel: "😡 Maltrato del personal",
    defaultClaimType: "bad_treatment",
    requiresFreeText: true,
  },
  {
    value: "other",
    label: "Otro",
    chatbotLabel: "❓ Otro",
    defaultClaimType: "other",
    requiresFreeText: true,
  },
];

export const DAMAGE_SUBTYPE_OPTIONS: { value: DamageSubtype; label: string }[] = [
  { value: "product_damaged", label: "Producto dañado" },
  { value: "missing_products", label: "Falta mercadería" },
  { value: "packaging_damaged", label: "Embalaje dañado" },
];

export const DELIVERY_SUBTYPE_OPTIONS: { value: DeliverySubtype; label: string }[] = [
  { value: "marked_delivered", label: "Figuró entregado pero no lo recibí" },
  { value: "wrong_person", label: "Entregado a otra persona" },
  { value: "wrong_address", label: "Dirección incorrecta" },
];

// ────────────────────────────────────────────────────────────────────────────
// Lógica pura
// ────────────────────────────────────────────────────────────────────────────

/** Espejo TS de service.ClassifyClaimType: mapea categoría + subtipos al
 *  ClaimType canónico. Mantener en sync con el backend. */
export function classifyClaimType(
  category: ClaimCategory,
  damageSubtypes: DamageSubtype[],
  deliverySubtype: DeliverySubtype | "",
): ClaimType {
  if (category === "staff_conduct") return "bad_treatment";
  if (category === "delivery_problem") {
    return deliverySubtype === "wrong_address" ? "wrong_data" : "not_delivered";
  }
  if (category === "delivery_delay") return "delay";
  if (category === "other") return "other";
  // incomplete_damage — los subtipos no cambian el ClaimType, solo gobiernan
  // evidencia obligatoria y descripción.
  void damageSubtypes;
  return "damage";
}

/** Indica si los subtipos de daño elegidos exigen adjuntar evidencia. Hoy
 *  solo "producto dañado" la requiere. Mantener en sync con
 *  service.DamageRequiresEvidence. */
export function damageRequiresEvidence(subtypes: DamageSubtype[]): boolean {
  return subtypes.includes("product_damaged");
}

// ────────────────────────────────────────────────────────────────────────────
// Reglas de archivo de evidencia (espejo de service.IsAllowedClaimEvidence /
// service.MaxClaimEvidenceSize).
// ────────────────────────────────────────────────────────────────────────────

export const MAX_CLAIM_EVIDENCE_BYTES = 1024 * 1024; // 1 MB

/** Atributo `accept` recomendado para el <input type="file"> en ambos canales.
 *  Mantener en sync con AllowedClaimEvidenceExtensions del backend. */
export const CLAIM_EVIDENCE_ACCEPT = "image/*,.pdf,.txt";

export function isAllowedClaimEvidenceFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return true;
  if (lowerName.endsWith(".pdf") || file.type === "application/pdf") return true;
  if (lowerName.endsWith(".txt") || file.type === "text/plain") return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Elegibilidad (gating P2)
// ────────────────────────────────────────────────────────────────────────────

/** Indica si una categoría puede iniciarse para un envío dado. Wrapper sobre
 *  canFileClaimOfType que considera la categoría completa (no solo el
 *  ClaimType final), útil para que delivery_problem aplique las mismas
 *  restricciones que not_delivered/wrong_data. */
export function canSelectClaimCategory(
  shipment: ClaimEligibilityShipment | null | undefined,
  category: ClaimCategory,
): boolean {
  if (!shipment) return true;
  const claimType = classifyClaimType(category, [], "");
  return canFileClaimOfType(shipment, claimType);
}

export { canFileClaimOfType, CLAIM_INELIGIBLE_MESSAGE };
export type { ClaimEligibilityShipment };
