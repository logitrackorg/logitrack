package mercadopago

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

// ValidateSignature verifies the x-signature header sent by Mercado Pago.
// xSignature format: "ts=<timestamp>,v1=<hex-hash>"
// Manifest: "id:<dataID>;request-id:<xRequestID>;ts:<ts>;"
func (c *Client) ValidateSignature(xSignature, xRequestID, dataID string) error {
	if c.webhookSecret == "" || os.Getenv("MP_SKIP_SIGNATURE") == "true" {
		return nil
	}

	var ts, v1 string
	for _, part := range strings.Split(xSignature, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "ts":
			ts = kv[1]
		case "v1":
			v1 = kv[1]
		}
	}
	if ts == "" || v1 == "" {
		return fmt.Errorf("x-signature mal formado")
	}

	manifest := fmt.Sprintf("id:%s;request-id:%s;ts:%s;", dataID, xRequestID, ts)
	mac := hmac.New(sha256.New, []byte(c.webhookSecret))
	mac.Write([]byte(manifest))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(v1)) {
		return fmt.Errorf("firma inválida")
	}
	return nil
}
