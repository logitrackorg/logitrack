// Package email provides a transactional email service backed by SMTP.
//
// Configuration (environment variables):
//
//	SMTP_HOST     – SMTP server hostname (e.g. smtp.gmail.com). Empty → email disabled.
//	SMTP_PORT     – Port number (default: 587). Use 465 for implicit TLS.
//	SMTP_USER     – SMTP username / login address.
//	SMTP_PASS     – SMTP password or app-specific password.
//	SMTP_FROM     – Sender display address (e.g. "LogiTrack <noreply@logitrack.com>").
//	               Falls back to SMTP_USER when empty.
//	TRACK_BASE_URL – Public base URL for the tracking portal (e.g. https://track.logitrack.com).
//	               Tracking links are omitted when empty.
//
// Design decisions:
//   - CA-02: Send errors are always silently logged — they never propagate.
//   - CA-03: Reply-To is set from OrganizationConfig.Email.
//   - CA-04: Parties without a registered email are silently skipped with a log entry.
package email

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

// BranchAddressString formats a Branch address into a single human-readable line.
func BranchAddressString(b model.Branch) string {
	parts := []string{}
	if b.Address.Street != "" {
		parts = append(parts, b.Address.Street)
	}
	if b.Address.City != "" {
		parts = append(parts, b.Address.City)
	}
	if b.Address.Province != "" {
		parts = append(parts, b.Address.Province)
	}
	if b.Address.PostalCode != "" {
		parts = append(parts, b.Address.PostalCode)
	}
	return strings.Join(parts, ", ")
}

// OrgConfigProvider is the minimal interface this package needs to render
// the org name, contact info, and reply-to address in every email.
type OrgConfigProvider interface {
	Get() (*model.OrganizationConfig, error)
}

// Config holds SMTP connection parameters loaded from environment variables.
type Config struct {
	Host         string
	Port         int
	Username     string
	Password     string
	From         string // e.g. "LogiTrack <noreply@logitrack.com>"
	TrackBaseURL string // public tracking portal base URL (may be empty)
}

// Service sends transactional HTML emails via SMTP.
// A nil *Service is safe to call — all methods become no-ops so that code that
// receives an unconfigured service does not need nil-checks at every call site.
type Service struct {
	cfg    Config
	orgSvc OrgConfigProvider
}

// New returns a ready-to-use *Service. Returns nil when cfg.Host is empty so
// callers can decide to skip wiring altogether.
func New(cfg Config, orgSvc OrgConfigProvider) *Service {
	if cfg.Host == "" {
		return nil
	}
	if cfg.Port == 0 {
		cfg.Port = 587
	}
	if cfg.From == "" {
		cfg.From = cfg.Username
	}
	return &Service{cfg: cfg, orgSvc: orgSvc}
}

// SendShipmentConfirmation sends confirmation emails to the shipment's recipient
// and sender (each independently, CA-02). Parties without an email address are
// silently skipped (CA-04). The method is intended to be called as a goroutine.
func (s *Service) SendShipmentConfirmation(shipment model.Shipment) {
	if s == nil {
		return
	}
	org := s.orgConfig()
	trackBase := s.effectiveTrackBaseURL(org)

	// --- Email al destinatario (CA-03) ---
	if shipment.Recipient.Email != "" {
		subj := fmt.Sprintf("Tu envío %s está en camino — %s", shipment.TrackingID, org.Name)
		body := renderRecipientConfirmation(shipment, org, trackBase)
		s.sendOne(shipment.Recipient.Email, subj, body, shipment.TrackingID, "destinatario", org.Email)
	} else {
		log.Printf("[email] confirmación de envío: destinatario de %s sin email registrado — omitido (CA-04)", shipment.TrackingID)
	}

	// --- Email al remitente (CA-04) ---
	if shipment.Sender.Email != "" {
		subj := fmt.Sprintf("Tu envío %s fue registrado en %s", shipment.TrackingID, org.Name)
		body := renderSenderConfirmation(shipment, org, trackBase)
		s.sendOne(shipment.Sender.Email, subj, body, shipment.TrackingID, "remitente", org.Email)
	} else {
		log.Printf("[email] confirmación de envío: remitente de %s sin email registrado — omitido (CA-04)", shipment.TrackingID)
	}
}

// SendLastMileNotification sends an out-for-delivery notification email to the recipient.
// Used as fallback when WhatsApp is unavailable or fails (CA-03).
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendLastMileNotification(recipient model.Customer, trackingID, timeWindowText, trackURL string) {
	if s == nil {
		return
	}
	if recipient.Email == "" {
		log.Printf("[email] última milla: destinatario de %s sin email registrado — omitido", trackingID)
		return
	}
	org := s.orgConfig()
	subj := fmt.Sprintf("Tu envío %s está en camino — llegará hoy", trackingID)
	body := renderLastMileNotification(trackingID, timeWindowText, trackURL, org)
	s.sendOne(recipient.Email, subj, body, trackingID, "destinatario (última milla)", org.Email)
}

