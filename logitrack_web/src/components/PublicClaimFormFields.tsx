import { useState, type ReactNode } from "react";
import {
  CLAIM_MAIN_OPTIONS,
  DAMAGE_SUBTYPE_OPTIONS,
  DELIVERY_SUBTYPE_OPTIONS,
  damageSubtypeRequiresEvidence,
  isAllowedClaimEvidenceFile,
  MAX_CLAIM_EVIDENCE_BYTES,
  type ClaimMainCategory,
  type DamageSubtype,
  type DeliverySubtype,
} from "../utils/publicClaimForm";
import {
  CLAIM_INELIGIBLE_MESSAGE,
  canSelectClaimCategory,
  CLAIM_EVIDENCE_ACCEPT,
  type ClaimEligibilityShipment,
} from "../utils/claimDecisionTree";

export interface PublicClaimFormValues {
  createdBy: string;
  dni: string;
  category: ClaimMainCategory | "";
  damageSubtypes: DamageSubtype[];
  deliverySubtype: DeliverySubtype | "";
  staffDescription: string;
  delayDescription: string;
  otherDescription: string;
  evidence: File | null;
}

interface Props {
  values: PublicClaimFormValues;
  onChange: (patch: Partial<PublicClaimFormValues>) => void;
  disabled?: boolean;
  shipment?: ClaimEligibilityShipment | null;
  /** Cuando se provee y el usuario ya eligió categoría, reemplaza los sub-campos
   *  y los datos personales. Se usa para mostrar el wizard de pre-filtro. */
  preFilterSlot?: ReactNode;
}

