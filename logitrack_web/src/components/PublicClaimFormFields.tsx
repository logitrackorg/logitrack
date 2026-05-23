import { useEffect, useState } from "react";
import {
  CLAIM_MAIN_OPTIONS,
  DAMAGE_SUBTYPE_OPTIONS,
  DELIVERY_SUBTYPE_OPTIONS,
  damageSubtypeRequiresEvidence,
  type ClaimMainCategory,
  type DamageSubtype,
  type DeliverySubtype,
} from "../utils/publicClaimForm";

export interface PublicClaimFormValues {
  createdBy: string;
  dni: string;
  category: ClaimMainCategory | "";
  damageSubtypes: DamageSubtype[];
  deliverySubtype: DeliverySubtype | "";
  staffDescription: string;
  evidence: File | null;
}

interface Props {
  values: PublicClaimFormValues;
  onChange: (patch: Partial<PublicClaimFormValues>) => void;
  disabled?: boolean;
}

export function PublicClaimFormFields({ values, onChange, disabled }: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!values.evidence?.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(values.evidence);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [values.evidence]);

  const toggleDamageSubtype = (subtype: DamageSubtype) => {
    const next = values.damageSubtypes.includes(subtype)
      ? values.damageSubtypes.filter((s) => s !== subtype)
      : [...values.damageSubtypes, subtype];
    onChange({ damageSubtypes: next });
  };

  const evidenceRequired =
    values.category === "incomplete_damage" && damageSubtypeRequiresEvidence(values.damageSubtypes);
  const evidenceOptional =
    values.category === "incomplete_damage" &&
    values.damageSubtypes.includes("missing_products") &&
    !evidenceRequired;

  return (
    <div className="pt-claim-form-fields">
      <fieldset className="pt-claim-fieldset">
        <legend className="pt-claim-legend">¿Qué problema tuviste con el envío?</legend>
        <div className="pt-claim-choice-list" role="radiogroup" aria-label="Tipo de problema">
          {CLAIM_MAIN_OPTIONS.map((opt) => (
            <label key={opt.value} className="pt-claim-choice pt-claim-choice--radio">
              <input
                type="radio"
                name="claim-main-category"
                value={opt.value}
                checked={values.category === opt.value}
                onChange={() =>
                  onChange({
                    category: opt.value,
                    damageSubtypes: [],
                    deliverySubtype: "",
                    staffDescription: "",
                    evidence: null,
                  })
                }
                disabled={disabled}
              />
              <span className="pt-claim-choice-text">{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {values.category === "incomplete_damage" && (
        <fieldset className="pt-claim-fieldset pt-claim-fieldset--nested">
          <legend className="pt-claim-legend">Subtipo</legend>
          <div className="pt-claim-choice-list">
            {DAMAGE_SUBTYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="pt-claim-choice pt-claim-choice--check">
                <input
                  type="checkbox"
                  checked={values.damageSubtypes.includes(opt.value)}
                  onChange={() => toggleDamageSubtype(opt.value)}
                  disabled={disabled}
                />
                <span className="pt-claim-choice-text">{opt.label}</span>
              </label>
            ))}
          </div>
          <label className="pt-claim-field pt-claim-evidence-field">
            <span className="pt-claim-label">
              Adjuntar evidencia
              {evidenceRequired && <span className="pt-claim-required"> (obligatorio para daños)</span>}
              {evidenceOptional && !evidenceRequired && (
                <span className="pt-claim-optional"> (opcional para faltantes)</span>
              )}
            </span>
            <input
              className="pt-claim-input pt-claim-file"
              type="file"
              accept="image/*"
              onChange={(e) => onChange({ evidence: e.target.files?.[0] ?? null })}
              disabled={disabled}
            />
            {values.evidence && (
              <span className="pt-claim-hint">Archivo: {values.evidence.name}</span>
            )}
            {previewUrl && (
              <img src={previewUrl} alt="Vista previa de evidencia" className="pt-claim-evidence-preview" />
            )}
          </label>
        </fieldset>
      )}

      {values.category === "delivery_problem" && (
        <fieldset className="pt-claim-fieldset pt-claim-fieldset--nested">
          <legend className="pt-claim-legend">Detalle del problema</legend>
          <div className="pt-claim-choice-list" role="radiogroup" aria-label="Problema con la entrega">
            {DELIVERY_SUBTYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="pt-claim-choice pt-claim-choice--radio">
                <input
                  type="radio"
                  name="claim-delivery-subtype"
                  value={opt.value}
                  checked={values.deliverySubtype === opt.value}
                  onChange={() => onChange({ deliverySubtype: opt.value })}
                  disabled={disabled}
                />
                <span className="pt-claim-choice-text">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {values.category === "staff_conduct" && (
        <label className="pt-claim-field">
          <span className="pt-claim-label">Describa lo ocurrido</span>
          <textarea
            className="pt-claim-textarea"
            rows={4}
            value={values.staffDescription}
            onChange={(e) => onChange({ staffDescription: e.target.value })}
            placeholder="Contanos qué pasó con la atención o conducta del personal"
            disabled={disabled}
          />
          <span className="pt-claim-hint">Entre 10 y 400 caracteres.</span>
        </label>
      )}

      <div className="pt-claim-grid pt-claim-grid--identity">
        <label className="pt-claim-field">
          <span className="pt-claim-label">Nombre y apellido</span>
          <input
            className="pt-claim-input"
            value={values.createdBy}
            onChange={(e) => onChange({ createdBy: e.target.value })}
            placeholder="Ingresá tu nombre y apellido"
            autoComplete="name"
            disabled={disabled}
          />
        </label>
        <label className="pt-claim-field">
          <span className="pt-claim-label">DNI</span>
          <input
            className="pt-claim-input"
            value={values.dni}
            onChange={(e) => onChange({ dni: e.target.value })}
            placeholder="Solo números"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
          />
        </label>
      </div>
    </div>
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

