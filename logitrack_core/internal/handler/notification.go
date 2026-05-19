package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
	"github.com/logitrack/core/internal/sse"
)

// NotificationHandler handles HTTP requests for the notification center.
type NotificationHandler struct {
	svc *service.NotificationService
	hub *sse.Hub
}

// NewNotificationHandler creates a new NotificationHandler.
func NewNotificationHandler(svc *service.NotificationService, hub *sse.Hub) *NotificationHandler {
	return &NotificationHandler{svc: svc, hub: hub}
}

// RegisterRoutes registers the standard (header-authenticated) notification routes.
func (h *NotificationHandler) RegisterRoutes(r *gin.RouterGroup, auth gin.HandlerFunc) {
	g := r.Group("/notifications", auth)
	g.GET("", h.List)
	g.GET("/unread-count", h.UnreadCount)
	g.PATCH("/read-all", h.MarkAllRead)
	g.PATCH("/:id/read", h.MarkRead)
}

// RegisterStreamRoute registers the SSE stream endpoint on a router group that
// does NOT inherit the header-only Auth middleware (e.g. the public api group).
// sseAuth validates the token from either the Authorization header or ?token=.
func (h *NotificationHandler) RegisterStreamRoute(r *gin.RouterGroup, sseAuth gin.HandlerFunc) {
	r.GET("/notifications/stream", sseAuth, h.Stream)
}

// Stream keeps the connection open and pushes a "notification" event whenever
// a new notification is created for the authenticated user.
// A keep-alive ping is sent every 30 s to prevent proxy timeouts.
func (h *NotificationHandler) Stream(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	client := &sse.Client{
		UserID: user.ID,
		Ch:     make(chan struct{}, 4),
	}
	h.hub.Register(client)
	defer h.hub.Unregister(client)

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no") // disable nginx/caddy buffering
	c.Writer.WriteHeader(http.StatusOK)

	// Initial ping to confirm connection is live.
	fmt.Fprintf(c.Writer, "event: ping\ndata: ok\n\n")
	c.Writer.Flush()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-client.Ch:
			fmt.Fprintf(c.Writer, "event: notification\ndata: {}\n\n")
			c.Writer.Flush()
		case <-ticker.C:
			fmt.Fprintf(c.Writer, "event: ping\ndata: ok\n\n")
			c.Writer.Flush()
		case <-c.Request.Context().Done():
			return
		}
	}
}

// List returns a paginated list of notifications for the authenticated user.
// Query params: search, date_from, date_to, limit (default 20, max 100), offset.
func (h *NotificationHandler) List(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	filters := repository.NotificationFilters{
		Search: c.Query("search"),
		Limit:  20,
		Offset: 0,
	}

	if limitStr := c.Query("limit"); limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil {
			if v > 100 {
				v = 100
			}
			filters.Limit = v
		}
	}
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if v, err := strconv.Atoi(offsetStr); err == nil {
			filters.Offset = v
		}
	}
	if dateFrom := c.Query("date_from"); dateFrom != "" {
		if t, err := time.Parse(time.RFC3339, dateFrom); err == nil {
			filters.DateFrom = &t
		}
	}
	if dateTo := c.Query("date_to"); dateTo != "" {
		if t, err := time.Parse(time.RFC3339, dateTo); err == nil {
			filters.DateTo = &t
		}
	}

	notifications, total, err := h.svc.GetForUser(user.ID, filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"notifications": notifications,
		"total":         total,
		"limit":         filters.Limit,
		"offset":        filters.Offset,
	})
}

// UnreadCount returns the number of unread notifications for the authenticated user.
func (h *NotificationHandler) UnreadCount(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	count, err := h.svc.UnreadCount(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"count": count})
}

// MarkRead marks a single notification as read for the authenticated user.
func (h *NotificationHandler) MarkRead(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	id := c.Param("id")

	if err := h.svc.MarkRead(id, user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// MarkAllRead marks all notifications of the authenticated user as read.
func (h *NotificationHandler) MarkAllRead(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	if err := h.svc.MarkAllRead(user.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
