// Package messaging sends out-for-delivery notifications to shipment recipients
// via WhatsApp (primary) with email as fallback (CA-02, CA-03).
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

	"github.com/logitrack/core/internal/model"
)

// RoutingConfigGetter is the minimal interface needed to read time-window hours.
type RoutingConfigGetter interface {
	Get() model.RoutingConfig
}

// LastMileEmailSender is the minimal interface for the email fallback (CA-03).
type LastMileEmailSender interface {
	SendLastMileNotification(recipient model.Customer, trackingID, timeWindowText, trackURL string)
}

// Service sends out-for-delivery notifications to recipients.
type Service struct {
	twilioSID    string
	twilioToken  string
	twilioFrom   string // e.g. "whatsapp:+14155238886"
	trackBaseURL string
	emailSvc     LastMileEmailSender
	routingCfg   RoutingConfigGetter
}

// New returns a Service ready to use.
// twilioSID/twilioToken/twilioFrom may be empty (WhatsApp disabled, falls back to email).
// emailSvc may be nil (email fallback also disabled).
// routingCfg must be non-nil.
func New(twilioSID, twilioToken, twilioFrom, trackBaseURL string, emailSvc LastMileEmailSender, routingCfg RoutingConfigGetter) *Service {
	return &Service{
		twilioSID:    twilioSID,
		twilioToken:  twilioToken,
		twilioFrom:   twilioFrom,
		trackBaseURL: trackBaseURL,
		emailSvc:     emailSvc,
		routingCfg:   routingCfg,
	}
}

// SendOutForDeliveryNotification notifies the recipient that their shipment is out for delivery.
// CA-01: called when shipment transitions to out_for_delivery with delivery_method ultima_milla.
// CA-02: tries WhatsApp first if recipient has a phone number and Twilio is configured.
// CA-03: falls back to email when no phone, Twilio not configured, or WhatsApp call fails.
// CA-06: only the recipient is notified.
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendOutForDeliveryNotification(shipment model.Shipment) {
	cfg := s.routingCfg.Get()
	twText := timeWindowText(shipment.TimeWindow, cfg)
	trackURL := ""
	if s.trackBaseURL != "" {
		trackURL = s.trackBaseURL + "/track?id=" + shipment.TrackingID
	}

	recipient := shipment.Recipient
	sentViaWhatsApp := false

	if recipient.Phone != "" && s.whatsappConfigured() {
		msg := buildWhatsAppMessage(shipment.TrackingID, twText, trackURL)
		if err := s.sendWhatsApp(recipient.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp falló para %s (%s): %v — usando email como fallback (CA-03)", shipment.TrackingID, recipient.Phone, err)
		} else {
			sentViaWhatsApp = true
			log.Printf("[messaging] WhatsApp enviado a %s para %s", recipient.Phone, shipment.TrackingID)
		}
	}

	if !sentViaWhatsApp {
		if recipient.Email == "" {
			log.Printf("[messaging] destinatario de %s sin teléfono ni email — notificación de última milla omitida", shipment.TrackingID)
			return
		}
		if s.emailSvc == nil {
			log.Printf("[messaging] email no configurado — notificación de última milla para %s omitida", shipment.TrackingID)
			return
		}
		s.emailSvc.SendLastMileNotification(recipient, shipment.TrackingID, twText, trackURL)
	}
}

func (s *Service) whatsappConfigured() bool {
	return s.twilioSID != "" && s.twilioToken != "" && s.twilioFrom != ""
}

func (s *Service) sendWhatsApp(phone, message string) error {
	apiURL := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", s.twilioSID)

	to := phone
	if !strings.HasPrefix(phone, "whatsapp:") {
		digits := strings.Map(func(r rune) rune {
			if (r >= '0' && r <= '9') || r == '+' {
				return r
			}
			return -1
		}, phone)
		if !strings.HasPrefix(digits, "+") {
			digits = "+" + digits
		}
		to = "whatsapp:" + digits
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

func buildWhatsAppMessage(trackingID, timeWindowText, trackURL string) string {
	msg := fmt.Sprintf("Tu envío %s está en camino y llegará hoy, %s.", trackingID, timeWindowText)
	if trackURL != "" {
		msg += "\n\nSeguí tu envío en: " + trackURL
	}
	return msg
}

func timeWindowText(tw model.TimeWindow, cfg model.RoutingConfig) string {
	switch tw {
	case "morning":
		return fmt.Sprintf("entre las %d y las %d hs", cfg.MorningWindowStartHour, cfg.MorningWindowEndHour)
	case "afternoon":
		return fmt.Sprintf("entre las %d y las %d hs", cfg.AfternoonWindowStartHour, cfg.AfternoonWindowEndHour)
	default:
		return "a lo largo del día"
	}
}
