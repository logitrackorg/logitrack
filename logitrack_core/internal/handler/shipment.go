package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

var timeNow = time.Now

// branchForbidden returns true (and writes 403) when the user is an operator or supervisor
// whose assigned branch does not match the shipment's receiving branch.
func branchForbidden(c *gin.Context, user model.User, shipmentBranchID string) bool {
	if (user.Role != model.RoleOperator && user.Role != model.RoleSupervisor) || user.BranchID == "" {
		return false
	}
	if shipmentBranchID != user.BranchID {
		c.JSON(http.StatusForbidden, gin.H{"error": "solo podés modificar envíos asignados a tu sucursal"})
		return true
	}
	return false
}

// operatorReadForbidden returns true (and writes 403) when an operator tries to read a shipment
// that they have no business viewing. Hoy retorna SIEMPRE false: operator puede leer
// cualquier envío (mismo nivel que supervisor) porque el ruteo inteligente puede
// referenciar envíos cross-branch (pickups) que el operator necesita inspeccionar
// para evaluar el plan. La restricción de ESCRITURA (`branchForbidden`) se mantiene.
func operatorReadForbidden(c *gin.Context, user model.User, shipment model.Shipment) bool {
	_ = c
	_ = user
	_ = shipment
	return false
}

// CancelRequest is the body for cancelling a shipment.
type CancelRequest struct {
	Reason string `json:"reason" binding:"required"`
}

type ShipmentHandler struct {
	svc        *service.ShipmentService
	routeSvc   *service.RouteService
	commentSvc *service.CommentService
	branchSvc  *service.BranchService
}

func NewShipmentHandler(svc *service.ShipmentService, routeSvc *service.RouteService, commentSvc *service.CommentService, branchSvc *service.BranchService) *ShipmentHandler {
	return &ShipmentHandler{svc: svc, routeSvc: routeSvc, commentSvc: commentSvc, branchSvc: branchSvc}
}

func (h *ShipmentHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.POST("/shipments", h.Create)
	r.GET("/shipments", h.List)
	r.GET("/shipments/:tracking_id", h.GetByTrackingID)
	r.PATCH("/shipments/:tracking_id/status", h.UpdateStatus)
	r.GET("/shipments/:tracking_id/events", h.GetEvents)
	r.GET("/search", h.Search)
	r.GET("/stats", h.Stats)
}

// Create creates a confirmed shipment with a real LT- tracking ID.
//
// @Summary      Create shipment
// @Description  Creates a confirmed shipment. Assigns an LT-XXXXXXXX tracking ID. Operator, supervisor, and admin only.
// @Tags         shipments
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      model.CreateShipmentRequest  true  "Shipment data"
// @Success      201   {object}  model.Shipment
// @Failure      400   {object}  map[string]string
// @Failure      401   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      500   {object}  map[string]string
// @Router       /shipments [post]
func (h *ShipmentHandler) Create(c *gin.Context) {
	var req model.CreateShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	req.CreatedBy = user.Username
	if (user.Role == model.RoleOperator || user.Role == model.RoleSupervisor) && user.BranchID != "" {
		req.ReceivingBranchID = user.BranchID
	}
	shipment, err := h.svc.Create(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, shipment)
}

// SaveDraft creates a draft shipment (status: pending) with partial data.
//
// @Summary      Create draft shipment
// @Description  Creates a draft shipment with a DRAFT-XXXXXXXX tracking ID. No fields are required. Operator, supervisor, and admin only.
// @Tags         shipments
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      model.SaveDraftRequest  true  "Partial shipment data"
// @Success      201   {object}  model.Shipment
// @Failure      400   {object}  map[string]string
// @Failure      401   {object}  map[string]string
// @Failure      403   {object}  map[string]string
// @Failure      500   {object}  map[string]string
// @Router       /shipments/draft [post]
func (h *ShipmentHandler) SaveDraft(c *gin.Context) {
	var req model.SaveDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	req.CreatedBy = user.Username
	if (user.Role == model.RoleOperator || user.Role == model.RoleSupervisor) && user.BranchID != "" {
		req.ReceivingBranchID = user.BranchID
	}
	shipment, err := h.svc.SaveDraft(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, shipment)
}