// SendReadyForPickupNotification sends an email to the recipient when their shipment
// is ready to be picked up at a branch. Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendReadyForPickupNotification(shipment model.Shipment, branch model.Branch, deadlineDate *time.Time) {
	if s == nil {
		return
	}
	if shipment.Recipient.Email == "" {
		log.Printf("[email] retiro en sucursal: destinatario de %s sin email registrado — omitido (CA-04)", shipment.TrackingID)
		return
	}
	org := s.orgConfig()
	branchAddr := BranchAddressString(branch)
	trackURL := buildTrackURL(s.effectiveTrackBaseURL(org), shipment.TrackingID)
	subj := fmt.Sprintf("Tu envío %s está listo para retirar en sucursal", shipment.TrackingID)
	body := renderReadyForPickupNotification(shipment, branch.Name, branchAddr, branch.Hours, deadlineDate, trackURL, org)
	s.sendOne(shipment.Recipient.Email, subj, body, shipment.TrackingID, "destinatario (retiro en sucursal)", org.Email)
}

// SendDeliveryConfirmedNotification sends a delivery confirmation email to the shipment's sender.
// CA-01: called when a shipment transitions to "delivered".
// CA-02: only the sender is notified; the recipient does not receive this email.
// CA-03: includes tracking ID, recipient name, delivery date/time, and a link to the shipment.
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendDeliveryConfirmedNotification(shipment model.Shipment) {
	if s == nil {
		return
	}
	if shipment.Sender.Email == "" {
		log.Printf("[email] entrega confirmada: remitente de %s sin email registrado — omitido (CA-04)", shipment.TrackingID)
		return
	}
	org := s.orgConfig()
	trackURL := buildTrackURL(s.effectiveTrackBaseURL(org), shipment.TrackingID)
	deliveredAt := time.Now().UTC()
	if shipment.DeliveredAt != nil {
		deliveredAt = *shipment.DeliveredAt
	}
	subj := fmt.Sprintf("Tu envío %s fue entregado exitosamente — %s", shipment.TrackingID, org.Name)
	body := renderDeliveryConfirmedNotification(shipment, deliveredAt, trackURL, org)
	s.sendOne(shipment.Sender.Email, subj, body, shipment.TrackingID, "remitente (entrega confirmada)", org.Email)
}

// SendDeliveryFailedNotification sends a failed-delivery notification email to the shipment's
// recipient. Called on every delivery_failed transition (CA-01/CA-02).
// When attemptsUsed < maxAttempts the email indicates remaining attempts and branch pickup option (CA-03).
// When attemptsUsed >= maxAttempts the email indicates pickup-only with branch details (CA-04).
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendDeliveryFailedNotification(shipment model.Shipment, attemptsUsed, maxAttempts int, branch model.Branch) {
	if s == nil {
		return
	}
	if shipment.Recipient.Email == "" {
		log.Printf("[email] entrega fallida: destinatario de %s sin email registrado — email omitido", shipment.TrackingID)
		return
	}
	org := s.orgConfig()
	trackURL := buildTrackURL(s.effectiveTrackBaseURL(org), shipment.TrackingID)
	branchAddr := BranchAddressString(branch)
	attemptsLeft := maxAttempts - attemptsUsed
	if attemptsLeft < 0 {
		attemptsLeft = 0
	}
	attemptDate := formatDeliveredAt(time.Now().UTC())
	subj := fmt.Sprintf("No pudimos entregar tu envío %s — %s", shipment.TrackingID, org.Name)
	body := renderDeliveryFailedNotification(shipment, attemptDate, attemptsLeft, maxAttempts, branch.Name, branchAddr, branch.Hours, trackURL, org)
	s.sendOne(shipment.Recipient.Email, subj, body, shipment.TrackingID, "destinatario (entrega fallida)", org.Email)
}

// SendRejectedNotification sends a rejection notification email to the shipment's sender.
// CA-01: called when a shipment transitions to "rechazado".
// CA-02: only the sender is notified.
// CA-03: includes tracking ID, rejection reason, date/time, and branch contact instructions.
// Intended to be called as a goroutine (fire-and-forget).
func (s *Service) SendRejectedNotification(shipment model.Shipment, notes string) {
	if s == nil {
		return
	}
	if shipment.Sender.Email == "" {
		log.Printf("[email] rechazo: remitente de %s sin email registrado — omitido (CA-04)", shipment.TrackingID)
		return
	}
	org := s.orgConfig()
	trackURL := buildTrackURL(s.effectiveTrackBaseURL(org), shipment.TrackingID)
	rejectedAt := time.Now().UTC()
	subj := fmt.Sprintf("Tu envío %s fue rechazado por el destinatario — %s", shipment.TrackingID, org.Name)
	body := renderRejectedNotification(shipment, notes, rejectedAt, trackURL, org)
	s.sendOne(shipment.Sender.Email, subj, body, shipment.TrackingID, "remitente (rechazo)", org.Email)
}

