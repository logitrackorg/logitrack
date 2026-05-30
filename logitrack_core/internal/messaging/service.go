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
	"time"

	"github.com/logitrack/core/internal/model"
)

// OrgConfigProvider is the minimal interface needed to read the organization's track URL.
type OrgConfigProvider interface {
	Get() (*model.OrganizationConfig, error)
}

// RoutingConfigGetter is the minimal interface needed to read time-window hours.
type RoutingConfigGetter interface {
	Get() model.RoutingConfig
}

// SystemConfigGetter is the minimal interface needed to check the force-email flag.
type SystemConfigGetter interface {
	Get() model.SystemConfig
}

// LastMileEmailSender is the minimal interface for the email fallback (CA-03).
type LastMileEmailSender interface {
	SendLastMileNotification(recipient model.Customer, trackingID, timeWindowText, trackURL string)
}

// PickupEmailFallback is the minimal interface for the email fallback on ready-for-pickup.
type PickupEmailFallback interface {
	SendReadyForPickupNotification(shipment model.Shipment, branch model.Branch, deadlineDate *time.Time)
}

// DeliveryConfirmedEmailFallback is the minimal interface for the email fallback on delivery confirmed.
type DeliveryConfirmedEmailFallback interface {
	SendDeliveryConfirmedNotification(shipment model.Shipment)
}

// RejectedEmailFallback is the minimal interface for the email fallback on shipment rejected.
type RejectedEmailFallback interface {
	SendRejectedNotification(shipment model.Shipment, notes string)
}

// DeliveryFailedEmailSender is the interface for sending delivery-failed emails to the recipient.
// CA-02: email always fires (not a fallback — both WhatsApp and email fire independently).
type DeliveryFailedEmailSender interface {
	SendDeliveryFailedNotification(shipment model.Shipment, attemptsUsed, maxAttempts int, branch model.Branch)
}

// Service sends out-for-delivery notifications to recipients.
type Service struct {
	twilioSID              string
	twilioToken            string
	twilioFrom             string // e.g. "whatsapp:+14155238886"
	trackBaseURLEnv        string
	orgSvc                 OrgConfigProvider
	emailSvc               LastMileEmailSender
	pickupEmailSvc         PickupEmailFallback
	deliveryEmailSvc       DeliveryConfirmedEmailFallback
	rejectedEmailSvc       RejectedEmailFallback
	deliveryFailedEmailSvc DeliveryFailedEmailSender
	routingCfg             RoutingConfigGetter
	sysConfig              SystemConfigGetter
}

// New returns a Service ready to use.
// twilioSID/twilioToken/twilioFrom may be empty (WhatsApp disabled, falls back to email).
// emailSvc may be nil (email fallback also disabled).
// routingCfg must be non-nil.
// orgSvc is used to read TrackURL at send time; falls back to trackBaseURL when orgSvc is nil or TrackURL is empty.
func New(twilioSID, twilioToken, twilioFrom, trackBaseURL string, emailSvc LastMileEmailSender, routingCfg RoutingConfigGetter, orgSvc OrgConfigProvider) *Service {
	return &Service{
		twilioSID:       twilioSID,
		twilioToken:     twilioToken,
		twilioFrom:      twilioFrom,
		trackBaseURLEnv: trackBaseURL,
		orgSvc:          orgSvc,
		emailSvc:        emailSvc,
		routingCfg:      routingCfg,
	}
}

// trackBaseURL returns the effective tracking portal base URL.
// Prefers OrganizationConfig.TrackURL when set; falls back to the env-supplied value.
func (s *Service) trackBaseURL() string {
	if s.orgSvc != nil {
		if cfg, err := s.orgSvc.Get(); err == nil && cfg != nil && cfg.TrackURL != "" {
			return cfg.TrackURL
		}
	}
	return s.trackBaseURLEnv
}

// SetPickupEmailFallback wires the email service used when WhatsApp is unavailable
// for ready-for-pickup notifications.
func (s *Service) SetPickupEmailFallback(svc PickupEmailFallback) { s.pickupEmailSvc = svc }

// SetDeliveryConfirmedEmailFallback wires the email service used when WhatsApp is unavailable
// for delivery-confirmed notifications to the sender.
func (s *Service) SetDeliveryConfirmedEmailFallback(svc DeliveryConfirmedEmailFallback) {
	s.deliveryEmailSvc = svc
}

// SetRejectedEmailFallback wires the email service used when WhatsApp is unavailable
// for rejected-shipment notifications to the sender.
func (s *Service) SetRejectedEmailFallback(svc RejectedEmailFallback) {
	s.rejectedEmailSvc = svc
}

// SetSystemConfigGetter wires the system config reader so the service can check
// the force_email_notifications flag at send time.
func (s *Service) SetSystemConfigGetter(g SystemConfigGetter) { s.sysConfig = g }

