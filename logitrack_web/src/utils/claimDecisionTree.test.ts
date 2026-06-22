import { describe, expect, it } from "vitest";
import {
  classifyClaimType,
  canSelectClaimCategory,
  damageRequiresEvidence,
  isAllowedClaimEvidenceFile,
  CLAIM_CATEGORIES,
  CLAIM_EVIDENCE_ACCEPT,
} from "./claimDecisionTree";

describe("claimDecisionTree.classifyClaimType", () => {
  // Espejo del test Go service.TestClassifyClaimType_Table — cualquier
  // divergencia rompe el invariante de "mismo intent → mismo claim_type" entre
  // ambos canales.
  it.each([
    { cat: "staff_conduct", expected: "bad_treatment" },
    { cat: "delivery_problem", expected: "not_delivered" },
    { cat: "delivery_delay", expected: "delay" },
    { cat: "incomplete_damage", expected: "damage" },
    { cat: "other", expected: "other" },
  ] as const)("$cat → $expected", ({ cat, expected }) => {
    expect(classifyClaimType(cat, [], "")).toBe(expected);
  });

  it("delivery_problem + wrong_address → wrong_data", () => {
    expect(classifyClaimType("delivery_problem", [], "wrong_address")).toBe("wrong_data");
  });

  it("delivery_problem + wrong_person → not_delivered", () => {
    expect(classifyClaimType("delivery_problem", [], "wrong_person")).toBe("not_delivered");
  });


});

describe("claimDecisionTree.damageRequiresEvidence", () => {
  it("solo embalaje no requiere", () => {
    expect(damageRequiresEvidence(["packaging_damaged"])).toBe(false);
  });
  it("producto dañado requiere", () => {
    expect(damageRequiresEvidence(["product_damaged"])).toBe(true);
  });
  it("vacío no requiere", () => {
    expect(damageRequiresEvidence([])).toBe(false);
  });
});

describe("claimDecisionTree.canSelectClaimCategory", () => {
  it("staff_conduct seleccionable incluso sin envío entregado", () => {
    const shipment = { status: "at_origin_hub" as const };
    expect(canSelectClaimCategory(shipment, "staff_conduct")).toBe(true);
  });

  it("otros tipos no seleccionables hasta entrega o ETA + 1h vencido", () => {
    const futureISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const shipment = { status: "in_transit", estimated_delivery_at: futureISO };
    expect(canSelectClaimCategory(shipment, "incomplete_damage")).toBe(false);
    expect(canSelectClaimCategory(shipment, "delivery_problem")).toBe(false);
    expect(canSelectClaimCategory(shipment, "delivery_delay")).toBe(false);
    expect(canSelectClaimCategory(shipment, "other")).toBe(false);
    expect(canSelectClaimCategory(shipment, "staff_conduct")).toBe(true);
  });

  it("envío entregado habilita todas las categorías", () => {
    const shipment = { status: "delivered" as const };
    for (const cat of CLAIM_CATEGORIES) {
      expect(canSelectClaimCategory(shipment, cat.value)).toBe(true);
    }
  });
});

describe("claimDecisionTree.evidence file rules", () => {
  it("acepta jpg, png, pdf, txt", () => {
    const make = (name: string, type: string) =>
      new File(["x"], name, { type });
    expect(isAllowedClaimEvidenceFile(make("foto.jpg", "image/jpeg"))).toBe(true);
    expect(isAllowedClaimEvidenceFile(make("foto.png", "image/png"))).toBe(true);
    expect(isAllowedClaimEvidenceFile(make("nota.txt", "text/plain"))).toBe(true);
    expect(isAllowedClaimEvidenceFile(make("doc.pdf", "application/pdf"))).toBe(true);
  });

  it("rechaza doc/docx/zip", () => {
    const make = (name: string, type: string) =>
      new File(["x"], name, { type });
    expect(isAllowedClaimEvidenceFile(make("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))).toBe(false);
    expect(isAllowedClaimEvidenceFile(make("doc.doc", "application/msword"))).toBe(false);
    expect(isAllowedClaimEvidenceFile(make("a.zip", "application/zip"))).toBe(false);
  });

  it("CLAIM_EVIDENCE_ACCEPT enumera el set único", () => {
    expect(CLAIM_EVIDENCE_ACCEPT).toBe("image/*,.pdf,.txt");
  });
});

describe("claimDecisionTree CLAIM_CATEGORIES", () => {
  it("incluye exactamente las 5 categorías del árbol", () => {
    expect(CLAIM_CATEGORIES.map((c) => c.value)).toEqual([
      "incomplete_damage",
      "delivery_problem",
      "delivery_delay",
      "staff_conduct",
      "other",
    ]);
  });

  it("cada categoría tiene labels para ambos canales", () => {
    for (const cat of CLAIM_CATEGORIES) {
      expect(cat.label).toBeTruthy();
      expect(cat.chatbotLabel).toBeTruthy();
    }
  });
});
