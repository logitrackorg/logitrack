package email

import (
	"strings"

	"github.com/logitrack/core/internal/model"
)

// ClaimantCustomer returns the shipment party (sender or recipient) who filed the claim.
func ClaimantCustomer(claim model.Claim, shipment model.Shipment) (model.Customer, string, bool) {
	dni := strings.TrimSpace(claim.ClaimantDNI)
	if dni != "" {
		if strings.TrimSpace(shipment.Sender.DNI) == dni {
			return shipment.Sender, "remitente", true
		}
		if strings.TrimSpace(shipment.Recipient.DNI) == dni {
			return shipment.Recipient, "destinatario", true
		}
		return model.Customer{}, "", false
	}
	name := normalizeClaimantName(claim.CreatedBy)
	if name == "" {
		return model.Customer{}, "", false
	}
	if normalizeClaimantName(shipment.Sender.Name) == name {
		return shipment.Sender, "remitente", true
	}
	if normalizeClaimantName(shipment.Recipient.Name) == name {
		return shipment.Recipient, "destinatario", true
	}
	return model.Customer{}, "", false
}

func normalizeClaimantName(name string) string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(name)))
	return strings.Join(fields, " ")
}
