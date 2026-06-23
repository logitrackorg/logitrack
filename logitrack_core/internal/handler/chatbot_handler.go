package handler

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/analytics"
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
	shipmentSvc  *service.ShipmentService
	sysConfigSvc *service.SystemConfigService
	claimSvc     *service.ClaimService
	analytics    *analytics.Client
}

func NewChatbotHandler(
	shipmentRepo repository.ShipmentRepository,
	branchRepo repository.BranchRepository,
	notifSvc *service.NotificationService,
	shipmentSvc *service.ShipmentService,
	sysConfigSvc *service.SystemConfigService,
	claimSvc *service.ClaimService,
	analyticsClient *analytics.Client,
) *ChatbotHandler {
	return &ChatbotHandler{
		shipmentRepo: shipmentRepo,
		branchRepo:   branchRepo,
		notifSvc:     notifSvc,
		shipmentSvc:  shipmentSvc,
		sysConfigSvc: sysConfigSvc,
		claimSvc:     claimSvc,
		analytics:    analyticsClient,
	}
}

// ActiveClaimInfo es la info de un reclamo activo detectada en el auth del chatbot
type ActiveClaimInfo struct {
	ClaimID         string `json:"claim_id"`
	Status          string `json:"status"`
	SupervisorNotes string `json:"supervisor_notes,omitempty"`
}

// getSupervisorNotes devuelve las notas del último evento claim_pending_customer del reclamo.
func (h *ChatbotHandler) getSupervisorNotes(claimID string) string {
	events, err := h.claimSvc.GetEvents(claimID, "")
	if err != nil {
		return ""
	}
	var notes string
	for _, ev := range events {
		if ev.EventType == model.EventClaimPendingCustomer && ev.Notes != "" {
			notes = ev.Notes
		}
	}
	return notes
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
		// US5: crear reclamo desde chatbot
		chatbot.POST("/claim", h.FileClaim)
		// US4: responder a reclamo pending_customer
		chatbot.POST("/claim/respond", h.RespondToClaim)
	}
}

// AuthRequest es el payload para autenticar un destinatario
type AuthRequest struct {
	TrackingID   string `json:"tracking_id" binding:"required"`
	RecipientDNI string `json:"recipient_dni" binding:"required"`
}

// PendingClaimInfo contiene el reclamo pendiente de respuesta del cliente
type PendingClaimInfo struct {
	ClaimID         string `json:"claim_id"`
	SupervisorNotes string `json:"supervisor_notes"`
}

// OriginBranchInfo contiene los datos de contacto de la sucursal de origen para el chatbot
type OriginBranchInfo struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Hours   string `json:"hours,omitempty"`
}

// AuthResponse contiene los datos del envío después de autenticar
type AuthResponse struct {
	Success          bool              `json:"success"`
	RecipientName    string            `json:"recipient_name"`
	Shipment         model.Shipment    `json:"shipment"`
	AvailableActions []string          `json:"available_actions"`
	ActiveClaim      *ActiveClaimInfo  `json:"active_claim,omitempty"`
	OriginBranch     *OriginBranchInfo `json:"origin_branch,omitempty"`
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

	// Detectar reclamo activo de este destinatario para este envío
	var activeClaim *ActiveClaimInfo
	if h.claimSvc != nil {
		if claim, err := h.claimSvc.GetLatestActiveClaimByTrackingIDAndDNI(shipment.TrackingID, req.RecipientDNI); err == nil {
			activeClaim = &ActiveClaimInfo{
				ClaimID: claim.ID,
				Status:  string(claim.Status),
			}
			if claim.Status == model.ClaimStatusPendingCustomer {
				activeClaim.SupervisorNotes = h.getSupervisorNotes(claim.ID)
				actions = append(actions, "respond_claim")
			}
		} else {
			// Mostramos file_claim siempre que el envío exista (no sea draft):
			// como mínimo bad_treatment es reclamable. El resto de los tipos
			// se filtra en FileClaim mediante canFileClaimOfType.
			if string(shipment.Status) != "draft" {
				actions = append(actions, "file_claim")
			}
		}
	}

	// Obtener nombre del destinatario
	recipientName := shipment.Recipient.Name
	if shipment.Corrections != nil && shipment.Corrections.RecipientName != nil {
		recipientName = *shipment.Corrections.RecipientName
	}

	var originBranch *OriginBranchInfo
	if shipment.OriginBranchID != "" {
		if branch, ok := h.branchRepo.GetByID(shipment.OriginBranchID); ok {
			originBranch = &OriginBranchInfo{
				Name:    branch.Name,
				Address: formatAddress(branch.Address),
				Hours:   branch.Hours,
			}
		}
	}

	go h.analytics.Track(req.RecipientDNI, "chatbot_authenticated", map[string]interface{}{
		"tracking_id": req.TrackingID,
		"user_type":   "recipient",
	})

	c.JSON(http.StatusOK, AuthResponse{
		Success:          true,
		RecipientName:    recipientName,
		Shipment:         shipment,
		AvailableActions: actions,
		ActiveClaim:      activeClaim,
		OriginBranch:     originBranch,
	})
}