// UpdateDraft updates a pending (draft) shipment.
//
// @Summary      Update draft
// @Description  Updates an existing draft shipment (status must be pending). Operator, supervisor, and admin only.
// @Tags         shipments
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string                  true  "Draft tracking ID (DRAFT-XXXXXXXX)"
// @Param        body         body      model.SaveDraftRequest  true  "Updated shipment data"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Failure      401          {object}  map[string]string
// @Failure      403          {object}  map[string]string
// @Router       /shipments/{tracking_id}/draft [patch]
func (h *ShipmentHandler) UpdateDraft(c *gin.Context) {
	var req model.SaveDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	if existing, err := h.svc.GetByTrackingID(trackingID); err == nil {
		if branchForbidden(c, user, existing.ReceivingBranchID) {
			return
		}
	}
	shipment, err := h.svc.UpdateDraft(trackingID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}


// List returns all shipments, optionally filtered by date range.
//
// @Summary      List shipments
// @Description  Returns shipments sorted by tracking ID ascending. Supports optional date range filtering on created_at. Non-driver roles only.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Param        date_from  query     string  false  "Start date (YYYY-MM-DD, inclusive)"
// @Param        date_to    query     string  false  "End date (YYYY-MM-DD, inclusive, end of day)"
// @Param        status     query     string  false  "Filter by status"
// @Success      200        {array}   model.Shipment
// @Failure      400        {object}  map[string]string
// @Failure      401        {object}  map[string]string
// @Failure      403        {object}  map[string]string
// @Failure      500        {object}  map[string]string
// @Router       /shipments [get]
func (h *ShipmentHandler) List(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	filter := model.ShipmentFilter{}
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		filter.DateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		filter.DateTo = &endOfDay
	}
	// Operators are restricted to their own branch regardless of query params.
	// Supervisors and managers may optionally filter by branch via query param.
	if user.Role == model.RoleOperator && user.BranchID != "" {
		filter.ReceivingBranchID = user.BranchID
	} else if branchID := c.Query("branch_id"); branchID != "" {
		filter.ReceivingBranchID = branchID
	}
	// Only supervisor and manager may request expired drafts.
	if c.Query("include_expired") == "true" &&
		(user.Role == model.RoleSupervisor || user.Role == model.RoleManager) {
		filter.IncludeExpired = true
	}
	shipments, err := h.svc.List(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipments)
}

