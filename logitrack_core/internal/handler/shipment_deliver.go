package handler

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

const maxDeliveryPhotoBytes = 10 << 20 // 10 MB

// DeliverShipment handles POST /shipments/:tracking_id/deliver (driverOnly).
// Accepts multipart/form-data with fields: keyword, recipient_dni, contingency,
// current_speed, speed_source, and a required "photo" image file.
func (h *ShipmentHandler) DeliverShipment(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	trackingID := c.Param("tracking_id")

	if err := c.Request.ParseMultipartForm(maxDeliveryPhotoBytes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "formato de solicitud inválido"})
		return
	}

	keyword := strings.TrimSpace(c.PostForm("keyword"))
	recipientDNI := strings.TrimSpace(c.PostForm("recipient_dni"))
	contingency := c.PostForm("contingency") == "true"
	var currentSpeed float64
	if s := c.PostForm("current_speed"); s != "" {
		currentSpeed, _ = strconv.ParseFloat(s, 64)
	}
	speedSource := c.PostForm("speed_source")

	// Photo is mandatory for última milla delivery.
	fileHeader, err := c.FormFile("photo")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "la foto de entrega es obligatoria"})
		return
	}
	if fileHeader.Size > maxDeliveryPhotoBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "la foto no puede superar los 10 MB"})
		return
	}
	mimeType := fileHeader.Header.Get("Content-Type")
	if !strings.HasPrefix(mimeType, "image/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "solo se permiten imágenes como foto de entrega"})
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo leer la foto"})
		return
	}
	defer f.Close()
	photoData, err := io.ReadAll(io.LimitReader(f, maxDeliveryPhotoBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo leer la foto"})
		return
	}
	if int64(len(photoData)) > maxDeliveryPhotoBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "la foto no puede superar los 10 MB"})
		return
	}

	updated, err := h.svc.DeliverShipment(trackingID, service.DeliverRequest{
		Keyword:      keyword,
		RecipientDNI: recipientDNI,
		Contingency:  contingency,
		DriverID:     user.ID,
		ChangedBy:    user.Username,
		CurrentSpeed: currentSpeed,
		SpeedSource:  speedSource,
		Photo:        &service.DeliveryPhotoUpload{Data: photoData, MimeType: mimeType},
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}