// PickupRequest es el payload para solicitar retiro en sucursal
type PickupRequest struct {
	TrackingID   string `json:"tracking_id" binding:"required"`
	RecipientDNI string `json:"recipient_dni" binding:"required"`
}

// PickupResponse contiene la confirmación y datos de la sucursal
type PickupResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Branch  *BranchInfo `json:"branch,omitempty"`
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
	go h.analytics.Track(req.RecipientDNI, "chatbot_option_selected", map[string]interface{}{
		"action":      "pickup",
		"tracking_id": req.TrackingID,
	})

	message := "Tu paquete está listo para retiro en sucursal"
	if shipment.Status != model.StatusReadyForPickup {
		message = "Registramos tu solicitud. Te avisaremos cuando el paquete esté disponible para retiro en sucursal."
		branchInfo = nil
	}

	c.JSON(http.StatusOK, PickupResponse{
		Success: true,
		Message: message,
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
	Success         bool     `json:"success"`
	AvailableDates  []string `json:"available_dates"`
	RescheduleCount int      `json:"reschedule_count"`
	MaxReschedules  int      `json:"max_reschedules"`
	CanReschedule   bool     `json:"can_reschedule"`
	Message         string   `json:"message,omitempty"`
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

	// ✅ Leer configuración ACTUAL del sistema
	log.Printf("🔍 [CHATBOT] sysConfigSvc is nil? %v", h.sysConfigSvc == nil)
	maxReschedules := 2
	maxRescheduleDays := 3
	if h.sysConfigSvc != nil {
		cfg := h.sysConfigSvc.Get()
		log.Printf("✅ [CHATBOT] Config obtenida: MaxReschedules=%d, MaxRescheduleDays=%d",
			cfg.MaxReschedules, cfg.MaxRescheduleDays)
		maxReschedules = cfg.MaxReschedules
		maxRescheduleDays = cfg.MaxRescheduleDays
	} else {
		log.Printf("⚠️ sysConfigSvc es nil, usando defaults")
	}
	log.Printf("📊 Usando: MaxReschedules=%d, MaxRescheduleDays=%d",
		maxReschedules, maxRescheduleDays)

	// ✅ CAMBIO 1: Inicializar metadata SIN parámetro
	shipment.InitializeChatbotMetadata()

	// ✅ CAMBIO 2: Verificar si puede reprogramar CON parámetro
	canReschedule, message := shipment.CanReschedule(maxReschedules)

	response := RescheduleOptionsResponse{
		Success:         true,
		CanReschedule:   canReschedule,
		RescheduleCount: shipment.ChatbotMetadata.RescheduleCount,
		MaxReschedules:  maxReschedules, // ✅ CAMBIO 3: Usar variable, NO metadata
		Message:         message,
	}

	if canReschedule {
		dates := shipment.GetAvailableRescheduleDates(maxRescheduleDays)
		dateStrings := make([]string, len(dates))
		for i, d := range dates {
			dateStrings[i] = d.Format("2006-01-02")
		}

		response.AvailableDates = dateStrings
	}
	log.Printf("📤 [CHATBOT] Response a enviar: RescheduleCount=%d, MaxReschedules=%d, Dates=%d",
		response.RescheduleCount, response.MaxReschedules, len(response.AvailableDates))

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

	newDate, err := time.Parse("2006-01-02", req.NewDeliveryDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Formato de fecha inválido. Usa YYYY-MM-DD"})
		return
	}

	shipment, err := h.shipmentRepo.AuthenticateRecipient(repository.AuthenticateRecipientCmd{
		TrackingID:   req.TrackingID,
		RecipientDNI: req.RecipientDNI,
	})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Envío no encontrado"})
		return
	}

	// ✅ Declarar AMBAS variables
	maxRescheduleDays := 3
	maxReschedules := 2 // ✅ AGREGAR ESTA LÍNEA

	if h.sysConfigSvc != nil {
		cfg := h.sysConfigSvc.Get()
		maxRescheduleDays = cfg.MaxRescheduleDays
		maxReschedules = cfg.MaxReschedules // ✅ AGREGAR ESTA LÍNEA
	}

	baseDate := shipment.EstimatedDeliveryAt
	if shipment.ChatbotMetadata != nil && shipment.ChatbotMetadata.OriginalDeliveryDate != nil {
		baseDate = shipment.ChatbotMetadata.OriginalDeliveryDate
	}

	if baseDate != nil {
		maxAllowedDate := baseDate.AddDate(0, 0, maxRescheduleDays)
		if newDate.After(maxAllowedDate) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"La fecha seleccionada excede el rango permitido de %d días desde la fecha original",
					maxRescheduleDays,
				),
			})
			return
		}
	}

	shipment, err = h.shipmentRepo.RescheduleDelivery(repository.RescheduleDeliveryCmd{
		TrackingID:        req.TrackingID,
		RecipientDNI:      req.RecipientDNI,
		NewDeliveryDate:   newDate,
		ChangedBy:         "chatbot-recipient:" + req.RecipientDNI,
		Timestamp:         time.Now(),
		MaxReschedules:    maxReschedules, // ✅ Ahora existe
		MaxRescheduleDays: maxRescheduleDays,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	go h.notifSvc.NotifyChatbotDeliveryRescheduled(shipment)
	go h.analytics.Track(req.RecipientDNI, "chatbot_option_selected", map[string]interface{}{
		"action":      "reschedule",
		"tracking_id": req.TrackingID,
		"new_date":    req.NewDeliveryDate,
	})

	c.JSON(http.StatusOK, RescheduleResponse{
		Success:         true,
		Message:         "Tu entrega ha sido reprogramada exitosamente",
		NewDeliveryDate: shipment.EstimatedDeliveryAt.Format("2006-01-02"),
	})
}

// CancelRequest es el payload para cancelar un envío
type ChatbotCancelRequest struct {
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

	changedBy := "chatbot-recipient:" + req.RecipientDNI
	shipment, err := h.shipmentSvc.CancelByRecipient(req.TrackingID, req.RecipientDNI, req.Reason, changedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	go h.notifSvc.NotifyChatbotRejectedByRecipient(shipment)
	go h.analytics.Track(req.RecipientDNI, "chatbot_option_selected", map[string]interface{}{
		"action":      "cancel",
		"tracking_id": req.TrackingID,
	})

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
	Success          bool              `json:"success"`
	SenderName       string            `json:"sender_name"`
	Shipment         model.Shipment    `json:"shipment"`
	AvailableActions []string          `json:"available_actions"`
	ActiveClaim      *ActiveClaimInfo  `json:"active_claim,omitempty"`
	OriginBranch     *OriginBranchInfo `json:"origin_branch,omitempty"`
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

	// Detectar reclamo activo de este remitente para este envío
	var activeClaim *ActiveClaimInfo
	if h.claimSvc != nil {
		if claim, err := h.claimSvc.GetLatestActiveClaimByTrackingIDAndDNI(shipment.TrackingID, req.SenderDNI); err == nil {
			activeClaim = &ActiveClaimInfo{
				ClaimID: claim.ID,
				Status:  string(claim.Status),
			}
			if claim.Status == model.ClaimStatusPendingCustomer {
				activeClaim.SupervisorNotes = h.getSupervisorNotes(claim.ID)
				actions = append(actions, "respond_claim")
			}
		} else {
			// Idéntico criterio que en Authenticate: mostrar file_claim siempre
			// que el envío no sea draft; canFileClaimOfType filtra por tipo.
			if string(shipment.Status) != "draft" {
				actions = append(actions, "file_claim")
			}
		}
	}

	var originBranchSender *OriginBranchInfo
	if shipment.OriginBranchID != "" {
		if branch, ok := h.branchRepo.GetByID(shipment.OriginBranchID); ok {
			originBranchSender = &OriginBranchInfo{
				Name:    branch.Name,
				Address: formatAddress(branch.Address),
				Hours:   branch.Hours,
			}
		}
	}

	go h.analytics.Track(req.SenderDNI, "chatbot_authenticated", map[string]interface{}{
		"tracking_id": req.TrackingID,
		"user_type":   "sender",
	})

	c.JSON(http.StatusOK, SenderAuthResponse{
		Success:          true,
		SenderName:       shipment.Sender.Name,
		Shipment:         shipment,
		AvailableActions: actions,
		ActiveClaim:      activeClaim,
		OriginBranch:     originBranchSender,
	})
}

// CancelBySender cancela el envío por solicitud del remitente vía chatbot (LOGITRACK-457)
func (h *ChatbotHandler) CancelBySender(c *gin.Context) {
	var req SenderCancelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
		return
	}

	changedBy := "chatbot-sender:" + req.SenderDNI
	shipment, err := h.shipmentSvc.CancelBySender(req.TrackingID, req.SenderDNI, req.Reason, changedBy)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	go h.notifSvc.NotifyChatbotCancelledBySender(shipment)
	go h.analytics.Track(req.SenderDNI, "chatbot_option_selected", map[string]interface{}{
		"action":      "cancel",
		"tracking_id": req.TrackingID,
	})

	c.JSON(http.StatusOK, CancelResponse{
		Success: true,
		Message: "Tu envío ha sido cancelado exitosamente",
	})
}

// RespondToClaim procesa la respuesta del cliente a un reclamo pending_customer (US-4)
func (h *ChatbotHandler) RespondToClaim(c *gin.Context) {
	claimID := strings.TrimSpace(c.PostForm("claim_id"))
	claimantDNI := strings.TrimSpace(c.PostForm("claimant_dni"))
	responseText := strings.TrimSpace(c.PostForm("response_text"))

	if claimID == "" || claimantDNI == "" || responseText == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "claim_id, claimant_dni y response_text son requeridos"})
		return
	}

	var evidenceSvc *service.ClaimEvidenceUpload
	if file, err := c.FormFile("evidence"); err == nil {
		f, err := file.Open()
		if err == nil {
			defer f.Close()
			data := make([]byte, file.Size)
			if _, err := f.Read(data); err == nil {
				evidenceSvc = &service.ClaimEvidenceUpload{
					FileName: file.Filename,
					MimeType: file.Header.Get("Content-Type"),
					Data:     data,
				}
			}
		}
	}

	if h.claimSvc == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "servicio no disponible"})
		return
	}

	claim, err := h.claimSvc.RespondToClaimInfoRequest(claimID, claimantDNI, responseText, evidenceSvc)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	go func() {
		branchID := ""
		if shipment, err := h.shipmentRepo.GetByTrackingID(claim.TrackingID); err == nil {
			branchID = shipment.OriginBranchID
		}
		h.notifSvc.NotifyClaimCustomerResponded(claim, branchID)
	}()
	go h.analytics.Track(claimantDNI, "chatbot_option_selected", map[string]interface{}{
		"action":   "respond_claim",
		"claim_id": claimID,
	})

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"claim_id": claim.ID,
		"status":   claim.Status,
		"message":  "Tu respuesta fue enviada. El equipo la revisará y te avisaremos cuando haya novedades.",
	})
}

