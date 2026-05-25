package handler

import (
	"net/http"
	"time"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

// formatAddress convierte un Address struct a string legible
func formatAddress(addr model.Address) string {
	parts := []string{}
	if addr.Street != "" {
		parts = append(parts, addr.Street)
	}
	if addr.City != "" {
		parts = append(parts, addr.City)
	}
	if addr.Province != "" {
		parts = append(parts, addr.Province)
	}
	if addr.PostalCode != "" {
		parts = append(parts, "CP "+addr.PostalCode)
	}
	
	if len(parts) == 0 {
		return "Dirección no disponible"
	}
	
	return strings.Join(parts, ", ")
}

// ChatbotHandler maneja las operaciones públicas del chatbot para destinatarios
type ChatbotHandler struct {
	shipmentRepo repository.ShipmentRepository
	branchRepo   repository.BranchRepository
	notifSvc     *service.NotificationService
}

func NewChatbotHandler(shipmentRepo repository.ShipmentRepository, branchRepo repository.BranchRepository, notifSvc *service.NotificationService) *ChatbotHandler {
	return &ChatbotHandler{
		shipmentRepo: shipmentRepo,
		branchRepo:   branchRepo,
		notifSvc:     notifSvc,
	}
}

// RegisterRoutes registra las rutas públicas del chatbot (sin autenticación)
func (h *ChatbotHandler) RegisterRoutes(r *gin.RouterGroup) {
	chatbot := r.Group("/chatbot")
	{
		chatbot.POST("/auth", h.Authenticate)
		chatbot.POST("/pickup", h.RequestPickup)
		chatbot.GET("/reschedule/options", h.GetRescheduleOptions)
		chatbot.POST("/reschedule", h.RescheduleDelivery)
		chatbot.POST("/cancel", h.CancelShipment)
		// Flujo remitente (LOGITRACK-457)
		chatbot.POST("/sender/auth", h.AuthenticateSender)
		chatbot.POST("/sender/cancel", h.CancelBySender)
	}
}

// AuthRequest es el payload para autenticar un destinatario
type AuthRequest struct {
	TrackingID   string `json:"tracking_id" binding:"required"`
	RecipientDNI string `json:"recipient_dni" binding:"required"`
}

// AuthResponse contiene los datos del envío después de autenticar
type AuthResponse struct {
	Success       bool           `json:"success"`
	RecipientName string         `json:"recipient_name"`
	Shipment      model.Shipment `json:"shipment"`
	AvailableActions []string    `json:"available_actions"`
}

// Authenticate valida el tracking ID y DNI del destinatario (US1)
//
// @Summary      Autenticar destinatario
// @Description  Valida el ID de envío y DNI del destinatario para acceso al chatbot
// @Tags         chatbot
// @Accept       json
// @Produce      json
// @Param        body  body      AuthRequest  true  "Credenciales del destinatario"
// @Success      200   {object}  AuthResponse
// @Failure      400   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Router       /public/chatbot/auth [post]
func (h *ChatbotHandler) Authenticate(c *gin.Context) {
	var req AuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	shipment, err := h.shipmentRepo.AuthenticateRecipient(repository.AuthenticateRecipientCmd{
		TrackingID:   req.TrackingID,
		RecipientDNI: req.RecipientDNI,
	})

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "No pudimos encontrar tu envío con los datos ingresados, por favor verifica e intenta nuevamente",
		})
		return
	}

	// Determinar acciones disponibles
	actions := h.getAvailableActions(shipment)

	// Obtener nombre del destinatario
	recipientName := shipment.Recipient.Name
	if shipment.Corrections != nil && shipment.Corrections.RecipientName != nil {
		recipientName = *shipment.Corrections.RecipientName
	}

	c.JSON(http.StatusOK, AuthResponse{
		Success:          true,
		RecipientName:    recipientName,
		Shipment:         shipment,
		AvailableActions: actions,
	})
}

// PickupRequest es el payload para solicitar retiro en sucursal
type PickupRequest struct {
	TrackingID   string `json:"tracking_id" binding:"required"`
	RecipientDNI string `json:"recipient_dni" binding:"required"`
}

// PickupResponse contiene la confirmación y datos de la sucursal
type PickupResponse struct {
	Success bool               `json:"success"`
	Message string             `json:"message"`
	Branch  *BranchInfo        `json:"branch,omitempty"`
}

// BranchInfo contiene información de la sucursal para retiro
type BranchInfo struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Hours   string `json:"hours"`
}

