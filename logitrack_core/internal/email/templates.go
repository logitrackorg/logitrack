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

// ─── Ready-for-pickup template ────────────────────────────────────────────────

const readyForPickupBodySrc = `
<p style="margin:0 0 20px;color:#1e293b;font-size:16px;font-weight:600;">
  📦 Tu envío está disponible para retiro en sucursal.
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px;">
  <tr>
    <td style="padding:20px 24px;">
      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#334155;">
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">N° de seguimiento</td>
          <td><strong style="font-size:15px;color:#1e3a5f;letter-spacing:0.5px;">{{.TrackingID}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Sucursal</td>
          <td><strong>{{.BranchName}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Dirección</td>
          <td>{{.BranchAddress}}</td>
        </tr>
        {{if .BusinessHours}}
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Horarios</td>
          <td>{{.BusinessHours}}</td>
        </tr>
        {{end}}
        {{if .DeadlineDate}}
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Retirá antes del</td>
          <td><strong style="color:#b45309;">{{.DeadlineDate}}</strong></td>
        </tr>
        {{end}}
      </table>
    </td>
  </tr>
</table>

<p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
  Presentate en la sucursal con tu DNI para retirar el paquete. Si no podés concurrir personalmente, podés autorizar a otra persona presentando una nota firmada y copia de tu DNI.
</p>

{{if .TrackURL}}
<div style="text-align:center;">
  <a href="{{.TrackURL}}"
     style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;
            padding:12px 28px;border-radius:7px;font-size:14px;font-weight:600;">
    Ver estado del envío &rarr;
  </a>
</div>
{{end}}`

// ─── Delivery confirmed template (CA-03) ─────────────────────────────────────

