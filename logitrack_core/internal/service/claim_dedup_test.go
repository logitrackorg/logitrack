package service

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/logitrack/core/internal/model"
)

// La dedup ahora vive en CreatePublicClaim: cualquier canal que lo invoque
// recibe el mismo rechazo (ActiveClaimExistsError). Antes solo el chatbot lo
// hacía en su handler; el formulario público permitía duplicados.
func TestCreatePublicClaim_RejectsDuplicateActiveClaim(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)

	first, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}

	_, dupErr := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Sigo esperando el paquete y aún no llega",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if dupErr == nil {
		t.Fatalf("se esperaba rechazo por reclamo activo duplicado")
	}
	var typed *ActiveClaimExistsError
	if !errors.As(dupErr, &typed) {
		t.Fatalf("se esperaba ActiveClaimExistsError, got %T (%v)", dupErr, dupErr)
	}
	if typed.ExistingClaimID != first.ID {
		t.Fatalf("ExistingClaimID=%q, esperado %q", typed.ExistingClaimID, first.ID)
	}
}

func TestIsActiveClaimExistsError_HelperMatchesWrappedError(t *testing.T) {
	base := &ActiveClaimExistsError{ExistingClaimID: "REC-1", ExistingStatus: "open"}
	wrapped := errors.Join(errors.New("contexto"), base)
	got, ok := IsActiveClaimExistsError(wrapped)
	if !ok || got.ExistingClaimID != "REC-1" {
		t.Fatalf("helper no detectó el error envuelto: ok=%v got=%v", ok, got)
	}
}

// Otra parte (otro DNI) puede abrir reclamos en paralelo: sender vs
// recipient sobre el mismo envío no se bloquean entre sí.
func TestCreatePublicClaim_AllowsClaimFromDifferentDNI(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)

	_, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Demora en la entrega del paquete",
		CreatedBy:   "Alice Sender",
		DNI:         "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	// El destinatario tiene un DNI distinto (defaultRecipient en shipment_test).
	_, err2 := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:  ship.TrackingID,
		ClaimType:   model.ClaimTypeDelay,
		Description: "Yo tampoco lo recibí, soy el destinatario",
		CreatedBy:   "Bob Recipient",
		DNI:         "87654321",
	}, nil)
	if err2 != nil {
		t.Fatalf("reclamo de otra parte no debe bloquearse: %v", err2)
	}
}

// La validación de evidencia obligatoria para producto dañado se enforce desde
// el servicio (antes vivía en cada handler/parser). Probamos sin evidencia.
func TestCreatePublicClaim_RequiresEvidenceForProductDamaged(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)

	_, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:     ship.TrackingID,
		Category:       string(CategoryIncompleteDamage),
		DamageSubtypes: []string{"product_damaged"},
		ClaimType:      model.ClaimTypeDamage,
		Description:    "Producto roto al abrir el paquete",
		CreatedBy:      "Alice Sender",
		DNI:            "12345678",
	}, nil)
	if err == nil {
		t.Fatalf("se esperaba rechazo por evidencia obligatoria")
	}
	if !strings.Contains(err.Error(), "evidencia") {
		t.Fatalf("mensaje inesperado: %v", err)
	}
}

// Mismo escenario pero con evidencia adjunta: debe pasar.
func TestCreatePublicClaim_AcceptsProductDamagedWithEvidence(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)
	chdir(t)

	_, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:     ship.TrackingID,
		Category:       string(CategoryIncompleteDamage),
		DamageSubtypes: []string{"product_damaged"},
		ClaimType:      model.ClaimTypeDamage,
		Description:    "Producto roto al abrir el paquete",
		CreatedBy:      "Alice Sender",
		DNI:            "12345678",
	}, &ClaimEvidenceUpload{
		FileName: "foto.jpg",
		MimeType: "image/jpeg",
		Data:     []byte("img"),
	})
	if err != nil {
		t.Fatalf("se esperaba aceptación con evidencia: %v", err)
	}
}

// Si llega Category, el servicio normaliza el ClaimType e ignora el crudo.
// Probamos que `Category=delivery_problem` + subtipo wrong_address +
// `ClaimType=damage` se persiste como wrong_data — el caller no puede
// contradecir el árbol de decisión.
func TestCreatePublicClaim_NormalizesClaimTypeFromCategory(t *testing.T) {
	claimSvc, ts := newClaimSetup()
	ship := mustCreate(t, ts)
	withEligibleClock(t)

	claim, err := claimSvc.CreatePublicClaim(model.CreatePublicClaimRequest{
		TrackingID:      ship.TrackingID,
		Category:        string(CategoryDeliveryProblem),
		DeliverySubtype: string(DeliveryWrongAddress),
		ClaimType:       model.ClaimTypeDamage, // intencionalmente "incorrecto"
		Description:     "La dirección de entrega estaba equivocada",
		CreatedBy:       "Alice Sender",
		DNI:             "12345678",
	}, nil)
	if err != nil {
		t.Fatalf("create claim: %v", err)
	}
	if claim.ClaimType != model.ClaimTypeWrongData {
		t.Fatalf("ClaimType normalizado=%q, esperado wrong_data", claim.ClaimType)
	}
}

// chdir es una mini ayuda para tests que escriben evidencia al disco. Cambia
// el cwd a un tempdir y lo restaura al final.
func chdir(t *testing.T) {
	t.Helper()
	tmp := t.TempDir()
	old, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(old) })
}
