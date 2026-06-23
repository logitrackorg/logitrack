package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// El árbol de decisión es la única fuente de verdad del claim_type; esta
// tabla cubre cada categoría y subtipo que puede llegar desde el frontend
// (chatbot o formulario público).
func TestClassifyClaimType_Table(t *testing.T) {
	cases := []struct {
		name            string
		category        ClaimCategoryInput
		damageSubtypes  []DamageSubtype
		deliverySubtype DeliverySubtype
		wantType        model.ClaimType
		wantOK          bool
	}{
		{
			name:     "staff_conduct → bad_treatment",
			category: CategoryStaffConduct,
			wantType: model.ClaimTypeBadTreatment,
			wantOK:   true,
		},
		{
			name:            "delivery_problem sin subtipo → not_delivered",
			category:        CategoryDeliveryProblem,
			deliverySubtype: "",
			wantType:        model.ClaimTypeNotDelivered,
			wantOK:          true,
		},
		{
			name:            "delivery_problem + marked_delivered → not_delivered",
			category:        CategoryDeliveryProblem,
			deliverySubtype: DeliveryMarkedDelivered,
			wantType:        model.ClaimTypeNotDelivered,
			wantOK:          true,
		},
		{
			name:            "delivery_problem + wrong_person → not_delivered",
			category:        CategoryDeliveryProblem,
			deliverySubtype: DeliveryWrongPerson,
			wantType:        model.ClaimTypeNotDelivered,
			wantOK:          true,
		},
		{
			name:            "delivery_problem + wrong_address → wrong_data",
			category:        CategoryDeliveryProblem,
			deliverySubtype: DeliveryWrongAddress,
			wantType:        model.ClaimTypeWrongData,
			wantOK:          true,
		},
		{
			name:     "delivery_delay → delay",
			category: CategoryDeliveryDelay,
			wantType: model.ClaimTypeDelay,
			wantOK:   true,
		},
		{
			name:           "incomplete_damage sin subtipos → damage",
			category:       CategoryIncompleteDamage,
			damageSubtypes: nil,
			wantType:       model.ClaimTypeDamage,
			wantOK:         true,
		},
		{
			name:           "incomplete_damage + product_damaged → damage",
			category:       CategoryIncompleteDamage,
			damageSubtypes: []DamageSubtype{DamageProductDamaged},
			wantType:       model.ClaimTypeDamage,
			wantOK:         true,
		},
		{
			name:           "incomplete_damage + packaging_damaged → damage",
			category:       CategoryIncompleteDamage,
			damageSubtypes: []DamageSubtype{DamagePackagingDamaged},
			wantType:       model.ClaimTypeDamage,
			wantOK:         true,
		},
		{
			name:     "other → other",
			category: CategoryOther,
			wantType: model.ClaimTypeOther,
			wantOK:   true,
		},
		{
			name:     "categoría vacía → not classified",
			category: "",
			wantOK:   false,
		},
		{
			name:     "categoría inválida → not classified",
			category: "invalid_category",
			wantOK:   false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ClassifyClaimType(ClaimClassificationInput{
				Category:        tc.category,
				DamageSubtypes:  tc.damageSubtypes,
				DeliverySubtype: tc.deliverySubtype,
			})
			if ok != tc.wantOK {
				t.Fatalf("ok=%v, esperado %v", ok, tc.wantOK)
			}
			if ok && got != tc.wantType {
				t.Fatalf("claim_type=%q, esperado %q", got, tc.wantType)
			}
		})
	}
}

func TestDamageRequiresEvidence(t *testing.T) {
	cases := []struct {
		name     string
		subtypes []DamageSubtype
		want     bool
	}{
		{"vacío", nil, false},
		{"solo embalaje", []DamageSubtype{DamagePackagingDamaged}, false},
		{"solo producto", []DamageSubtype{DamageProductDamaged}, true},
		{"producto + embalaje", []DamageSubtype{DamageProductDamaged, DamagePackagingDamaged}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := DamageRequiresEvidence(tc.subtypes); got != tc.want {
				t.Fatalf("got=%v, want=%v", got, tc.want)
			}
		})
	}
}

func TestParseDamageSubtypes_FiltersUnknown(t *testing.T) {
	got := ParseDamageSubtypes([]string{"product_damaged", "missing_products", "  ", "packaging_damaged", "garbage"})
	want := []DamageSubtype{DamageProductDamaged, DamageMissingProducts, DamagePackagingDamaged}
	if len(got) != len(want) {
		t.Fatalf("len=%d, want %d (%v)", len(got), len(want), got)
	}
	for i, v := range want {
		if got[i] != v {
			t.Fatalf("got[%d]=%q, want %q", i, got[i], v)
		}
	}
}