// SetDeliveryFailedEmailService wires the email service for delivery-failed notifications.
// Unlike other notifications, email always fires here (not a fallback — CA-02).
func (s *Service) SetDeliveryFailedEmailService(svc DeliveryFailedEmailSender) {
	s.deliveryFailedEmailSvc = svc
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
	if base := s.trackBaseURL(); base != "" {
		trackURL = base + "/track?id=" + shipment.TrackingID
	}

	recipient := shipment.Recipient
	sentViaWhatsApp := false

	if !s.forceEmail() && recipient.Phone != "" && s.whatsappConfigured() {
		msg := buildWhatsAppMessage(shipment.TrackingID, twText, trackURL)
		if err := s.sendWhatsApp(recipient.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp falló para %s (%s): %v — usando email como fallback (CA-03)", shipment.TrackingID, recipient.Phone, err)
		} else {
			sentViaWhatsApp = true
			log.Printf("[messaging] WhatsApp enviado a %s para %s", recipient.Phone, shipment.TrackingID)
		}
	} else if s.forceEmail() {
		log.Printf("[messaging] force_email_notifications activo — saltando WhatsApp para %s", shipment.TrackingID)
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

// SendReadyForPickupNotification notifies the recipient that their shipment is ready
// to be picked up at a branch office.
// CA-01: called when shipment transitions to ready_for_pickup with delivery_method retiro_sucursal.
// CA-02: tries WhatsApp first if recipient has a phone number and Twilio is configured.
// CA-03: falls back to email when no phone, Twilio not configured, or WhatsApp call fails.
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendReadyForPickupNotification(shipment model.Shipment, branch model.Branch, deadlineDate *time.Time) {
	trackURL := ""
	if base := s.trackBaseURL(); base != "" {
		trackURL = base + "/track?id=" + shipment.TrackingID
	}

	recipient := shipment.Recipient
	sentViaWhatsApp := false

	if !s.forceEmail() && recipient.Phone != "" && s.whatsappConfigured() {
		msg := buildPickupWhatsAppMessage(shipment.TrackingID, branch, deadlineDate, trackURL)
		if err := s.sendWhatsApp(recipient.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp pickup falló para %s (%s): %v — usando email como fallback", shipment.TrackingID, recipient.Phone, err)
		} else {
			sentViaWhatsApp = true
			log.Printf("[messaging] WhatsApp pickup enviado a %s para %s", recipient.Phone, shipment.TrackingID)
		}
	}

	if !sentViaWhatsApp {
		if s.pickupEmailSvc == nil {
			log.Printf("[messaging] destinatario de %s sin teléfono y sin email configurado — notificación de retiro omitida", shipment.TrackingID)
			return
		}
		s.pickupEmailSvc.SendReadyForPickupNotification(shipment, branch, deadlineDate)
	}
}

// SendDeliveryConfirmedNotification notifies the sender that their shipment was delivered.
// CA-01: called when shipment transitions to delivered.
// CA-02: only the sender is notified; the recipient does not receive this message.
// CA-03: content includes tracking ID, recipient name, delivery date/time, and tracking URL.
// Tries WhatsApp first (CA-02); falls back to email when unavailable (CA-03).
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendDeliveryConfirmedNotification(shipment model.Shipment) {
	sender := shipment.Sender
	sentViaWhatsApp := false

	if !s.forceEmail() && sender.Phone != "" && s.whatsappConfigured() {
		msg := buildDeliveryConfirmedWhatsAppMessage(shipment, s.trackBaseURL())
		if err := s.sendWhatsApp(sender.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp entrega confirmada falló para %s (%s): %v — usando email como fallback",
				shipment.TrackingID, sender.Phone, err)
		} else {
			sentViaWhatsApp = true
			log.Printf("[messaging] WhatsApp entrega confirmada enviado a %s para %s", sender.Phone, shipment.TrackingID)
		}
	}

	if !sentViaWhatsApp {
		if s.deliveryEmailSvc == nil {
			log.Printf("[messaging] sin canal disponible para notificar entrega de %s al remitente — omitido", shipment.TrackingID)
			return
		}
		s.deliveryEmailSvc.SendDeliveryConfirmedNotification(shipment)
	}
}

func (s *Service) whatsappConfigured() bool {
	return s.twilioSID != "" && s.twilioToken != "" && s.twilioFrom != ""
}

// forceEmail returns true when the admin has enabled force_email_notifications,
// which causes all send methods to skip WhatsApp and go directly to email.
func (s *Service) forceEmail() bool {
	if s.sysConfig == nil {
		return false
	}
	return s.sysConfig.Get().ForceEmailNotifications
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
// Handles: already-E164 (+549...), digits-only (local 10-digit), with leading 0, etc.
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
	// Already full international with mobile 9 prefix
	if strings.HasPrefix(digits, "549") && len(digits) >= 12 {
		return "+" + digits
	}
	// Has country code 54 but missing mobile 9
	if strings.HasPrefix(digits, "54") {
		local := strings.TrimPrefix(digits, "54")
		local = strings.TrimPrefix(local, "9") // avoid double 9
		return "+549" + local
	}
	// Local with leading 0 (e.g. 011...)
	if strings.HasPrefix(digits, "0") {
		return "+549" + digits[1:]
	}
	// Bare local number
	return "+549" + digits
}

func buildPickupWhatsAppMessage(trackingID string, branch model.Branch, deadlineDate *time.Time, trackURL string) string {
	msg := fmt.Sprintf("📦 Tu envío *%s* está listo para retirar en sucursal.\n\n", trackingID)
	msg += fmt.Sprintf("🏢 *Sucursal:* %s\n", branch.Name)
	if branch.Address.Street != "" || branch.Address.City != "" {
		addr := branch.Address.Street
		if branch.Address.City != "" {
			if addr != "" {
				addr += ", "
			}
			addr += branch.Address.City
		}
		msg += fmt.Sprintf("📍 *Dirección:* %s\n", addr)
	}
	if branch.Hours != "" {
		msg += fmt.Sprintf("🕐 *Horarios:* %s\n", branch.Hours)
	}
	if deadlineDate != nil {
		msg += fmt.Sprintf("⚠️ *Retirá antes del:* %d/%d/%d\n", deadlineDate.Day(), deadlineDate.Month(), deadlineDate.Year())
	}
	msg += "\nPresentate con tu DNI para retirar el paquete."
	if trackURL != "" {
		msg += "\n\nSeguí tu envío en: " + trackURL
	}
	return msg
}

func buildDeliveryConfirmedWhatsAppMessage(shipment model.Shipment, trackBaseURL string) string {
	deliveredAt := time.Now().UTC()
	if shipment.DeliveredAt != nil {
		deliveredAt = *shipment.DeliveredAt
	}
	months := [...]string{
		"enero", "febrero", "marzo", "abril", "mayo", "junio",
		"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
	}
	dateStr := fmt.Sprintf("%d de %s de %d, %02d:%02d hs",
		deliveredAt.Day(), months[deliveredAt.Month()-1], deliveredAt.Year(),
		deliveredAt.Hour(), deliveredAt.Minute())

	msg := fmt.Sprintf("✅ Tu envío *%s* fue entregado exitosamente.\n\n", shipment.TrackingID)
	msg += fmt.Sprintf("👤 *Recibido por:* %s\n", shipment.Recipient.Name)
	msg += fmt.Sprintf("🕐 *Fecha y hora:* %s\n", dateStr)
	trackURL := ""
	if trackBaseURL != "" {
		trackURL = trackBaseURL + "/track?id=" + shipment.TrackingID
	}
	if trackURL != "" {
		msg += "\nVer detalle del envío: " + trackURL
	}
	return msg
}

// SendRejectedNotification notifies the sender that the recipient rejected their shipment.
// CA-01: called when shipment transitions to rechazado.
// CA-02: only the sender is notified.
// CA-03: includes tracking ID, rejection reason, date/time, and branch contact instructions.
// Tries WhatsApp first; falls back to email when unavailable.
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendRejectedNotification(shipment model.Shipment, notes string) {
	sender := shipment.Sender
	sentViaWhatsApp := false

	if !s.forceEmail() && sender.Phone != "" && s.whatsappConfigured() {
		msg := buildRejectedWhatsAppMessage(shipment, notes, s.trackBaseURL())
		if err := s.sendWhatsApp(sender.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp rechazo falló para %s (%s): %v — usando email como fallback",
				shipment.TrackingID, sender.Phone, err)
		} else {
			sentViaWhatsApp = true
			log.Printf("[messaging] WhatsApp rechazo enviado a %s para %s", sender.Phone, shipment.TrackingID)
		}
	}

	if !sentViaWhatsApp {
		if s.rejectedEmailSvc == nil {
			log.Printf("[messaging] sin canal disponible para notificar rechazo de %s al remitente — omitido", shipment.TrackingID)
			return
		}
		s.rejectedEmailSvc.SendRejectedNotification(shipment, notes)
	}
}

