package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type CommentHandler struct {
	svc         *service.CommentService
	shipmentSvc *service.ShipmentService
}

func NewCommentHandler(svc *service.CommentService, shipmentSvc *service.ShipmentService) *CommentHandler {
	return &CommentHandler{svc: svc, shipmentSvc: shipmentSvc}
}

// GetComments returns all internal comments for a shipment.
//
// @Summary      List comments
// @Description  Returns internal notes for a shipment. Accessible to all authenticated roles.
// @Tags         comments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Shipment tracking ID"
// @Success      200          {array}   model.ShipmentComment
// @Failure      401          {object}  map[string]string
// @Failure      404          {object}  map[string]string
// @Router       /shipments/{tracking_id}/comments [get]
func (h *CommentHandler) GetComments(c *gin.Context) {
	trackingID := c.Param("tracking_id")
	user := c.MustGet(middleware.UserKey).(model.User)
	if shipment, err := h.shipmentSvc.GetByTrackingID(trackingID); err == nil {
		if operatorReadForbidden(c, user, shipment) {
			return
		}
	}
	comments, err := h.svc.GetComments(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, comments)
}

// AddComment adds an internal note to a shipment.
//
// @Summary      Add comment
// @Description  Adds an internal note to a shipment. Only supervisor and admin. Cannot add to delivered or returned shipments.
// @Tags         comments
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string                  true  "Shipment tracking ID"
// @Param        body         body      model.AddCommentRequest  true  "Comment body"
// @Success      201          {object}  model.ShipmentComment
// @Failure      400          {object}  map[string]string
// @Failure      401          {object}  map[string]string
// @Failure      403          {object}  map[string]string
// @Router       /shipments/{tracking_id}/comments [post]
func (h *CommentHandler) AddComment(c *gin.Context) {
	var req model.AddCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")
	if existing, err := h.shipmentSvc.GetByTrackingID(trackingID); err == nil {
		if branchForbidden(c, user, existing.ReceivingBranchID) {
			return
		}
	}
	comment, err := h.svc.AddComment(trackingID, user.Username, req.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, comment)
}
