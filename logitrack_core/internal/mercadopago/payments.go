package mercadopago

import "fmt"

// MPPayment is a minimal representation of the MP payment resource.
type MPPayment struct {
	ID                int64   `json:"id"`
	Status            string  `json:"status"`
	ExternalReference string  `json:"external_reference"`
	TransactionAmount float64 `json:"transaction_amount"`
	CurrencyID        string  `json:"currency_id"`
}

// GetPayment fetches a payment by its numeric ID.
func (c *Client) GetPayment(mpPaymentID string) (MPPayment, error) {
	var p MPPayment
	if err := c.do("GET", "/v1/payments/"+mpPaymentID, nil, &p); err != nil {
		return MPPayment{}, err
	}
	if p.ID == 0 {
		return MPPayment{}, fmt.Errorf("pago %s no encontrado en Mercado Pago", mpPaymentID)
	}
	return p, nil
}
