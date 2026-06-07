package mercadopago

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const baseURL = "https://api.mercadopago.com"

// CredentialProvider is called at request time to resolve MP credentials.
// Returns accessToken and webhookSecret. Empty accessToken means not configured.
type CredentialProvider func() (accessToken, webhookSecret string)

type Client struct {
	staticAccessToken   string
	staticWebhookSecret string
	notificationURL     string
	http                *http.Client
	provider            CredentialProvider
}

// NewClient always returns a non-nil Client. Static credentials come from env vars;
// call SetCredentialProvider to layer DB-based credentials on top.
func NewClient(accessToken, webhookSecret, notificationURL string) *Client {
	return &Client{
		staticAccessToken:   accessToken,
		staticWebhookSecret: webhookSecret,
		notificationURL:     notificationURL,
		http:                &http.Client{Timeout: 15 * time.Second},
	}
}

// SetCredentialProvider registers a function that returns live credentials.
// DB credentials take precedence over static env-var credentials when non-empty.
func (c *Client) SetCredentialProvider(fn CredentialProvider) {
	c.provider = fn
}

// IsConfigured reports whether an access token is available from any source.
func (c *Client) IsConfigured() bool {
	at, _ := c.credentials()
	return at != ""
}

func (c *Client) NotificationURL() string { return c.notificationURL }

// credentials resolves the access token and webhook secret to use for this request.
// DB credentials (via provider) take precedence; env vars are the fallback.
func (c *Client) credentials() (accessToken, webhookSecret string) {
	if c.provider != nil {
		at, ws := c.provider()
		if at != "" {
			return at, ws
		}
	}
	return c.staticAccessToken, c.staticWebhookSecret
}

func (c *Client) do(method, path string, body interface{}, out interface{}) error {
	accessToken, _ := c.credentials()
	if accessToken == "" {
		return fmt.Errorf("mercadopago: sin credenciales configuradas")
	}

	var buf io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		buf = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, baseURL+path, buf)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("mercadopago %s %s: status %d — %s", method, path, resp.StatusCode, string(respBody))
	}
	if out != nil {
		return json.Unmarshal(respBody, out)
	}
	return nil
}
