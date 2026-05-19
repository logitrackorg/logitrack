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

type Client struct {
	accessToken   string
	webhookSecret string
	notificationURL string
	http          *http.Client
}

// NewClient returns nil when accessToken is empty so callers can detect unconfigured state.
func NewClient(accessToken, webhookSecret, notificationURL string) *Client {
	if accessToken == "" {
		return nil
	}
	return &Client{
		accessToken:     accessToken,
		webhookSecret:   webhookSecret,
		notificationURL: notificationURL,
		http:            &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) NotificationURL() string { return c.notificationURL }

func (c *Client) do(method, path string, body interface{}, out interface{}) error {
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
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
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
