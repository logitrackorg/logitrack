package email

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

func TestClaimantCustomer_ByDNI(t *testing.T) {
	shipment := model.Shipment{
		Sender:    model.Customer{DNI: "12345678", Name: "Alice Sender", Email: "alice@example.com"},
		Recipient: model.Customer{DNI: "87654321", Name: "Bob Recipient", Email: "bob@example.com"},
	}
	claim := model.Claim{CreatedBy: "Alice Sender", ClaimantDNI: "12345678"}

	customer, role, ok := ClaimantCustomer(claim, shipment)
	if !ok || role != "remitente" || customer.Email != "alice@example.com" {
		t.Fatalf("expected sender, got ok=%v role=%q email=%q", ok, role, customer.Email)
	}

	claim.ClaimantDNI = "87654321"
	customer, role, ok = ClaimantCustomer(claim, shipment)
	if !ok || role != "destinatario" || customer.Email != "bob@example.com" {
		t.Fatalf("expected recipient, got ok=%v role=%q email=%q", ok, role, customer.Email)
	}
}

func TestClaimantCustomer_FallbackByName(t *testing.T) {
	shipment := model.Shipment{
		Sender:    model.Customer{DNI: "11111111", Name: "Alice Sender", Email: "alice@example.com"},
		Recipient: model.Customer{DNI: "22222222", Name: "Bob Recipient", Email: "bob@example.com"},
	}
	claim := model.Claim{CreatedBy: "Bob Recipient"}

	_, role, ok := ClaimantCustomer(claim, shipment)
	if !ok || role != "destinatario" {
		t.Fatalf("expected recipient by name, got ok=%v role=%q", ok, role)
	}
}