// SendPasswordResetOTP sends a 6-digit OTP code to the user's email address for password reset.
// Errors are logged and swallowed (fire-and-forget). Intended to be called as a goroutine.
func (s *Service) SendPasswordResetOTP(to, username, otp string) {
	if s == nil {
		return
	}
	if to == "" {
		log.Printf("[email] password reset OTP: dirección de email vacía para %s — omitido", username)
		return
	}
	org := s.orgConfig()
	body := renderPasswordResetOTP(username, otp, org)
	s.sendOne(to, "Tu código de verificación — LogiTrack", body, "", "password reset", org.Email)
}

// SendPasswordChangedNotification sends a security notice to the user when their password
// is changed successfully. Errors are logged and swallowed (fire-and-forget).
func (s *Service) SendPasswordChangedNotification(to, username string) {
	if s == nil {
		return
	}
	if to == "" {
		log.Printf("[email] password changed: dirección de email vacía para %s — omitido", username)
		return
	}
	org := s.orgConfig()
	body := renderPasswordChanged(username, org)
	s.sendOne(to, "Tu contraseña fue modificada — LogiTrack", body, "", "password changed", org.Email)
}

// sendOne sends a single HTML email. All errors are logged and swallowed (CA-02).
func (s *Service) sendOne(to, subject, htmlBody, trackingID, role, replyTo string) {
	if err := s.send(to, subject, htmlBody, replyTo); err != nil {
		log.Printf("[email] ERROR al enviar confirmación a %s (%s) para %s: %v (CA-02 — evento no afectado)",
			to, role, trackingID, err)
		return
	}
	log.Printf("[email] confirmación enviada a %s (%s) para %s", to, role, trackingID)
}

// send builds and delivers a single HTML email via SMTP.
func (s *Service) send(to, subject, htmlBody, replyTo string) error {
	from := s.cfg.From
	fromAddr := extractAddr(from)

	headers := map[string]string{
		"From":         from,
		"To":           to,
		"Subject":      subject,
		"MIME-Version": "1.0",
		"Content-Type": "text/html; charset=UTF-8",
		"Date":         clock.Now().UTC().Format(time.RFC1123Z),
	}
	if replyTo != "" && replyTo != fromAddr {
		headers["Reply-To"] = replyTo
	}

	var sb strings.Builder
	for k, v := range headers {
		sb.WriteString(k)
		sb.WriteString(": ")
		sb.WriteString(v)
		sb.WriteString("\r\n")
	}
	sb.WriteString("\r\n")
	sb.WriteString(htmlBody)
	msg := []byte(sb.String())

	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)

	if s.cfg.Port == 465 {
		return s.sendTLS(addr, fromAddr, to, msg)
	}
	return s.sendSTARTTLS(addr, fromAddr, to, msg)
}

// sendSTARTTLS connects with STARTTLS (port 587 typical).
func (s *Service) sendSTARTTLS(addr, fromAddr, to string, msg []byte) error {
	auth := smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	return smtp.SendMail(addr, auth, fromAddr, []string{to}, msg)
}

// sendTLS connects with implicit TLS (port 465 typical).
func (s *Service) sendTLS(addr, fromAddr, to string, msg []byte) error {
	host, _, _ := net.SplitHostPort(addr)
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return err
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer c.Close()
	auth := smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, host)
	if err := c.Auth(auth); err != nil {
		return err
	}
	if err := c.Mail(fromAddr); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	return w.Close()
}

// orgConfig fetches OrganizationConfig and returns safe defaults on error.
func (s *Service) orgConfig() model.OrganizationConfig {
	if s.orgSvc == nil {
		return model.OrganizationConfig{}
	}
	cfg, err := s.orgSvc.Get()
	if err != nil || cfg == nil {
		log.Printf("[email] no se pudo obtener la config de la organización: %v", err)
		return model.OrganizationConfig{}
	}
	return *cfg
}

// effectiveTrackBaseURL returns the tracking portal base URL for use in email links.
// Prefers OrganizationConfig.TrackURL when set; falls back to the env-supplied value.
func (s *Service) effectiveTrackBaseURL(org model.OrganizationConfig) string {
	if org.TrackURL != "" {
		return org.TrackURL
	}
	return s.cfg.TrackBaseURL
}

// extractAddr returns the bare email address from a display-name formatted string.
// e.g. "LogiTrack <noreply@example.com>" → "noreply@example.com"
func extractAddr(from string) string {
	start := strings.LastIndex(from, "<")
	end := strings.LastIndex(from, ">")
	if start >= 0 && end > start {
		return from[start+1 : end]
	}
	return from
}