func buildRejectedWhatsAppMessage(shipment model.Shipment, notes string, trackBaseURL string) string {
	now := time.Now().UTC()
	months := [...]string{
		"enero", "febrero", "marzo", "abril", "mayo", "junio",
		"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
	}
	dateStr := fmt.Sprintf("%d de %s de %d, %02d:%02d hs",
		now.Day(), months[now.Month()-1], now.Year(), now.Hour(), now.Minute())

	msg := fmt.Sprintf("🚫 Tu envío *%s* fue rechazado por el destinatario.\n\n", shipment.TrackingID)
	if notes != "" {
		msg += fmt.Sprintf("📋 *Motivo:* %s\n", notes)
	}
	msg += fmt.Sprintf("🕐 *Fecha y hora:* %s\n", dateStr)
	msg += "\nEl envío está siendo devuelto. Contactate con tu sucursal más cercana para coordinar una solución."
	if trackBaseURL != "" {
		msg += "\n\nSeguí tu envío en: " + trackBaseURL + "/track?id=" + shipment.TrackingID
	}
	return msg
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

// ── Entrega fallida (LOGITRACK-437) ───────────────────────────────────────────

// SendDeliveryFailedNotification notifies the recipient that their shipment could not be delivered.
// CA-01: called when shipment transitions to delivery_failed.
// CA-02: BOTH channels fire independently — email always + WhatsApp if recipient has phone.
// CA-03: when attempts remain, message includes remaining count and branch pickup option.
// CA-04: when attempts exhausted, message indicates pickup-only with branch details.
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendDeliveryFailedNotification(shipment model.Shipment, attemptsUsed, maxAttempts int, branch model.Branch) {
	trackURL := ""
	if base := s.trackBaseURL(); base != "" {
		trackURL = base + "/track?id=" + shipment.TrackingID
	}

	// CA-02: WhatsApp si el destinatario tiene teléfono (independiente del email), salvo force_email.
	if !s.forceEmail() && shipment.Recipient.Phone != "" && s.whatsappConfigured() {
		msg := buildDeliveryFailedWhatsAppMessage(shipment, attemptsUsed, maxAttempts, branch, trackURL)
		if err := s.sendWhatsApp(shipment.Recipient.Phone, msg); err != nil {
			log.Printf("[messaging] WhatsApp entrega fallida falló para %s (%s): %v",
				shipment.TrackingID, shipment.Recipient.Phone, err)
		} else {
			log.Printf("[messaging] WhatsApp entrega fallida enviado a %s para %s",
				shipment.Recipient.Phone, shipment.TrackingID)
		}
	}

	// CA-02: email siempre (no es fallback — se envía aunque WhatsApp haya funcionado).
	if s.deliveryFailedEmailSvc != nil {
		s.deliveryFailedEmailSvc.SendDeliveryFailedNotification(shipment, attemptsUsed, maxAttempts, branch)
	} else {
		log.Printf("[messaging] email entrega fallida no configurado para %s — email omitido", shipment.TrackingID)
	}
}

func buildDeliveryFailedWhatsAppMessage(shipment model.Shipment, attemptsUsed, maxAttempts int, branch model.Branch, trackURL string) string {
	now := time.Now().UTC()
	months := [...]string{
		"enero", "febrero", "marzo", "abril", "mayo", "junio",
		"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
	}
	dateStr := fmt.Sprintf("%d de %s de %d", now.Day(), months[now.Month()-1], now.Year())
	attemptsLeft := maxAttempts - attemptsUsed

	msg := fmt.Sprintf("📦 No pudimos entregar tu envío *%s* el %s.\n\n", shipment.TrackingID, dateStr)

	if attemptsLeft > 0 {
		msg += fmt.Sprintf("⚠️ *Intentos restantes:* %d de %d\n", attemptsLeft, maxAttempts)
		msg += "Coordinaremos un nuevo intento automáticamente.\n"
	} else {
		msg += "❌ *Se agotaron los intentos de entrega.*\n"
	}

	msg += fmt.Sprintf("\n🏢 *Retiro en sucursal:* %s", branch.Name)
	if branch.Address.Street != "" || branch.Address.City != "" {
		addr := branch.Address.Street
		if branch.Address.City != "" {
			if addr != "" {
				addr += ", "
			}
			addr += branch.Address.City
		}
		msg += fmt.Sprintf("\n📍 *Dirección:* %s", addr)
	}
	if branch.Hours != "" {
		msg += fmt.Sprintf("\n🕐 *Horarios:* %s", branch.Hours)
	}
	msg += "\nPresentate con tu DNI para retirar el paquete."

	if trackURL != "" {
		msg += "\n\nSeguí tu envío en: " + trackURL
	}
	return msg
}

// ── Confirmación de registro (LOGITRACK-406) ──────────────────────────────────

// SendShipmentConfirmationNotification sends WhatsApp confirmation messages to both the
// recipient (CA-03) and the sender (CA-04) when a shipment is registered.
// If a party has no phone or WhatsApp is not configured, that message is silently
// skipped without affecting the other party or the shipment (CA-02).
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendShipmentConfirmationNotification(shipment model.Shipment) {
	if !s.whatsappConfigured() || s.forceEmail() {
		return
	}
	trackURL := ""
	if base := s.trackBaseURL(); base != "" {
		trackURL = base + "/track?id=" + shipment.TrackingID
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
