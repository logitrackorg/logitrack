package email

import (
	"bytes"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/logitrack/core/internal/model"
)

// ─── Base template (CA-01) ────────────────────────────────────────────────────
// All emails share this wrapper: org name in the header, contact info in the footer.

const baseTmplSrc = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{.Subject}}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header (CA-01) -->
        <tr>
          <td style="background:#1e3a5f;padding:28px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">
              {{.OrgName}}
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            {{.Body}}
          </td>
        </tr>

        <!-- Footer (CA-01) -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 40px;text-align:center;">
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
              {{if .OrgAddress}}{{.OrgAddress}}{{end}}
              {{if and .OrgAddress .OrgPhone}} &middot; {{end}}
              {{if .OrgPhone}}{{.OrgPhone}}{{end}}
              {{if and .OrgEmail (or .OrgAddress .OrgPhone)}} &middot; {{end}}
              {{if .OrgEmail}}<a href="mailto:{{.OrgEmail}}" style="color:#3b82f6;text-decoration:none;">{{.OrgEmail}}</a>{{end}}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

// ─── Recipient template (CA-03) ───────────────────────────────────────────────

const recipientBodySrc = `
<p style="margin:0 0 24px;color:#1e293b;font-size:16px;font-weight:600;">
  ¡Hola, {{.RecipientName}}! Tu envío está en camino.
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:28px;">
  <tr>
    <td style="padding:20px 24px;">

      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#334155;">
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">N° de seguimiento</td>
          <td><strong style="font-size:15px;color:#1e3a5f;letter-spacing:0.5px;">{{.TrackingID}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Remitente</td>
          <td>{{.SenderName}}</td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Paquete</td>
          <td>{{.PackageDesc}}</td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Entrega estimada</td>
          <td>{{.EstimatedDelivery}}</td>
        </tr>
      </table>

    </td>
  </tr>
</table>

{{if .TrackURL}}
<div style="text-align:center;">
  <a href="{{.TrackURL}}"
     style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;
            padding:12px 28px;border-radius:7px;font-size:14px;font-weight:600;">
    Rastrear mi envío &rarr;
  </a>
</div>
{{end}}

<p style="margin:28px 0 0;color:#64748b;font-size:13px;text-align:center;">
  Si tenés preguntas sobre tu envío, respondé este email o usá el número de seguimiento.
</p>`

// ─── Sender template (CA-04) ─────────────────────────────────────────────────

const senderBodySrc = `
<p style="margin:0 0 12px;color:#1e293b;font-size:16px;font-weight:600;">
  Tu envío fue registrado exitosamente.
</p>
<p style="margin:0 0 28px;color:#475569;font-size:14px;">
  Ya tenés el número de seguimiento para rastrear tu paquete en cualquier momento.
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:28px;">
  <tr>
    <td style="padding:20px 24px;">
      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#334155;">
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">N° de seguimiento</td>
          <td><strong style="font-size:15px;color:#1e3a5f;letter-spacing:0.5px;">{{.TrackingID}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Destinatario</td>
          <td>{{.RecipientName}}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

{{if .TrackURL}}
<div style="text-align:center;">
  <a href="{{.TrackURL}}"
     style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;
            padding:12px 28px;border-radius:7px;font-size:14px;font-weight:600;">
    Rastrear tu envío &rarr;
  </a>
</div>
{{end}}`

// ─── Last mile template (CA-04) ──────────────────────────────────────────────

const lastMileBodySrc = `
<p style="margin:0 0 20px;color:#1e293b;font-size:16px;font-weight:600;">
  🚚 Tu envío está en camino y llegará hoy.
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;margin-bottom:24px;">
  <tr>
    <td style="padding:20px 24px;">
      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#334155;">
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">N° de seguimiento</td>
          <td><strong style="font-size:15px;color:#1e3a5f;letter-spacing:0.5px;">{{.TrackingID}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Entrega estimada</td>
          <td><strong>Hoy, {{.TimeWindowText}}</strong></td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
  Asegurate de estar disponible para recibir tu paquete. Si no estás en casa al momento de la entrega, el repartidor dejará un aviso para coordinar un nuevo intento.
</p>

{{if .TrackURL}}
<div style="text-align:center;">
  <a href="{{.TrackURL}}"
     style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;
            padding:12px 28px;border-radius:7px;font-size:14px;font-weight:600;">
    Rastrear mi envío &rarr;
  </a>
</div>
{{end}}`

