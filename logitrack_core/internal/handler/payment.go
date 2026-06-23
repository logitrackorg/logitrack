package handler

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/mercadopago"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
	qrcode "github.com/skip2/go-qrcode"
)

type PaymentHandler struct {
	svc       *service.PaymentService
	mp        *mercadopago.Client
	shipSvc   *service.ShipmentService
	configSvc *service.PaymentConfigService
}

func NewPaymentHandler(svc *service.PaymentService, mp *mercadopago.Client, shipSvc *service.ShipmentService) *PaymentHandler {
	return &PaymentHandler{svc: svc, mp: mp, shipSvc: shipSvc}
}

func (h *PaymentHandler) SetPaymentConfigService(svc *service.PaymentConfigService) {
	h.configSvc = svc
}

// RequestPayment godoc
// @Summary      Solicitar pago
// @Description  Valida el borrador, sella precio y prioridad, crea una preferencia en Mercado Pago y transiciona a pending_payment. Devuelve el init_point para redirigir al pago.
// @Tags         payments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Draft tracking ID (BORRADOR-XXXXX)"
// @Success      200          {object}  model.Payment
// @Failure      400          {object}  map[string]string
// @Failure      403          {object}  map[string]string
// @Failure      503          {object}  map[string]string
// @Router       /shipments/{tracking_id}/request-payment [post]
func (h *PaymentHandler) RequestPayment(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	if existing, err := h.shipSvc.GetByTrackingID(trackingID); err == nil {
		if branchForbidden(c, user, existing.ReceivingBranchID) {
			return
		}
	}
	payment, err := h.svc.RequestPayment(trackingID, user.Username)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "Mercado Pago no está configurado en este entorno" {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, payment)
}

// BackToDraft godoc
// @Summary      Volver a borrador
// @Description  Revierte un envío en pending_payment a estado draft. El pago pendiente queda abandonado.
// @Tags         payments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Tracking ID en pending_payment"
// @Success      200          {object}  map[string]string
// @Failure      400          {object}  map[string]string
// @Router       /shipments/{tracking_id}/back-to-draft [post]
func (h *PaymentHandler) BackToDraft(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	if existing, err := h.shipSvc.GetByTrackingID(trackingID); err == nil {
		if branchForbidden(c, user, existing.ReceivingBranchID) {
			return
		}
	}
	if err := h.svc.BackToDraft(trackingID, user.Username); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Envío devuelto a borrador"})
}

// GetPayment godoc
// @Summary      Estado del pago
// @Description  Devuelve el pago más reciente asociado al envío.
// @Tags         payments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Tracking ID del envío"
// @Success      200          {object}  model.Payment
// @Failure      404          {object}  map[string]string
// @Router       /shipments/{tracking_id}/payment [get]
func (h *PaymentHandler) GetPayment(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	payment, err := h.svc.GetByTrackingID(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pago no encontrado"})
		return
	}
	c.JSON(http.StatusOK, payment)
}