// RequestPickup cambia el método de entrega a retiro en sucursal (US2)
//
// @Summary      Solicitar retiro en sucursal
// @Description  Cambia el método de entrega a retiro en sucursal destino
// @Tags         chatbot
// @Accept       json
// @Produce      json
// @Param        body  body      PickupRequest  true  "Datos del destinatario"
// @Success      200   {object}  PickupResponse
// @Failure      400   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Router       /public/chatbot/pickup [post]
func (h *ChatbotHandler) RequestPickup(c *gin.Context) {
	var req PickupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	shipment, err := h.shipmentRepo.RequestPickup(repository.RequestPickupCmd{
		TrackingID:   req.TrackingID,
		RecipientDNI: req.RecipientDNI,
		ChangedBy:    "chatbot-recipient:" + req.RecipientDNI,
		Timestamp:    time.Now(),
	})

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Obtener información de la sucursal
	var branchInfo *BranchInfo
	if shipment.FinalBranchID != "" {
		if branch, found := h.branchRepo.GetByID(shipment.FinalBranchID); found {
			hours := branch.Hours
			if hours == "" {
				hours = "Lunes a Viernes 9:00-18:00hs"
			}
			branchInfo = &BranchInfo{
				Name:    branch.Name,
				Address: formatAddress(branch.Address),
				Hours:   hours,
			}
		}
	}

	go h.notifSvc.NotifyChatbotPickupRequested(shipment)

	c.JSON(http.StatusOK, PickupResponse{
		Success: true,
		Message: "Tu paquete está listo para retiro en sucursal",
		Branch:  branchInfo,
	})
}

// RescheduleOptionsRequest para obtener fechas disponibles
type RescheduleOptionsRequest struct {
	TrackingID   string `form:"tracking_id" binding:"required"`
	RecipientDNI string `form:"recipient_dni" binding:"required"`
}

// RescheduleOptionsResponse contiene las fechas disponibles
type RescheduleOptionsResponse struct {
	Success          bool       `json:"success"`
	AvailableDates   []string   `json:"available_dates"`
	RescheduleCount  int        `json:"reschedule_count"`
	MaxReschedules   int        `json:"max_reschedules"`
	CanReschedule    bool       `json:"can_reschedule"`
	Message          string     `json:"message,omitempty"`
}

// GetRescheduleOptions obtiene las fechas disponibles para reprogramar (US3)
//
// @Summary      Obtener opciones de reprogramación
// @Description  Retorna las fechas disponibles para reprogramar la entrega
// @Tags         chatbot
// @Produce      json
// @Param        tracking_id   query  string  true  "ID del envío"
// @Param        recipient_dni query  string  true  "DNI del destinatario"
// @Success      200  {object}  RescheduleOptionsResponse
// @Failure      400  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /public/chatbot/reschedule/options [get]
func (h *ChatbotHandler) GetRescheduleOptions(c *gin.Context) {
	var req RescheduleOptionsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	// Autenticar
	shipment, err := h.shipmentRepo.AuthenticateRecipient(repository.AuthenticateRecipientCmd{
		TrackingID:   req.TrackingID,
		RecipientDNI: req.RecipientDNI,
	})

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Envío no encontrado"})
		return
	}

	// Verificar si puede reprogramar
	canReschedule, message := shipment.CanReschedule()

	// Inicializar metadata si no existe
	shipment.InitializeChatbotMetadata()

	response := RescheduleOptionsResponse{
		Success:         true,
		CanReschedule:   canReschedule,
		RescheduleCount: shipment.ChatbotMetadata.RescheduleCount,
		MaxReschedules:  shipment.ChatbotMetadata.MaxReschedules,
		Message:         message,
	}

	if canReschedule {
		// Obtener fechas disponibles
		dates := shipment.GetAvailableRescheduleDates()
		dateStrings := make([]string, len(dates))
		for i, d := range dates {
			dateStrings[i] = d.Format("2006-01-02")
		}
		response.AvailableDates = dateStrings
	}

	c.JSON(http.StatusOK, response)
}

// RescheduleRequest es el payload para reprogramar entrega
type RescheduleRequest struct {
	TrackingID      string `json:"tracking_id" binding:"required"`
	RecipientDNI    string `json:"recipient_dni" binding:"required"`
	NewDeliveryDate string `json:"new_delivery_date" binding:"required"` // YYYY-MM-DD
}

// RescheduleResponse confirma la reprogramación
type RescheduleResponse struct {
	Success         bool   `json:"success"`
	Message         string `json:"message"`
	NewDeliveryDate string `json:"new_delivery_date"`
}

// RescheduleDelivery reprograma la fecha de entrega (US3)
//
// @Summary      Reprogramar entrega
// @Description  Cambia la fecha de entrega del paquete (máximo 2 veces, +3 días)
// @Tags         chatbot
// @Accept       json
// @Produce      json
// @Param        body  body      RescheduleRequest  true  "Nueva fecha de entrega"
// @Success      200   {object}  RescheduleResponse
// @Failure      400   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Router       /public/chatbot/reschedule [post]
func (h *ChatbotHandler) RescheduleDelivery(c *gin.Context) {
	var req RescheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	// Parsear fecha
	newDate, err := time.Parse("2006-01-02", req.NewDeliveryDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Formato de fecha inválido. Usa YYYY-MM-DD"})
		return
	}

	shipment, err := h.shipmentRepo.RescheduleDelivery(repository.RescheduleDeliveryCmd{
		TrackingID:      req.TrackingID,
		RecipientDNI:    req.RecipientDNI,
		NewDeliveryDate: newDate,
		ChangedBy:       "chatbot-recipient:" + req.RecipientDNI,
		Timestamp:       time.Now(),
	})

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, RescheduleResponse{
		Success:         true,
		Message:         "Tu entrega ha sido reprogramada exitosamente",
		NewDeliveryDate: shipment.EstimatedDeliveryAt.Format("2006-01-02"),
	})
}