// GetByTrackingID returns a single shipment by its tracking ID.
//
// @Summary      Get shipment
// @Description  Returns shipment detail including corrections. All authenticated roles.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Shipment tracking ID"
// @Success      200          {object}  model.Shipment
// @Failure      401          {object}  map[string]string
// @Failure      404          {object}  map[string]string
// @Router       /shipments/{tracking_id} [get]
func (h *ShipmentHandler) GetByTrackingID(c *gin.Context) {
	shipment, err := h.svc.GetByTrackingID(c.Param("tracking_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}
	if userVal, exists := c.Get(middleware.UserKey); exists {
		user := userVal.(model.User)
		// Expired drafts are invisible to everyone except admins.
		if shipment.Status == model.StatusExpired && user.Role != model.RoleAdmin {
			c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
			return
		}
		if operatorReadForbidden(c, user, shipment) {
			return
		}
	}
	c.JSON(http.StatusOK, shipment)
}

// UpdateStatus transitions a shipment to a new status.
//
// @Summary      Update shipment status
// @Description  Transitions a shipment through the state machine. Operator, supervisor, admin, and driver. Operators cannot set delivered. Drivers are further restricted to shipments on their today's route and may only set delivered or delivery_failed.
// @Tags         shipments
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string                    true  "Shipment tracking ID"
// @Param        body         body      model.UpdateStatusRequest  true  "Status update payload"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Failure      401          {object}  map[string]string
// @Failure      403          {object}  map[string]string
// @Router       /shipments/{tracking_id}/status [patch]
func (h *ShipmentHandler) UpdateStatus(c *gin.Context) {
	var req model.UpdateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	req.ChangedBy = user.Username
	trackingID := c.Param("tracking_id")

	// Read current shipment for branch check, operator restriction, and route management.
	current, _ := h.svc.GetByTrackingID(trackingID)
	fromStatus := current.Status

	if branchForbidden(c, user, current.ReceivingBranchID) {
		return
	}
	if user.Role == model.RoleOperator || user.Role == model.RoleSupervisor {
		if fromStatus == model.StatusOutForDelivery {
			c.JSON(http.StatusForbidden, gin.H{"error": "solo los choferes pueden modificar envíos en estado de reparto"})
			return
		}
	}
	if user.Role == model.RoleDriver {
		if err := h.routeSvc.ValidateDriverCanUpdateShipment(user.ID, trackingID, req.Status); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
	}

	today := model.NewDateOnly(timeNow())
	if req.Status == model.StatusOutForDelivery && req.DriverID != "" {
		if err := h.routeSvc.CanAssignToRoute(req.DriverID, today); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	shipment, err := h.svc.UpdateStatus(trackingID, req)
	if err == nil {
		if req.Status == model.StatusOutForDelivery && req.DriverID != "" {
			// Remove from any existing driver route (handles retry with same or different driver),
			// then assign to the (new) driver.
			_ = h.routeSvc.RemoveShipmentFromTodayRoute(trackingID)
			_ = h.routeSvc.AddShipmentToDriverRoute(req.DriverID, trackingID, today)
		} else if (req.Status == model.StatusAtHub || req.Status == model.StatusAtOriginHub) && fromStatus == model.StatusDeliveryFailed {
			// Shipment returned to branch — remove from driver route.
			_ = h.routeSvc.RemoveShipmentFromTodayRoute(trackingID)
		}
		if user.Role == model.RoleDriver &&
			(req.Status == model.StatusDelivered || req.Status == model.StatusDeliveryFailed || req.Status == model.StatusLost) {
			h.routeSvc.CheckAndFinalizeRoute(user.ID)
		}
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// BulkUpdateStatus transitions multiple shipments to ready_for_pickup or delivering.
func (h *ShipmentHandler) BulkUpdateStatus(c *gin.Context) {
	var req model.BulkStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Status != model.StatusReadyForPickup && req.Status != model.StatusOutForDelivery {
		c.JSON(http.StatusBadRequest, gin.H{"error": "solo se permite ready_for_pickup o out_for_delivery en actualizaciones masivas"})
		return
	}
	if req.Status == model.StatusOutForDelivery && req.DriverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "driver_id es requerido para el estado out_for_delivery"})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)
	today := model.NewDateOnly(timeNow())

	if req.Status == model.StatusOutForDelivery && req.DriverID != "" {
		if err := h.routeSvc.CanAssignToRoute(req.DriverID, today); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	result := model.BulkStatusResult{Skipped: []model.BulkSkipped{}}

	for _, trackingID := range req.TrackingIDs {
		current, err := h.svc.GetByTrackingID(trackingID)
		if err != nil {
			result.Skipped = append(result.Skipped, model.BulkSkipped{TrackingID: trackingID, Reason: "envío no encontrado"})
			continue
		}

		if (user.Role == model.RoleOperator || user.Role == model.RoleSupervisor) && user.BranchID != "" && current.ReceivingBranchID != user.BranchID {
			result.Skipped = append(result.Skipped, model.BulkSkipped{TrackingID: trackingID, Reason: "sin permiso de sucursal"})
			continue
		}

		statusReq := model.UpdateStatusRequest{
			Status:    req.Status,
			ChangedBy: user.Username,
			DriverID:  req.DriverID,
		}
		_, err = h.svc.UpdateStatus(trackingID, statusReq)
		if err != nil {
			result.Skipped = append(result.Skipped, model.BulkSkipped{TrackingID: trackingID, Reason: err.Error()})
			continue
		}

		if req.Status == model.StatusOutForDelivery {
			_ = h.routeSvc.RemoveShipmentFromTodayRoute(trackingID)
			_ = h.routeSvc.AddShipmentToDriverRoute(req.DriverID, trackingID, today)
		}
		result.Updated++
	}

	c.JSON(http.StatusOK, result)
}

// isDriverActiveStatus returns true for statuses where a shipment is actively assigned to a driver.
func isDriverActiveStatus(s model.Status) bool {
	return s == model.StatusOutForDelivery || s == model.StatusDeliveryFailed
}

// GetEvents returns the full event history for a shipment.
//
// @Summary      Shipment events
// @Description  Returns the immutable audit log of all status changes and edits. All authenticated roles.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Shipment tracking ID"
// @Success      200          {array}   model.ShipmentEvent
// @Failure      401          {object}  map[string]string
// @Failure      404          {object}  map[string]string
// @Router       /shipments/{tracking_id}/events [get]
func (h *ShipmentHandler) GetEvents(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	shipment, err := h.svc.GetByTrackingID(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}
	if userVal, exists := c.Get(middleware.UserKey); exists {
		user := userVal.(model.User)
		if operatorReadForbidden(c, user, shipment) {
			return
		}
	}
	events, err := h.svc.GetEvents(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}
	c.JSON(http.StatusOK, events)
}

// GetPublicByTrackingID returns a redacted shipment view for the public tracking page.
// No personal data is exposed (no names, DNI, phone, email, full address). Drafts return 404.
//
// @Summary      Public shipment lookup
// @Description  Public-safe shipment view for end users. Returns 404 for drafts and unknown IDs.
// @Tags         public
// @Produce      json
// @Param        tracking_id  path      string  true  "Shipment tracking ID"
// @Success      200          {object}  model.PublicShipmentView
// @Failure      404          {object}  map[string]string
// @Router       /public/track/{tracking_id} [get]
func (h *ShipmentHandler) GetPublicByTrackingID(c *gin.Context) {
	shipment, err := h.svc.GetByTrackingID(c.Param("tracking_id"))
	if err != nil || shipment.Status == model.StatusDraft {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}
	c.JSON(http.StatusOK, shipment.ToPublicView())
}

// GetPublicEvents returns the redacted event timeline for the public tracking page.
// Operator usernames and free-form notes are stripped; "edited" events are filtered out
// since they're internal corrections that don't belong on the public timeline.
//
// @Summary      Public event timeline
// @Description  Public-safe event timeline for end users. Returns 404 for drafts and unknown IDs.
// @Tags         public
// @Produce      json
// @Param        tracking_id  path      string  true  "Shipment tracking ID"
// @Success      200          {array}   model.PublicShipmentEvent
// @Failure      404          {object}  map[string]string
// @Router       /public/track/{tracking_id}/events [get]
func (h *ShipmentHandler) GetPublicEvents(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	shipment, err := h.svc.GetByTrackingID(trackingID)
	if err != nil || shipment.Status == model.StatusDraft {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}
	events, err := h.svc.GetEvents(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}
	out := make([]model.PublicShipmentEvent, 0, len(events))
	for _, ev := range events {
		if ev.EventType == "edited" {
			continue
		}
		out = append(out, ev.ToPublicEvent())
	}
	c.JSON(http.StatusOK, out)
}

// PublicStats returns aggregated, non-personal metrics for the login screen.
//
// @Summary      Public stats
// @Description  Aggregated counters (total confirmed shipments, in-transit, active branches) for the login screen. No personal data, no auth.
// @Tags         public
// @Produce      json
// @Success      200  {object}  model.PublicStats
// @Failure      500  {object}  map[string]string
// @Router       /public/stats [get]
func (h *ShipmentHandler) PublicStats(c *gin.Context) {
	stats, err := h.svc.Stats(model.ShipmentFilter{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	confirmed := stats.Total - stats.ByStatus[model.StatusDraft]
	inTransit := stats.ByStatus[model.StatusLoaded] +
		stats.ByStatus[model.StatusInTransit] +
		stats.ByStatus[model.StatusOutForDelivery]
	c.JSON(http.StatusOK, model.PublicStats{
		TotalShipments: confirmed,
		InTransit:      inTransit,
		ActiveBranches: len(h.branchSvc.ListActive()),
	})
}

// Search finds shipments by tracking ID or recipient name.
//
// @Summary      Search shipments
// @Description  Searches by partial tracking ID or recipient name. Non-driver roles only.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Param        q    query     string  true  "Search query (tracking ID or recipient name)"
// @Success      200  {array}   model.Shipment
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      500  {object}  map[string]string
// @Router       /search [get]
func (h *ShipmentHandler) Search(c *gin.Context) {
	shipments, err := h.svc.Search(c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipments)
}

// CorrectShipment applies non-destructive field corrections to a confirmed shipment.
//
// @Summary      Correct shipment data
// @Description  Non-destructively overrides shipment fields. Original data is preserved. Each corrected field generates an auto-comment. Supervisor and admin only.
// @Tags         shipments
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string                       true  "Shipment tracking ID"
// @Param        body         body      model.CorrectShipmentRequest  true  "Field corrections"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Failure      401          {object}  map[string]string
// @Failure      403          {object}  map[string]string
// @Router       /shipments/{tracking_id}/correct [patch]
func (h *ShipmentHandler) CorrectShipment(c *gin.Context) {
	var req model.CorrectShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	if existing, err := h.svc.GetByTrackingID(trackingID); err == nil {
		if branchForbidden(c, user, existing.ReceivingBranchID) {
			return
		}
	}
	shipment, err := h.svc.CorrectShipment(trackingID, user.Username, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// CancelShipment cancels a shipment.
//
// @Summary      Cancel shipment
// @Description  Transitions a shipment to cancelled. Requires a non-empty reason. Blocked on pending and terminal states. Supervisor and admin only.
// @Tags         shipments
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string                    true  "Shipment tracking ID"
// @Param        body         body      handler.CancelRequest      true  "Cancellation reason"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Failure      401          {object}  map[string]string
// @Failure      403          {object}  map[string]string
// @Router       /shipments/{tracking_id}/cancel [post]
func (h *ShipmentHandler) CancelShipment(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	if existing, err := h.svc.GetByTrackingID(trackingID); err == nil {
		if branchForbidden(c, user, existing.ReceivingBranchID) {
			return
		}
	}
	shipment, err := h.svc.CancelShipment(trackingID, user.Username, body.Reason)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// Stats returns dashboard statistics.
//
// @Summary      Dashboard stats
// @Description  Returns total shipment count, breakdown by status, and active count by branch. Supervisor, manager, and admin only.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Success      200  {object}  model.Stats
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      500  {object}  map[string]string
// @Router       /stats [get]
func (h *ShipmentHandler) Stats(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	filter := model.ShipmentFilter{}
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		filter.DateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		filter.DateTo = &endOfDay
	}
	// Supervisors are restricted to their own branch regardless of query params.
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		filter.ReceivingBranchID = user.BranchID
	} else if branchID := c.Query("branch_id"); branchID != "" {
		filter.ReceivingBranchID = branchID
	}
	stats, err := h.svc.Stats(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// StatsDetail returns KPI breakdown by branch for drill-down.
//
// @Summary      KPI drill-down detail
// @Description  Returns a per-branch breakdown of shipments for a given status filter. Used for Capa 2 drill-down from the dashboard. Supervisor, manager, and admin only.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Param        status     query  string  false  "Status filter (e.g. delivered, in_transit)"
// @Param        date_from  query  string  false  "Start date (YYYY-MM-DD)"
// @Param        date_to    query  string  false  "End date (YYYY-MM-DD)"
// @Success      200        {object}  map[string]int
// @Failure      401        {object}  map[string]string
// @Failure      403        {object}  map[string]string
// @Failure      500        {object}  map[string]string
// @Router       /stats/detail [get]
func (h *ShipmentHandler) StatsDetail(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	statusFilter := c.Query("status")
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		dateTo = &t
	}
	result, err := h.svc.StatsDetail(statusFilter, dateFrom, dateTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Supervisors see only their branch.
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		if count, ok := result[user.BranchID]; ok {
			result = map[string]int{user.BranchID: count}
		} else {
			result = map[string]int{user.BranchID: 0}
		}
	}
	c.JSON(http.StatusOK, result)
}

// CancellationStats returns cancellations grouped by day and reason.
func (h *ShipmentHandler) CancellationStats(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		dateTo = &t
	}
	branchID := c.Query("branch_id")
	if user.Role == model.RoleSupervisor && user.BranchID != "" {
		branchID = user.BranchID
	}

	result, err := h.svc.CancellationStats(dateFrom, dateTo, branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

// AvgTimePerStatus returns average time spent in each shipment status.
func (h *ShipmentHandler) AvgTimePerStatus(c *gin.Context) {
	var dateFrom, dateTo *time.Time
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_from, usá AAAA-MM-DD"})
			return
		}
		dateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato inválido para date_to, usá AAAA-MM-DD"})
			return
		}
		dateTo = &t
	}

	result, err := h.svc.AvgTimePerStatus(dateFrom, dateTo)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}