export function PublicClaimFormFields({ values, onChange, disabled, shipment, preFilterSlot }: Props) {
  const [evidenceError, setEvidenceError] = useState<string>("");

  const toggleDamageSubtype = (subtype: DamageSubtype) => {
    const next = values.damageSubtypes.includes(subtype)
      ? values.damageSubtypes.filter((s) => s !== subtype)
      : [...values.damageSubtypes, subtype];
    onChange({ damageSubtypes: next });
  };

  const evidenceRequired =
    values.category === "incomplete_damage" && damageSubtypeRequiresEvidence(values.damageSubtypes);

  const handleEvidenceChange = (file: File | null) => {
    if (!file) {
      setEvidenceError("");
      onChange({ evidence: null });
      return;
    }
    if (!isAllowedClaimEvidenceFile(file)) {
      setEvidenceError("La evidencia debe ser un archivo TXT, PDF o una imagen pequeña.");
      onChange({ evidence: null });
      return;
    }
    if (file.size > MAX_CLAIM_EVIDENCE_BYTES) {
      setEvidenceError("La evidencia no puede superar 1 MB.");
      onChange({ evidence: null });
      return;
    }
    setEvidenceError("");
    onChange({ evidence: file });
  };

  const choiceLabelClasses =
    "flex items-center gap-2.5 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer transition-colors hover:border-blue-300 dark:hover:border-blue-600 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50/50 dark:has-[:checked]:bg-blue-500/10";
  const choiceTextClasses = "text-sm text-gray-700 dark:text-gray-300";
  const fieldsetClasses = "space-y-5 rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/30";
  const legendClasses = "text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3";
  const textInputClasses =
    "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all";
  const textareaClasses = `${textInputClasses} resize-y`;
  const fileInputClasses =
    "w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100";
  const labelClasses = "block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1";
  const hintClasses = "text-xs text-gray-400 dark:text-gray-500";

  const optionDisabled = (category: ClaimMainCategory) => {
    if (disabled) return true;
    if (!shipment) return false;
    return !canSelectClaimCategory(shipment, category);
  };

  // Hay al menos una opción bloqueada por elegibilidad → mostrar aviso.
  const someBlocked = !!shipment && CLAIM_MAIN_OPTIONS.some((opt) => optionDisabled(opt.value));

  return (
    <div className="flex flex-col gap-4">
      <fieldset className={fieldsetClasses}>
        <legend className={legendClasses}>¿Qué problema tuviste con el envío?</legend>
        {someBlocked && (
          <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2 mb-3">
            {CLAIM_INELIGIBLE_MESSAGE}
          </p>
        )}
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Tipo de problema">
          {CLAIM_MAIN_OPTIONS.map((opt) => {
            const isDisabled = optionDisabled(opt.value);
            return (
              <label
                key={opt.value}
                className={`${choiceLabelClasses} ${
                  isDisabled
                    ? "opacity-50 cursor-not-allowed hover:border-gray-200 dark:hover:border-gray-700"
                    : ""
                }`}
              >
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
                      delayDescription: "",
                      otherDescription: "",
                      evidence: null,
                    })
                  }
                  disabled={isDisabled}
                  className="shrink-0 accent-[var(--sidebar-bg)]"
                />
                <span className={choiceTextClasses}>{opt.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Si hay un slot de pre-filtro activo, lo muestra en lugar de los sub-campos */}
      {values.category && preFilterSlot ? preFilterSlot : (
        <>
          {values.category === "incomplete_damage" && (
            <fieldset className={`${fieldsetClasses} bg-white dark:bg-gray-800 mt-1`}>
              <legend className={legendClasses}>Subtipo</legend>
              <div className="flex flex-col gap-2">
                {DAMAGE_SUBTYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className={choiceLabelClasses}>
                    <input
                      type="checkbox"
                      checked={values.damageSubtypes.includes(opt.value)}
                      onChange={() => toggleDamageSubtype(opt.value)}
                      disabled={disabled}
                      className="shrink-0 accent-[var(--sidebar-bg)]"
                    />
                    <span className={choiceTextClasses}>{opt.label}</span>
                  </label>
                ))}
              </div>
              <label className="flex flex-col gap-1.5 mt-3">
                <span className={labelClasses}>
                  Adjuntar evidencia
                  {evidenceRequired && <span className="text-red-500 text-xs"> (obligatorio para producto dañado)</span>}
                  {!evidenceRequired && <span className="text-gray-400 text-xs"> (opcional)</span>}
                </span>
                <input
                  className={fileInputClasses}
                  type="file"
                  accept={CLAIM_EVIDENCE_ACCEPT}
                  onChange={(e) => handleEvidenceChange(e.target.files?.[0] ?? null)}
                  disabled={disabled}
                />
                {values.evidence && (
                  <span className={hintClasses}>Archivo: {values.evidence.name}</span>
                )}
                <span className={hintClasses}>Formatos admitidos: imágenes pequeñas, .txt o .pdf, máximo 1 MB.</span>
                {evidenceError && (
                  <span className="text-red-500 text-xs">{evidenceError}</span>
                )}
              </label>
            </fieldset>
          )}

          {values.category === "delivery_problem" && (
            <fieldset className={`${fieldsetClasses} bg-white dark:bg-gray-800 mt-1`}>
              <legend className={legendClasses}>Detalle del problema</legend>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Problema con la entrega">
                {DELIVERY_SUBTYPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className={choiceLabelClasses}>
                    <input
                      type="radio"
                      name="claim-delivery-subtype"
                      value={opt.value}
                      checked={values.deliverySubtype === opt.value}
                      onChange={() => onChange({ deliverySubtype: opt.value })}
                      disabled={disabled}
                      className="shrink-0 accent-[var(--sidebar-bg)]"
                    />
                    <span className={choiceTextClasses}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {values.category === "delivery_delay" && (
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>Describí la demora</span>
              <textarea
                className={textareaClasses}
                rows={4}
                value={values.delayDescription}
                onChange={(e) => onChange({ delayDescription: e.target.value })}
                placeholder="Cuándo debió llegar y cuánto tiempo lleva demorado"
                disabled={disabled}
              />
              <span className={hintClasses}>Entre 10 y 400 caracteres.</span>
            </label>
          )}

          {values.category === "staff_conduct" && (
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>Describa lo ocurrido</span>
              <textarea
                className={textareaClasses}
                rows={4}
                value={values.staffDescription}
                onChange={(e) => onChange({ staffDescription: e.target.value })}
                placeholder="Contanos qué pasó con la atención o conducta del personal"
                disabled={disabled}
              />
              <span className={hintClasses}>Entre 10 y 400 caracteres.</span>
            </label>
          )}

          {values.category === "other" && (
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>Contanos qué pasó</span>
              <textarea
                className={textareaClasses}
                rows={4}
                value={values.otherDescription}
                onChange={(e) => onChange({ otherDescription: e.target.value })}
                placeholder="Describí brevemente el motivo del reclamo"
                disabled={disabled}
              />
              <span className={hintClasses}>Entre 10 y 400 caracteres.</span>
            </label>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-gray-200 dark:border-gray-700 pt-4 mt-1">
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>Nombre y apellido</span>
              <input
                className={textInputClasses}
                value={values.createdBy}
                onChange={(e) => onChange({ createdBy: e.target.value })}
                placeholder="Tal cual figura en el envío"
                autoComplete="name"
                disabled={disabled}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>DNI</span>
              <input
                className={textInputClasses}
                value={values.dni}
                onChange={(e) => onChange({ dni: e.target.value })}
                placeholder="Solo números"
                inputMode="numeric"
                autoComplete="off"
                disabled={disabled}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
