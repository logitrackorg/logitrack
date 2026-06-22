package service

import (
	"strings"

	"github.com/logitrack/core/internal/model"
)

// ClaimCategory es la categoría de primer nivel del árbol de decisión que ve
// el cliente al crear un reclamo (en cualquiera de los dos canales: chatbot o
// formulario público). NO es el `model.ClaimType` final que se persiste — es la
// pieza intermedia que el cliente elige y que el backend normaliza a un único
// ClaimType canónico mediante ClassifyClaimType.
//
// Debe mantenerse en sync con el módulo TS
// logitrack_web/src/utils/claimDecisionTree.ts.
type ClaimCategoryInput string

const (
	// CategoryIncompleteDamage — daño físico al producto y/o embalaje. Requiere
	// uno o más DamageSubtype (product_damaged / packaging_damaged).
	CategoryIncompleteDamage ClaimCategoryInput = "incomplete_damage"
	// CategoryDeliveryProblem — problemas durante la entrega: no recibido,
	// entregado a otra persona, dirección incorrecta. Se subdivide en
	// DeliverySubtype para distinguir `not_delivered` de `wrong_data`.
	CategoryDeliveryProblem ClaimCategoryInput = "delivery_problem"
	// CategoryDeliveryDelay — demora en la entrega más allá de la ETA. Se
	// clasifica como `delay`.
	CategoryDeliveryDelay ClaimCategoryInput = "delivery_delay"
	// CategoryStaffConduct — atención o conducta del personal (insultos,
	// maltrato). Se clasifica como `bad_treatment`.
	CategoryStaffConduct ClaimCategoryInput = "staff_conduct"
	// CategoryOther — cualquier otro motivo que no encaje arriba.
	CategoryOther ClaimCategoryInput = "other"
)

// DamageSubtype enumera los subtipos válidos dentro de CategoryIncompleteDamage.
type DamageSubtype string

const (
	DamageProductDamaged   DamageSubtype = "product_damaged"
	DamageMissingProducts  DamageSubtype = "missing_products"
	DamagePackagingDamaged DamageSubtype = "packaging_damaged"
)

// DeliverySubtype enumera los subtipos válidos dentro de CategoryDeliveryProblem.
type DeliverySubtype string

const (
	DeliveryMarkedDelivered DeliverySubtype = "marked_delivered"
	DeliveryWrongPerson     DeliverySubtype = "wrong_person"
	DeliveryWrongAddress    DeliverySubtype = "wrong_address"
)

// ClaimClassificationInput agrupa lo que el cliente eligió en el árbol de
// decisión, antes de normalizarlo al `model.ClaimType` final.
type ClaimClassificationInput struct {
	Category        ClaimCategoryInput
	DamageSubtypes  []DamageSubtype
	DeliverySubtype DeliverySubtype
}

// ClassifyClaimType es la única fuente de verdad para mapear la elección del
// cliente al `model.ClaimType` canónico. Es pura: no toca DB ni clock.
//
// Reglas:
//   - staff_conduct                                → bad_treatment
//   - delivery_problem + subtype=wrong_address     → wrong_data
//   - delivery_problem + otros subtipos            → not_delivered
//   - delivery_delay                               → delay
//   - incomplete_damage                            → damage (los subtipos no
//     cambian el tipo final; sirven para validar evidencia obligatoria y armar
//     la descripción)
//   - other                                        → other
//
// Si la Category está vacía o no se reconoce, devuelve ("", false) para que el
// caller decida si confiar en un `claim_type` crudo (compatibilidad hacia atrás).
func ClassifyClaimType(in ClaimClassificationInput) (model.ClaimType, bool) {
	switch in.Category {
	case CategoryStaffConduct:
		return model.ClaimTypeBadTreatment, true
	case CategoryDeliveryProblem:
		if in.DeliverySubtype == DeliveryWrongAddress {
			return model.ClaimTypeWrongData, true
		}
		return model.ClaimTypeNotDelivered, true
	case CategoryDeliveryDelay:
		return model.ClaimTypeDelay, true
	case CategoryIncompleteDamage:
		return model.ClaimTypeDamage, true
	case CategoryOther:
		return model.ClaimTypeOther, true
	}
	return "", false
}

// DamageRequiresEvidence indica si los subtipos elegidos de damage exigen
// adjuntar evidencia. Hoy solo "producto dañado" la requiere; embalaje dañado
// no.
func DamageRequiresEvidence(subtypes []DamageSubtype) bool {
	for _, s := range subtypes {
		if s == DamageProductDamaged {
			return true
		}
	}
	return false
}

// ParseDamageSubtypes acepta strings sueltos (provenientes de form values o
// CSV) y los normaliza al enum, descartando vacíos y valores no reconocidos.
// Es laxa a propósito: la regla "valor no reconocido => ignorar" facilita
// evolucionar el árbol sin romper requests viejos en vuelo.
func ParseDamageSubtypes(raw []string) []DamageSubtype {
	if len(raw) == 0 {
		return nil
	}
	out := make([]DamageSubtype, 0, len(raw))
	for _, v := range raw {
		v = strings.TrimSpace(v)
		switch DamageSubtype(v) {
		case DamageProductDamaged, DamageMissingProducts, DamagePackagingDamaged:
			out = append(out, DamageSubtype(v))
		}
	}
	return out
}