func (h *ChatbotHandler) getAvailableActions(shipment model.Shipment) []string {
	actions := []string{}

	if canPickup, _ := shipment.CanRequestPickup(); canPickup {
		actions = append(actions, "request_pickup")
	}

	// ✅ Obtener maxReschedules de la configuración
	maxReschedules := 2
	if h.sysConfigSvc != nil {
		maxReschedules = h.sysConfigSvc.Get().MaxReschedules
	}

	// ✅ Pasar maxReschedules como parámetro
	if canReschedule, _ := shipment.CanReschedule(maxReschedules); canReschedule {
		actions = append(actions, "reschedule")
	}

	if canReject, _ := shipment.CanReject(); canReject {
		actions = append(actions, "cancel")
	}

	return actions
}

// FileClaimRequest es el payload para crear un reclamo desde el chatbot.
// Category y DeliverySubtype son opcionales y representan la elección del
// árbol de decisión compartido (CLAIM_CATEGORIES en el frontend); cuando
// vienen, el servicio normaliza el claim_type con ClassifyClaimType.
type FileClaimRequest struct {
	TrackingID      string   `json:"tracking_id" binding:"required"`
	ClaimantDNI     string   `json:"claimant_dni" binding:"required"`
	ClaimantName    string   `json:"claimant_name" binding:"required"`
	ClaimType       string   `json:"claim_type" binding:"required"`
	Category        string   `json:"category"`
	DamageSubtypes  []string `json:"damage_subtypes"`
	DeliverySubtype string   `json:"delivery_subtype"`
	Description     string   `json:"description" binding:"required"`
}

