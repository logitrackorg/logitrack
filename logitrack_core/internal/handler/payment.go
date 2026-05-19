package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/mercadopago"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type PaymentHandler struct {
	svc      *service.PaymentService
	mp       *mercadopago.Client
	shipSvc  *service.ShipmentService
}

func NewPaymentHandler(svc *service.PaymentService, mp *mercadopago.Client, shipSvc *service.ShipmentService) *PaymentHandler {
	return &PaymentHandler{svc: svc, mp: mp, shipSvc: shipSvc}
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

// SimulatePayment godoc
// @Summary      Simular pago aprobado (solo demo)
// @Description  Confirma un pago pendiente sin llamar a Mercado Pago. Solo para testing/demo.
// @Tags         payments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Tracking ID en pending_payment"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Router       /shipments/{tracking_id}/simulate-payment [post]
func (h *PaymentHandler) SimulatePayment(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	shipment, err := h.svc.SimulatePaymentApproved(trackingID, user.Username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// webhookBody is the minimal structure of an MP webhook notification.
type webhookBody struct {
	Action string `json:"action"`
	Data   struct {
		ID string `json:"id"`
	} `json:"data"`
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
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no se pudo leer el cuerpo"})
		return
	}

	// Validate signature when MP client is configured.
	if h.mp != nil {
		xSig := c.GetHeader("x-signature")
		xReqID := c.GetHeader("x-request-id")
		var wb webhookBody
		_ = json.Unmarshal(rawBody, &wb)
		if err := h.mp.ValidateSignature(xSig, xReqID, wb.Data.ID); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "firma inválida"})
			return
		}
	}

	var wb webhookBody
	if err := json.Unmarshal(rawBody, &wb); err != nil || wb.Data.ID == "" {
		// MP sends various notification types; ignore those without a payment ID.
		c.JSON(http.StatusOK, gin.H{"status": "ignorado"})
		return
	}

	if wb.Action != "payment.created" && wb.Action != "payment.updated" {
		c.JSON(http.StatusOK, gin.H{"status": "ignorado"})
		return
	}

	if err := h.svc.HandleWebhook(wb.Data.ID, rawBody); err != nil {
		// Return 200 anyway to avoid MP retrying infinitely on logic errors.
		// Log the error and let the expiry cron handle stuck payments.
		c.JSON(http.StatusOK, gin.H{"status": "error_interno", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
