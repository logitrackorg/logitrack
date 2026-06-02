package email

import (
	"strings"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
)

func TestRenderRecipientConfirmationIncludesClaimHint(t *testing.T) {
	shipment := model.Shipment{
		TrackingID:          "LT-1234ABCD",
		Sender:              model.Customer{Name: "Remitente"},
		Recipient:           model.Customer{Name: "Destinatario"},
		WeightKg:            2.5,
		PackageType:         model.PackageBox,
		EstimatedDeliveryAt: ptrTime(time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)),
	}
	org := model.OrganizationConfig{Name: "LogiTrack", Address: "Av. Siempre Viva 742", Phone: "11 5555-5555", Email: "hola@logitrack.test"}
	body := renderRecipientConfirmation(shipment, org, "https://logitrack.test")

	assertContains(t, body, "Si necesitás ayuda, podés realizar un reclamo desde la página de seguimiento")
	assertContains(t, body, "href=\"https://logitrack.test/track?id=LT-1234ABCD\"")
	assertContains(t, body, ">/track<")
}

func TestRenderSenderConfirmationIncludesClaimHint(t *testing.T) {
	shipment := model.Shipment{
		TrackingID: "LT-1234ABCD",
		Sender:     model.Customer{Name: "Remitente"},
		Recipient:  model.Customer{Name: "Destinatario"},
	}
	org := model.OrganizationConfig{Name: "LogiTrack", Address: "Av. Siempre Viva 742", Phone: "11 5555-5555", Email: "hola@logitrack.test"}
	body := renderSenderConfirmation(shipment, org, "https://logitrack.test")

	assertContains(t, body, "Si necesitás ayuda, podés realizar un reclamo desde la página de seguimiento")
	assertContains(t, body, "href=\"https://logitrack.test/track?id=LT-1234ABCD\"")
	assertContains(t, body, ">/track<")
}

func ptrTime(t time.Time) *time.Time {
	return &t
}

func assertContains(t *testing.T, body, want string) {
	t.Helper()
	if !strings.Contains(body, want) {
		t.Fatalf("expected body to contain %q, got:\n%s", want, body)
	}
}
