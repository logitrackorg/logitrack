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

func (h *ShipmentHandler) ConfirmDraft(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	shipment, err := h.svc.ConfirmDraft(c.Param("tracking_id"), user.Username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

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

func (h *ShipmentHandler) GetByTrackingID(c *gin.Context) {
	shipment, err := h.svc.GetByTrackingID(c.Param("tracking_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "shipment not found"})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (h *ShipmentHandler) UpdateStatus(c *gin.Context) {
	var req model.UpdateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	req.ChangedBy = user.Username
	if user.Role == model.RoleDriver {
		if err := h.routeSvc.ValidateDriverCanUpdateShipment(user.ID, c.Param("tracking_id"), req.Status); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
	}
	trackingID := c.Param("tracking_id")
	shipment, err := h.svc.UpdateStatus(trackingID, req)
	if err == nil && req.Status == model.StatusDelivering && req.DriverID != "" {
		today := timeNow().Format("2006-01-02")
		_ = h.routeSvc.AddShipmentToDriverRoute(req.DriverID, trackingID, today)
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipment)
}

func (h *ShipmentHandler) GetEvents(c *gin.Context) {
	events, err := h.svc.GetEvents(c.Param("tracking_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "shipment not found"})
		return
	}
	c.JSON(http.StatusOK, events)
}

func (h *ShipmentHandler) Search(c *gin.Context) {
	shipments, err := h.svc.Search(c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, shipments)
}

func (h *ShipmentHandler) CorrectShipment(c *gin.Context) {
	var req model.CorrectShipmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	shipment, commentBodies, err := h.svc.CorrectShipment(trackingID, user.Username, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, body := range commentBodies {
		_, _ = h.commentSvc.AddComment(trackingID, user.Username, body)
	}
	c.JSON(http.StatusOK, shipment)
}

func (h *ShipmentHandler) Stats(c *gin.Context) {
	stats, err := h.svc.Stats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}
