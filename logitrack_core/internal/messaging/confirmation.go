// Package messaging sends WhatsApp notifications to shipment parties via Twilio.
//
// Configuration (environment variables):
//
//	TWILIO_ACCOUNT_SID   – Twilio Account SID. Empty → WhatsApp disabled.
//	TWILIO_AUTH_TOKEN    – Twilio Auth Token.
//	TWILIO_WHATSAPP_FROM – Sender number in "whatsapp:+14155238886" format.
//	TRACK_BASE_URL       – Public tracking portal base URL (shared with email pkg).
package messaging

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
)

// Service sends WhatsApp notifications for shipment events.
type Service struct {
	twilioSID    string
	twilioToken  string
	twilioFrom   string // e.g. "whatsapp:+14155238886"
	trackBaseURL string
}

// New returns a configured Service. If twilioSID is empty, WhatsApp is disabled
// and SendShipmentConfirmationNotification becomes a no-op.
func New(twilioSID, twilioToken, twilioFrom, trackBaseURL string) *Service {
	return &Service{
		twilioSID:    twilioSID,
		twilioToken:  twilioToken,
		twilioFrom:   twilioFrom,
		trackBaseURL: trackBaseURL,
	}
}

func (s *Service) whatsappConfigured() bool {
	return s.twilioSID != "" && s.twilioToken != "" && s.twilioFrom != ""
}

// SendShipmentConfirmationNotification sends WhatsApp confirmation messages to both the
// recipient (CA-03) and the sender (CA-04) when a shipment is registered.
// If a party has no phone or WhatsApp is not configured, that message is silently
// skipped without affecting the other party or the shipment (CA-02).
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendShipmentConfirmationNotification(shipment model.Shipment) {
	if !s.whatsappConfigured() {
		return
	}
	trackURL := ""
	if s.trackBaseURL != "" {
		trackURL = s.trackBaseURL + "/track?id=" + shipment.TrackingID
	}

	// CA-03: notificar al destinatario.
	if shipment.Recipient.Phone != "" {
		msg := buildConfirmationRecipientMsg(shipment, trackURL)
		if err := s.sendWhatsApp(shipment.Recipient.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp confirmación destinatario falló para %s (%s): %v",
				shipment.TrackingID, shipment.Recipient.Phone, err)
		} else {
			log.Printf("[messaging] WhatsApp confirmación destinatario enviado a %s para %s",
				shipment.Recipient.Phone, shipment.TrackingID)
		}
	} else {
		log.Printf("[messaging] destinatario de %s sin teléfono — WhatsApp confirmación omitido (CA-02)", shipment.TrackingID)
	}

	// CA-04: notificar al remitente.
	if shipment.Sender.Phone != "" {
		msg := buildConfirmationSenderMsg(shipment, trackURL)
		if err := s.sendWhatsApp(shipment.Sender.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp confirmación remitente falló para %s (%s): %v",
				shipment.TrackingID, shipment.Sender.Phone, err)
		} else {
			log.Printf("[messaging] WhatsApp confirmación remitente enviado a %s para %s",
				shipment.Sender.Phone, shipment.TrackingID)
		}
	} else {
		log.Printf("[messaging] remitente de %s sin teléfono — WhatsApp confirmación omitido (CA-02)", shipment.TrackingID)
	}
}

func buildConfirmationRecipientMsg(shipment model.Shipment, trackURL string) string {
	packageLabels := map[string]string{"box": "Caja", "envelope": "Sobre"}
	pkgLabel := packageLabels[string(shipment.PackageType)]
	if pkgLabel == "" {
		pkgLabel = string(shipment.PackageType)
	}

	msg := fmt.Sprintf("📦 Tu envío *%s* fue registrado y está en camino.\n\n", shipment.TrackingID)
	msg += fmt.Sprintf("👤 *Remitente:* %s\n", shipment.Sender.Name)
	msg += fmt.Sprintf("📦 *Paquete:* %s · %.1f kg\n", pkgLabel, shipment.WeightKg)
	if shipment.EstimatedDeliveryAt != nil {
		msg += fmt.Sprintf("📅 *Entrega estimada:* %s\n", formatShortDate(*shipment.EstimatedDeliveryAt))
	}
	if trackURL != "" {
		msg += "\nSeguí tu envío en: " + trackURL
	}
	return msg
}

func buildConfirmationSenderMsg(shipment model.Shipment, trackURL string) string {
	msg := fmt.Sprintf("✅ Tu envío *%s* fue registrado exitosamente.\n", shipment.TrackingID)
	if trackURL != "" {
		msg += "\nSeguí tu envío en: " + trackURL
	}
	return msg
}

func formatShortDate(t time.Time) string {
	months := [...]string{
		"ene", "feb", "mar", "abr", "may", "jun",
		"jul", "ago", "sep", "oct", "nov", "dic",
	}
	return fmt.Sprintf("%d de %s de %d", t.Day(), months[t.Month()-1], t.Year())
}

func (s *Service) sendWhatsApp(phone, message string) error {
	apiURL := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", s.twilioSID)

	to := phone
	if !strings.HasPrefix(phone, "whatsapp:") {
		to = "whatsapp:" + toE164Argentina(phone)
	}

	data := url.Values{}
	data.Set("To", to)
	data.Set("From", s.twilioFrom)
	data.Set("Body", message)

	req, err := http.NewRequest(http.MethodPost, apiURL, strings.NewReader(data.Encode()))
	if err != nil {
		return err
	}
	req.SetBasicAuth(s.twilioSID, s.twilioToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("twilio %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// toE164Argentina converts any Argentine phone number to E.164 format (+549XXXXXXXXXX).
func toE164Argentina(raw string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, raw)
	if digits == "" {
		return raw
	}
	if strings.HasPrefix(digits, "549") && len(digits) >= 12 {
		return "+" + digits
	}
	if strings.HasPrefix(digits, "54") {
		local := strings.TrimPrefix(digits, "54")
		local = strings.TrimPrefix(local, "9")
		return "+549" + local
	}
	if strings.HasPrefix(digits, "0") {
		return "+549" + digits[1:]
	}
	return "+549" + digits
}
