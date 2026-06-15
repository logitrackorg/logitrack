package handler

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
)

// GetDeliveryPhoto serves the delivery evidence photo for a shipment.
// GET /shipments/:tracking_id/delivery-photo — shipmentRead (operator, supervisor, manager).
func (h *ShipmentHandler) GetDeliveryPhoto(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")

	shipment, err := h.svc.GetByTrackingID(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "envío no encontrado"})
		return
	}

	if branchForbidden(c, user, shipment.ReceivingBranchID) {
		return
	}

	events, err := h.svc.GetEvents(trackingID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener el historial del envío"})
		return
	}

	var photoPath, photoName string
	for _, ev := range events {
		if ev.ToStatus == model.StatusDelivered && ev.HasDeliveryPhoto && ev.DeliveryPhotoPath != "" {
			photoPath = ev.DeliveryPhotoPath
			photoName = ev.DeliveryPhotoName
			break
		}
	}

	if photoPath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "el envío no tiene foto de entrega"})
		return
	}

	if _, statErr := os.Stat(photoPath); statErr != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "la foto de entrega no está disponible"})
		return
	}

	if photoName == "" {
		photoName = filepath.Base(photoPath)
	}
	c.FileAttachment(photoPath, photoName)
}