const deliveryConfirmedBodySrc = `
<p style="margin:0 0 20px;color:#1e293b;font-size:16px;font-weight:600;">
  ✅ Tu envío fue entregado exitosamente.
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:24px;">
  <tr>
    <td style="padding:20px 24px;">
      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#334155;">
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">N° de seguimiento</td>
          <td><strong style="font-size:15px;color:#1e3a5f;letter-spacing:0.5px;">{{.TrackingID}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Recibido por</td>
          <td><strong>{{.RecipientName}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Fecha y hora de entrega</td>
          <td>{{.DeliveredAt}}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
  Este mensaje es la constancia de que tu envío llegó a destino. Podés ver el detalle completo en el portal de seguimiento.
</p>

{{if .TrackURL}}
<div style="text-align:center;">
  <a href="{{.TrackURL}}"
     style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;
            padding:12px 28px;border-radius:7px;font-size:14px;font-weight:600;">
    Ver detalle del envío &rarr;
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

const rejectedBodySrc = `
<p style="margin:0 0 20px;color:#1e293b;font-size:16px;font-weight:600;">
  🚫 Tu envío fue rechazado por el destinatario.
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;margin-bottom:24px;">
  <tr>
    <td style="padding:20px 24px;">
      <table width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#334155;">
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">N° de seguimiento</td>
          <td><strong style="font-size:15px;color:#1e3a5f;letter-spacing:0.5px;">{{.TrackingID}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Motivo del rechazo</td>
          <td><strong>{{.RejectionReason}}</strong></td>
        </tr>
        <tr>
          <td style="color:#64748b;white-space:nowrap;padding-right:16px;">Fecha y hora</td>
          <td>{{.RejectedAt}}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.6;">
  El envío está siendo devuelto. Para coordinar una solución, contactate con tu sucursal más cercana.
  {{if .OrgPhone}}<br>📞 <strong>{{.OrgPhone}}</strong>{{end}}
  {{if .OrgEmail}}<br>✉️ <strong>{{.OrgEmail}}</strong>{{end}}
</p>

{{if .TrackURL}}
<div style="text-align:center;">
  <a href="{{.TrackURL}}"
     style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;
            padding:12px 28px;border-radius:7px;font-size:14px;font-weight:600;">
    Ver detalle del envío &rarr;
  </a>
</div>
{{end}}`

const deliveryFailedBodySrc = `
<h2 style="margin:0 0 8px;font-size:20px;color:#1e3a5f;">No pudimos entregar tu paquete</h2>
<p style="margin:0 0 20px;color:#475569;font-size:15px;">
  Intentamos entregar tu envío <strong>{{.TrackingID}}</strong> el <strong>{{.AttemptDate}}</strong>, pero no fue posible concretar la entrega.
</p>

{{if .HasAttemptsLeft}}
<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
  <p style="margin:0 0 8px;font-weight:700;color:#c2410c;font-size:15px;">
    ⚠️ Quedan {{.AttemptsLeft}} intento{{if gt .AttemptsLeft 1}}s{{end}} de entrega
  </p>
  <p style="margin:0;color:#7c3f00;font-size:14px;">
    Coordinaremos un nuevo intento automáticamente. También podés optar por retirar tu paquete en nuestra sucursal.
  </p>
</div>
{{else}}
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
  <p style="margin:0 0 8px;font-weight:700;color:#b91c1c;font-size:15px;">
    ❌ Se agotaron los intentos de entrega
  </p>
  <p style="margin:0;color:#7f1d1d;font-size:14px;">
    Ya no realizaremos más intentos a domicilio. Tu envío está disponible para retiro en sucursal.
  </p>
</div>
{{end}}

<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
  <p style="margin:0 0 6px;font-weight:700;color:#1e3a5f;font-size:14px;">🏢 Retiro en sucursal</p>
  <p style="margin:0 0 4px;color:#334155;font-size:14px;"><strong>Sucursal:</strong> {{.BranchName}}</p>
  {{if .BranchAddress}}<p style="margin:0 0 4px;color:#334155;font-size:14px;"><strong>Dirección:</strong> {{.BranchAddress}}</p>{{end}}
  {{if .BranchHours}}<p style="margin:0;color:#334155;font-size:14px;"><strong>Horarios:</strong> {{.BranchHours}}</p>{{end}}
  <p style="margin:8px 0 0;color:#64748b;font-size:13px;">Presentate con tu DNI para retirar el paquete.</p>
</div>

{{if .TrackURL}}
<div style="text-align:center;margin-top:24px;">
  <a href="{{.TrackURL}}"
     style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;">
    Ver estado del envío &rarr;
  </a>
</div>
{{end}}`

const passwordChangedBodySrc = `
<p style="margin:0 0 20px;color:#1e293b;font-size:16px;font-weight:600;">
  ✅ Tu contraseña fue modificada exitosamente.
</p>

<p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
  Hola, <strong>{{.Username}}</strong>. Te confirmamos que la contraseña de tu cuenta en LogiTrack fue actualizada correctamente.
</p>

<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
  <p style="margin:0;color:#166534;font-size:14px;line-height:1.6;">
    Si vos realizaste este cambio, no necesitás hacer nada más.
  </p>
</div>

<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
  <p style="margin:0 0 6px;font-weight:700;color:#b91c1c;font-size:14px;">¿No fuiste vos?</p>
  <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6;">
    Si no realizaste este cambio, contactá de inmediato con el soporte de LogiTrack para proteger tu cuenta.
  </p>
</div>

<p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
  Este es un mensaje automático de seguridad. No respondas a este email.
</p>`

const passwordResetOTPBodySrc = `
<p style="margin:0 0 20px;color:#1e293b;font-size:16px;font-weight:600;">
  🔐 Tu código de verificación
</p>

<p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
  Hola, <strong>{{.Username}}</strong>. Recibimos una solicitud para restablecer la contraseña de tu cuenta en LogiTrack.
</p>

<div style="text-align:center;margin:28px 0;">
  <div style="display:inline-block;background:#f0f9ff;border:2px solid #0ea5e9;border-radius:12px;padding:20px 40px;">
    <p style="margin:0;color:#64748b;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Código OTP</p>
    <p style="margin:0;color:#0c4a6e;font-size:36px;font-weight:700;letter-spacing:8px;font-family:monospace;">{{.OTP}}</p>
  </div>
</div>

<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:14px 20px;margin-bottom:24px;text-align:center;">
  <p style="margin:0;color:#92400e;font-size:13px;">
    ⚠️ Este código expira en <strong>5 minutos</strong>. No lo compartas con nadie.
  </p>
</div>

<p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
  Si no solicitaste este código, podés ignorar este email. Tu contraseña no cambiará.
</p>`

var (
	baseTmpl                = template.Must(template.New("base").Parse(baseTmplSrc))
	recipientTmpl           = template.Must(template.New("recipient").Parse(recipientBodySrc))
	senderTmpl              = template.Must(template.New("sender").Parse(senderBodySrc))
	lastMileTmpl            = template.Must(template.New("lastmile").Parse(lastMileBodySrc))
	readyForPickupTmpl      = template.Must(template.New("readyforpickup").Parse(readyForPickupBodySrc))
	deliveryConfirmedTmpl   = template.Must(template.New("deliveryconfirmed").Parse(deliveryConfirmedBodySrc))
	rejectedTmpl            = template.Must(template.New("rejected").Parse(rejectedBodySrc))
	deliveryFailedTmpl      = template.Must(template.New("deliveryfailed").Parse(deliveryFailedBodySrc))
	passwordResetOTPTmpl    = template.Must(template.New("passwordresetotp").Parse(passwordResetOTPBodySrc))
	passwordChangedTmpl     = template.Must(template.New("passwordchanged").Parse(passwordChangedBodySrc))
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

func renderDeliveryConfirmedNotification(s model.Shipment, deliveredAt time.Time, trackURL string, org model.OrganizationConfig) string {
	type deliveryData struct {
		TrackingID    string
		RecipientName string
		DeliveredAt   string
		TrackURL      string
	}
	data := deliveryData{
		TrackingID:    s.TrackingID,
		RecipientName: s.Recipient.Name,
		DeliveredAt:   formatDeliveredAt(deliveredAt),
		TrackURL:      trackURL,
	}
	var bodyBuf bytes.Buffer
	if err := deliveryConfirmedTmpl.Execute(&bodyBuf, data); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    fmt.Sprintf("Tu envío %s fue entregado exitosamente", s.TrackingID),
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func formatDeliveredAt(t time.Time) string {
	months := [...]string{
		"enero", "febrero", "marzo", "abril", "mayo", "junio",
		"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
	}
	return fmt.Sprintf("%d de %s de %d, %02d:%02d hs",
		t.Day(), months[t.Month()-1], t.Year(), t.Hour(), t.Minute())
}

func renderReadyForPickupNotification(s model.Shipment, branchName, branchAddress, businessHours string, deadlineDate *time.Time, trackURL string, org model.OrganizationConfig) string {
	type pickupData struct {
		TrackingID    string
		BranchName    string
		BranchAddress string
		BusinessHours string
		DeadlineDate  string
		TrackURL      string
	}
	data := pickupData{
		TrackingID:    s.TrackingID,
		BranchName:    branchName,
		BranchAddress: branchAddress,
		BusinessHours: businessHours,
		TrackURL:      trackURL,
	}
	if deadlineDate != nil {
		data.DeadlineDate = formatEstimatedDelivery(deadlineDate)
	}
	var bodyBuf bytes.Buffer
	if err := readyForPickupTmpl.Execute(&bodyBuf, data); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    fmt.Sprintf("Tu envío %s está listo para retirar en sucursal", s.TrackingID),
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func renderRejectedNotification(s model.Shipment, rejectionReason string, rejectedAt time.Time, trackURL string, org model.OrganizationConfig) string {
	type rejectedData struct {
		TrackingID      string
		RejectionReason string
		RejectedAt      string
		TrackURL        string
		OrgPhone        string
		OrgEmail        string
	}
	data := rejectedData{
		TrackingID:      s.TrackingID,
		RejectionReason: rejectionReason,
		RejectedAt:      formatDeliveredAt(rejectedAt),
		TrackURL:        trackURL,
		OrgPhone:        org.Phone,
		OrgEmail:        org.Email,
	}
	var bodyBuf bytes.Buffer
	if err := rejectedTmpl.Execute(&bodyBuf, data); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    fmt.Sprintf("Tu envío %s fue rechazado por el destinatario", s.TrackingID),
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func renderPasswordResetOTP(username, otp string, org model.OrganizationConfig) string {
	type otpData struct {
		Username string
		OTP      string
	}
	var bodyBuf bytes.Buffer
	if err := passwordResetOTPTmpl.Execute(&bodyBuf, otpData{Username: username, OTP: otp}); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    "Tu código de verificación — LogiTrack",
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func renderDeliveryFailedNotification(s model.Shipment, attemptDate string, attemptsLeft, maxAttempts int, branchName, branchAddress, branchHours string, trackURL string, org model.OrganizationConfig) string {
	type failedData struct {
		TrackingID      string
		AttemptDate     string
		HasAttemptsLeft bool
		AttemptsLeft    int
		BranchName      string
		BranchAddress   string
		BranchHours     string
		TrackURL        string
	}
	data := failedData{
		TrackingID:      s.TrackingID,
		AttemptDate:     attemptDate,
		HasAttemptsLeft: attemptsLeft > 0,
		AttemptsLeft:    attemptsLeft,
		BranchName:      branchName,
		BranchAddress:   branchAddress,
		BranchHours:     branchHours,
		TrackURL:        trackURL,
	}
	var bodyBuf bytes.Buffer
	if err := deliveryFailedTmpl.Execute(&bodyBuf, data); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	subjectSuffix := ""
	if attemptsLeft > 0 {
		subjectSuffix = fmt.Sprintf(" — quedan %d intento%s", attemptsLeft, map[bool]string{true: "s", false: ""}[attemptsLeft > 1])
	} else {
		subjectSuffix = " — retirá en sucursal"
	}
	return renderBase(baseData{
		Subject:    fmt.Sprintf("No pudimos entregar tu envío %s%s", s.TrackingID, subjectSuffix),
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}

func renderPasswordChanged(username string, org model.OrganizationConfig) string {
	type changedData struct {
		Username string
	}
	var bodyBuf bytes.Buffer
	if err := passwordChangedTmpl.Execute(&bodyBuf, changedData{Username: username}); err != nil {
		return fmt.Sprintf("<p>Error al generar el cuerpo del email: %v</p>", err)
	}
	return renderBase(baseData{
		Subject:    "Tu contraseña fue modificada — LogiTrack",
		OrgName:    orgName(org),
		OrgAddress: org.Address,
		OrgPhone:   org.Phone,
		OrgEmail:   org.Email,
		Body:       template.HTML(bodyBuf.String()), //nolint:gosec // generated from trusted templates
	})
}
