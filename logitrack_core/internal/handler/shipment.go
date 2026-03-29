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

// CancelRequest is the body for cancelling a shipment.
type CancelRequest struct {
	Reason string `json:"reason" binding:"required"`
}

type ShipmentHandler struct {
	svc        *service.ShipmentService
	routeSvc   *service.RouteService
	commentSvc *service.CommentService
}

func NewShipmentHandler(svc *service.ShipmentService, routeSvc *service.RouteService, commentSvc *service.CommentService) *ShipmentHandler {
	return &ShipmentHandler{svc: svc, routeSvc: routeSvc, commentSvc: commentSvc}
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
	shipment, err := h.svc.SaveDraft(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
	shipment, err := h.svc.UpdateDraft(c.Param("tracking_id"), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

// ConfirmDraft confirms a draft shipment, assigning a real LT- tracking ID.
//
// @Summary      Confirm draft
// @Description  Transitions a pending draft to in_progress, replacing DRAFT- ID with LT-XXXXXXXX. Operator, supervisor, and admin only.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Draft tracking ID (DRAFT-XXXXXXXX)"
// @Success      200          {object}  model.Shipment
// @Failure      400          {object}  map[string]string
// @Failure      401          {object}  map[string]string
// @Failure      403          {object}  map[string]string
// @Router       /shipments/{tracking_id}/confirm [post]
func (h *ShipmentHandler) ConfirmDraft(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	shipment, err := h.svc.ConfirmDraft(c.Param("tracking_id"), user.Username)
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
	filter := model.ShipmentFilter{}
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date_from format, use YYYY-MM-DD"})
			return
		}
		filter.DateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date_to format, use YYYY-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		filter.DateTo = &endOfDay
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
		c.JSON(http.StatusNotFound, gin.H{"error": "shipment not found"})
		return
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
	if user.Role == model.RoleOperator {
		current, err := h.svc.GetByTrackingID(c.Param("tracking_id"))
		if err == nil && current.Status == model.StatusDelivering {
			c.JSON(http.StatusForbidden, gin.H{"error": "operators cannot update shipments in delivering status"})
			return
		}
	}
	if user.Role == model.RoleDriver {
		if err := h.routeSvc.ValidateDriverCanUpdateShipment(user.ID, c.Param("tracking_id"), req.Status); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
	}
	trackingID := c.Param("tracking_id")
	shipment, err := h.svc.UpdateStatus(trackingID, req)
	if err == nil && req.Status == model.StatusDelivering && req.DriverID != "" {
		today := model.NewDateOnly(timeNow())
		_ = h.routeSvc.AddShipmentToDriverRoute(req.DriverID, trackingID, today)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
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
	events, err := h.svc.GetEvents(c.Param("tracking_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "shipment not found"})
		return
	}
	c.JSON(http.StatusOK, events)
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
	shipment, err := h.svc.CancelShipment(c.Param("tracking_id"), user.Username, body.Reason)
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
	filter := model.ShipmentFilter{}
	if raw := c.Query("date_from"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date_from format, use YYYY-MM-DD"})
			return
		}
		filter.DateFrom = &t
	}
	if raw := c.Query("date_to"); raw != "" {
		t, err := time.Parse("2006-01-02", raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid date_to format, use YYYY-MM-DD"})
			return
		}
		endOfDay := t.Add(24*time.Hour - time.Nanosecond)
		filter.DateTo = &endOfDay
	}
	stats, err := h.svc.Stats(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}