// CancelRequest es el payload para cancelar un envío
type ChatbotCancelRequest  struct {
	TrackingID   string `json:"tracking_id" binding:"required"`
	RecipientDNI string `json:"recipient_dni" binding:"required"`
	Reason       string `json:"reason"`
}

// CancelResponse confirma la cancelación
type CancelResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// CancelShipment cancela el envío por solicitud del destinatario (US4)
//
// @Summary      Cancelar envío
// @Description  Cancela el envío si no está en camino
// @Tags         chatbot
// @Accept       json
// @Produce      json
// @Param        body  body      CancelRequest  true  "Datos de cancelación"
// @Success      200   {object}  CancelResponse
// @Failure      400   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Router       /public/chatbot/cancel [post]
func (h *ChatbotHandler) CancelShipment(c *gin.Context) {
	var req ChatbotCancelRequest  
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	if req.Reason == "" {
		req.Reason = "Cancelado por el destinatario vía chatbot"
	}

	shipment, err := h.shipmentRepo.CancelByRecipient(repository.CancelByRecipientCmd{
		TrackingID:   req.TrackingID,
		RecipientDNI: req.RecipientDNI,
		Reason:       req.Reason,
		ChangedBy:    "chatbot-recipient:" + req.RecipientDNI,
		Timestamp:    time.Now(),
	})

	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	go h.notifSvc.NotifyChatbotRejectedByRecipient(shipment)

	c.JSON(http.StatusOK, CancelResponse{
		Success: true,
		Message: "Tu envío ha sido rechazado. Por favor comunícate con el remitente para coordinar el reembolso si correspondiera",
	})
}

// SenderAuthRequest es el payload para autenticar al remitente vía chatbot
type SenderAuthRequest struct {
	TrackingID string `json:"tracking_id" binding:"required"`
	SenderDNI  string `json:"sender_dni"  binding:"required"`
}

// SenderAuthResponse contiene los datos del envío tras autenticar al remitente
type SenderAuthResponse struct {
	Success          bool           `json:"success"`
	SenderName       string         `json:"sender_name"`
	Shipment         model.Shipment `json:"shipment"`
	AvailableActions []string       `json:"available_actions"`
}

// SenderCancelRequest es el payload para que el remitente cancele el envío
type SenderCancelRequest struct {
	TrackingID string `json:"tracking_id" binding:"required"`
	SenderDNI  string `json:"sender_dni"  binding:"required"`
	Reason     string `json:"reason"`
}

// AuthenticateSender valida el tracking ID y DNI del remitente (LOGITRACK-457)
func (h *ChatbotHandler) AuthenticateSender(c *gin.Context) {
	var req SenderAuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	shipment, err := h.shipmentRepo.AuthenticateSender(repository.AuthenticateSenderCmd{
		TrackingID: req.TrackingID,
		SenderDNI:  req.SenderDNI,
	})
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	actions := []string{}
	if canCancel, _ := shipment.CanCancel(); canCancel {
		actions = append(actions, "cancel")
	}

	c.JSON(http.StatusOK, SenderAuthResponse{
		Success:          true,
		SenderName:       shipment.Sender.Name,
		Shipment:         shipment,
		AvailableActions: actions,
	})
}

// CancelBySender cancela el envío por solicitud del remitente vía chatbot (LOGITRACK-457)
func (h *ChatbotHandler) CancelBySender(c *gin.Context) {
	var req SenderCancelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	if req.Reason == "" {
		req.Reason = "Cancelado por el remitente vía chatbot"
	}

	shipment, err := h.shipmentRepo.CancelBySender(repository.CancelBySenderCmd{
		TrackingID: req.TrackingID,
		SenderDNI:  req.SenderDNI,
		Reason:     req.Reason,
		ChangedBy:  "chatbot-sender:" + req.SenderDNI,
		Timestamp:  time.Now(),
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	go h.notifSvc.NotifyChatbotCancelledBySender(shipment)

	c.JSON(http.StatusOK, CancelResponse{
		Success: true,
		Message: "Tu envío ha sido cancelado exitosamente",
	})
}

// getAvailableActions determina qué acciones puede realizar el destinatario
func (h *ChatbotHandler) getAvailableActions(shipment model.Shipment) []string {
	actions := []string{}

	if canPickup, _ := shipment.CanRequestPickup(); canPickup {
		actions = append(actions, "request_pickup")
	}

	if canReschedule, _ := shipment.CanReschedule(); canReschedule {
		actions = append(actions, "reschedule")
	}

	if canCancel, _ := shipment.CanCancel(); canCancel {
		actions = append(actions, "cancel")
	}

	return actions
}