// ConfirmCashPayment godoc
// @Summary      Confirmar pago en efectivo
// @Description  Confirma un pago pendiente como pagado en efectivo por el cliente, sin pasar por Mercado Pago.
// @Tags         payments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Tracking ID en pending_payment"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Router       /shipments/{tracking_id}/cash-payment [post]
func (h *PaymentHandler) ConfirmCashPayment(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	shipment, err := h.svc.ConfirmCashPayment(trackingID, user.Username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// ConfirmTransferPayment godoc
// @Summary      Confirmar pago por transferencia bancaria
// @Description  Registra el pago como confirmado mediante transferencia bancaria. El operador confirma una vez verificada la acreditación en la cuenta destino.
// @Tags         payments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Tracking ID en pending_payment"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Router       /shipments/{tracking_id}/transfer-payment [post]
func (h *PaymentHandler) ConfirmTransferPayment(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	shipment, err := h.svc.ConfirmTransferPayment(trackingID, user.Username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// GeneratePaymentQR godoc
// @Summary      QR de pago
// @Description  Genera un código QR que apunta al init_point de Mercado Pago del pago pendiente.
// @Tags         payments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Tracking ID en pending_payment"
// @Success      200          {object}  map[string]string
// @Failure      404          {object}  map[string]string
// @Router       /shipments/{tracking_id}/payment/qr [get]
func (h *PaymentHandler) GeneratePaymentQR(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	payment, err := h.svc.GetByTrackingID(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pago no encontrado"})
		return
	}

	// Prefer alias/CVU from config to generate a transfer QR; fall back to MP init_point.
	qrContent := payment.InitPoint
	if h.configSvc != nil {
		cfg := h.configSvc.Get()
		if cfg.MPAlias != "" || cfg.MPCVU != "" {
			qrContent = buildTransferQRContent(cfg.MPAlias, cfg.MPCVU, "", "", "")
		}
	}

	if qrContent == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "Sin destino de pago configurado"})
		return
	}

	qrPNG, err := qrcode.Encode(qrContent, qrcode.Medium, 256)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al generar código QR"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"qr_code_base64": base64.StdEncoding.EncodeToString(qrPNG),
		"init_point":     payment.InitPoint,
	})
}

// buildTransferQRContent returns the alias or CVU as plain text.
// Most Argentine banking apps (MP, Naranja X, Ualá) can scan an alias QR
// and navigate directly to the transfer screen. Amount must be entered manually.
func buildTransferQRContent(alias, cvu string, _, _, _ string) string {
	if alias != "" {
		return alias
	}
	return cvu
}

// webhookBody is the minimal structure of an MP webhook notification.
// MP sends data.id as a JSON number in live payments and as a string in test notifications,
// so we decode into json.RawMessage and normalise to string.
type webhookBody struct {
	Action string `json:"action"`
	Data   struct {
		ID json.RawMessage `json:"id"`
	} `json:"data"`
}

func (wb webhookBody) dataID() string {
	raw := string(wb.Data.ID)
	if len(raw) == 0 {
		return ""
	}
	// Strip surrounding quotes if it arrived as a JSON string.
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(wb.Data.ID, &s); err == nil {
			return s
		}
	}
	return raw // numeric — return digits directly
}

// Webhook godoc
// @Summary      Webhook de Mercado Pago
// @Description  Recibe notificaciones de Mercado Pago. Valida la firma x-signature y procesa el pago si fue aprobado.
// @Tags         payments
// @Accept       json
// @Produce      json
// @Success      200  {object}  map[string]string
// @Router       /webhooks/mercadopago [post]
func (h *PaymentHandler) Webhook(c *gin.Context) {
	log.Printf("[webhook] incoming POST from %s", c.ClientIP())
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no se pudo leer el cuerpo"})
		return
	}

	// Parse body; fall back to query params for IPN-style notifications where
	// MP sends the payment ID in the URL instead of (or in addition to) the body.
	var wb webhookBody
	_ = json.Unmarshal(rawBody, &wb)
	dataID := wb.dataID()
	if dataID == "" {
		// IPN formats: ?data.id=XXX&type=payment  or  ?id=XXX&topic=payment
		if v := c.Query("data.id"); v != "" {
			dataID = v
		} else if v := c.Query("id"); v != "" {
			dataID = v
		}
	}
	if dataID == "" || (wb.Action != "payment.created" && wb.Action != "payment.updated" && wb.Action != "") {
		c.JSON(http.StatusOK, gin.H{"status": "ignorado"})
		return
	}

	if err := h.svc.HandleWebhook(dataID, rawBody); err != nil {
		// Return 200 anyway to avoid MP retrying infinitely on logic errors.
		// Log the error and let the expiry cron handle stuck payments.
		c.JSON(http.StatusOK, gin.H{"status": "error_interno", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