// FileClaimResponse es la respuesta tras crear un reclamo
type FileClaimResponse struct {
	Success bool   `json:"success"`
	ClaimID string `json:"claim_id"`
	Message string `json:"message"`
}

// FileClaim permite al cliente crear un reclamo desde el chatbot (US5).
func (h *ChatbotHandler) FileClaim(c *gin.Context) {
	// Soporta multipart (con evidencia) y JSON (sin evidencia)
	var trackingID, claimantDNI, claimantName, claimType, description, category, deliverySubtype string
	var damageSubtypes []string
	var evidenceUpload *service.ClaimEvidenceUpload

	contentType := c.ContentType()
	if strings.Contains(contentType, "multipart/form-data") {
		trackingID = strings.TrimSpace(c.PostForm("tracking_id"))
		claimantDNI = strings.TrimSpace(c.PostForm("claimant_dni"))
		claimantName = strings.TrimSpace(c.PostForm("claimant_name"))
		claimType = strings.TrimSpace(c.PostForm("claim_type"))
		description = strings.TrimSpace(c.PostForm("description"))
		category = strings.TrimSpace(c.PostForm("category"))
		deliverySubtype = strings.TrimSpace(c.PostForm("delivery_subtype"))
		damageSubtypes = strings.Split(c.PostForm("damage_subtypes"), ",")

		if fh, err := c.FormFile("evidence"); err == nil {
			f, err := fh.Open()
			if err == nil {
				defer f.Close()
				data := make([]byte, fh.Size)
				if _, err := f.Read(data); err == nil {
					evidenceUpload = &service.ClaimEvidenceUpload{
						FileName: fh.Filename,
						MimeType: fh.Header.Get("Content-Type"),
						Data:     data,
					}
				}
			}
		}
	} else {
		var req FileClaimRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Datos incompletos"})
			return
		}
		trackingID = req.TrackingID
		claimantDNI = req.ClaimantDNI
		claimantName = req.ClaimantName
		claimType = req.ClaimType
		description = req.Description
		damageSubtypes = req.DamageSubtypes
		category = req.Category
		deliverySubtype = req.DeliverySubtype
	}

	if h.claimSvc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Servicio no disponible"})
		return
	}

	// Determinar si el reclamante es remitente o destinatario para formatear created_by
	createdBy := "chatbot-customer:" + claimantDNI
	if s, err := h.shipmentRepo.GetByTrackingID(trackingID); err == nil {
		if strings.TrimSpace(s.Sender.DNI) == strings.TrimSpace(claimantDNI) {
			createdBy = "chatbot-sender:" + claimantDNI
		}
	}
	_ = claimantName // nombre usado solo en contexto de autenticación previa

	// Todas las validaciones (elegibilidad por tipo, dedup, evidencia
	// obligatoria para producto dañado, tipo/tamaño de archivo) viven en
	// ClaimService.CreatePublicClaim — única fuente de verdad. Acá solo
	// armamos el request y mapeamos errores a códigos HTTP.
	req := model.CreatePublicClaimRequest{
		TrackingID:      trackingID,
		DNI:             claimantDNI,
		CreatedBy:       createdBy,
		ClaimType:       model.ClaimType(claimType),
		Description:     description,
		Category:        category,
		DamageSubtypes:  damageSubtypes,
		DeliverySubtype: deliverySubtype,
	}

	claim, err := h.claimSvc.CreatePublicClaim(req, evidenceUpload)
	if err != nil {
		if existing, ok := service.IsActiveClaimExistsError(err); ok {
			c.JSON(http.StatusConflict, gin.H{
				"error":    existing.Error(),
				"claim_id": existing.ExistingClaimID,
				"status":   existing.ExistingStatus,
			})
			return
		}
		log.Printf("[chatbot] FileClaim error: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	go h.analytics.Track(claimantDNI, "chatbot_claim_submitted", map[string]interface{}{
		"tracking_id": trackingID,
		"claim_id":    claim.ID,
		"claim_type":  claimType,
	})
	go h.analytics.Track(claimantDNI, "chatbot_claim_type_selected", map[string]interface{}{
		"claim_type":  claimType,
		"tracking_id": trackingID,
	})

	c.JSON(http.StatusOK, FileClaimResponse{
		Success: true,
		ClaimID: claim.ID,
		Message: fmt.Sprintf("Tu reclamo %s fue registrado correctamente. Te notificaremos cuando haya novedades.", claim.ID),
	})
}
