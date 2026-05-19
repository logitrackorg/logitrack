package mercadopago

type preferenceItem struct {
	Title       string  `json:"title"`
	Quantity    int     `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
	CurrencyID  string  `json:"currency_id"`
}

type createPreferenceRequest struct {
	Items              []preferenceItem `json:"items"`
	ExternalReference  string           `json:"external_reference"`
	NotificationURL    string           `json:"notification_url"`
}

// CreatePreferenceResponse holds what we need from the MP response.
type CreatePreferenceResponse struct {
	ID              string `json:"id"`
	InitPoint       string `json:"init_point"`
	SandboxInitPoint string `json:"sandbox_init_point"`
}

// CreatePreference posts a new checkout preference to Mercado Pago and returns the URLs.
func (c *Client) CreatePreference(trackingID string, amount float64, currency string) (CreatePreferenceResponse, error) {
	body := createPreferenceRequest{
		Items: []preferenceItem{
			{
				Title:      "Envío LogiTrack " + trackingID,
				Quantity:   1,
				UnitPrice:  amount,
				CurrencyID: currency,
			},
		},
		ExternalReference: trackingID,
		NotificationURL:   c.notificationURL,
	}
	var resp CreatePreferenceResponse
	if err := c.do("POST", "/checkout/preferences", body, &resp); err != nil {
		return CreatePreferenceResponse{}, err
	}
	return resp, nil
}