// ─── Render helpers ───────────────────────────────────────────────────────────

type baseData struct {
	Subject    string
	OrgName    string
	OrgAddress string
	OrgPhone   string
	OrgEmail   string
	Body       template.HTML
}

var (
	baseTmpl      = template.Must(template.New("base").Parse(baseTmplSrc))
	recipientTmpl = template.Must(template.New("recipient").Parse(recipientBodySrc))
	senderTmpl    = template.Must(template.New("sender").Parse(senderBodySrc))
	lastMileTmpl  = template.Must(template.New("lastmile").Parse(lastMileBodySrc))
)

func renderRecipientConfirmation(s model.Shipment, org model.OrganizationConfig, trackBaseURL string) string {
	type recipientData struct {
		RecipientName     string
		TrackingID        string
		SenderName        string
		PackageDesc       string
		EstimatedDelivery string
		TrackURL          string
	}
	data := recipientData{
		RecipientName:     s.Recipient.Name,
		TrackingID:        s.TrackingID,
		SenderName:        s.Sender.Name,
		PackageDesc:       formatPackageDesc(s),
		EstimatedDelivery: formatEstimatedDelivery(s.EstimatedDeliveryAt),
		TrackURL:          buildTrackURL(trackBaseURL, s.TrackingID),
	}
	var bodyBuf bytes.Buffer
	if err := recipientTmpl.Execute(&bodyBuf, data); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    fmt.Sprintf("Tu envío %s está en camino", s.TrackingID),
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func renderSenderConfirmation(s model.Shipment, org model.OrganizationConfig, trackBaseURL string) string {
	type senderData struct {
		TrackingID    string
		RecipientName string
		TrackURL      string
	}
	data := senderData{
		TrackingID:    s.TrackingID,
		RecipientName: s.Recipient.Name,
		TrackURL:      buildTrackURL(trackBaseURL, s.TrackingID),
	}
	var bodyBuf bytes.Buffer
	if err := senderTmpl.Execute(&bodyBuf, data); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    fmt.Sprintf("Tu envío %s fue registrado", s.TrackingID),
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func renderLastMileNotification(trackingID, timeWindowText, trackURL string, org model.OrganizationConfig) string {
	type lastMileData struct {
		TrackingID     string
		TimeWindowText string
		TrackURL       string
	}
	data := lastMileData{
		TrackingID:     trackingID,
		TimeWindowText: timeWindowText,
		TrackURL:       trackURL,
	}
	var bodyBuf bytes.Buffer
	if err := lastMileTmpl.Execute(&bodyBuf, data); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    fmt.Sprintf("Tu envío %s está en camino — llegará hoy", trackingID),
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func renderBase(data baseData) string {
	var buf bytes.Buffer
	if err := baseTmpl.Execute(&buf, data); err != nil {
		return fmt.Sprintf("<p>Error al renderizar el template: %v</p>", err)
	}
	return buf.String()
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

func orgName(org model.OrganizationConfig) string {
	if org.Name != "" {
		return org.Name
	}
	return "LogiTrack"
}

func formatPackageDesc(s model.Shipment) string {
	pt := "Paquete"
	switch s.PackageType {
	case model.PackageBox:
		pt = "Caja"
	case model.PackageEnvelope:
		pt = "Sobre"
	}
	fragile := ""
	if s.IsFragile {
		fragile = " · Frágil"
	}
	return fmt.Sprintf("%s · %.1f kg%s", pt, s.WeightKg, fragile)
}

func formatEstimatedDelivery(t *time.Time) string {
	if t == nil {
		return "A coordinar"
	}
	months := [...]string{
		"enero", "febrero", "marzo", "abril", "mayo", "junio",
		"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
	}
	return fmt.Sprintf("%d de %s de %d", t.Day(), months[t.Month()-1], t.Year())
}

func buildTrackURL(base, trackingID string) string {
	base = strings.TrimRight(base, "/")
	if base == "" {
		return ""
	}
	return base + "/track?id=" + trackingID
}
