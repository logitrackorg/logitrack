package handler

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"
	//"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type QRHandler struct {
	shipmentSvc *service.ShipmentService
	baseURL     string
}

func NewQRHandler(shipmentSvc *service.ShipmentService) *QRHandler {
	baseURL := os.Getenv("FRONTEND_URL")
	if baseURL == "" {
		baseURL = "http://localhost:5173" // Default para desarrollo
	}
	return &QRHandler{
		shipmentSvc: shipmentSvc,
		baseURL:     baseURL,
	}
}

// GenerateQRResponse representa la respuesta con el código QR
type GenerateQRResponse struct {
	TrackingID   string `json:"tracking_id"`
	QRCodeBase64 string `json:"qr_code_base64"` // PNG en base64
	TrackingURL  string `json:"tracking_url"`
}

// GenerateShipmentQR genera el código QR para un envío
//
// @Summary      Generar código QR de envío
// @Description  Genera un código QR vinculado al tracking ID del envío. Solo para envíos confirmados. All authenticated roles.
// @Tags         shipments
// @Produce      json
// @Security     BearerAuth
// @Param        tracking_id  path      string  true  "Shipment tracking ID"
// @Success      200          {object}  GenerateQRResponse
// @Failure      400          {object}  map[string]string
// @Failure      401          {object}  map[string]string
// @Failure      404          {object}  map[string]string
// @Router       /shipments/{tracking_id}/qr [get]
func (h *QRHandler) GenerateShipmentQR(c *gin.Context) {
	trackingID := c.Param("tracking_id")

	// CA-1: Obtener el envío
	shipment, err := h.shipmentSvc.GetByTrackingID(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Envío no encontrado",
		})
		return
	}

	// CA-3: Validar que tenga tracking ID y no sea borrador
	if !shipment.CanGenerateQR() {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "El código QR solo puede generarse para envíos confirmados con tracking ID asignado",
		})
		return
	}

	// CA-2: Construir URL de seguimiento público
	trackingURL := fmt.Sprintf("%s/shipments/%s", h.baseURL, shipment.TrackingID)

	// Generar QR (256x256 px, nivel de corrección Medium)
	qrPNG, err := qrcode.Encode(trackingURL, qrcode.Medium, 256)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Error al generar código QR",
		})
		return
	}

	// Convertir a Base64 para enviar al frontend
	qrBase64 := base64.StdEncoding.EncodeToString(qrPNG)

	c.JSON(http.StatusOK, GenerateQRResponse{
		TrackingID:   shipment.TrackingID,
		QRCodeBase64: qrBase64,
		TrackingURL:  trackingURL,
	})
}

// DownloadShipmentQR descarga el QR directamente como imagen PNG
//
// @Summary      Descargar código QR
// @Description  Descarga el código QR como archivo PNG de alta calidad para impresión
// @Tags         shipments
// @Produce      image/png
// @Security     BearerAuth
// @Param        tracking_id  path  string  true  "Shipment tracking ID"
// @Success      200  {file}  binary
// @Failure      400  {object}  map[string]string
// @Failure      401  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /shipments/{tracking_id}/qr/download [get]
func (h *QRHandler) DownloadShipmentQR(c *gin.Context) {
	trackingID := c.Param("tracking_id")

	shipment, err := h.shipmentSvc.GetByTrackingID(trackingID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Envío no encontrado"})
		return
	}

	if !shipment.CanGenerateQR() {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "El código QR solo puede generarse para envíos confirmados",
		})
		return
	}

	trackingURL := fmt.Sprintf("%s/shipments/%s", h.baseURL, shipment.TrackingID)

	// Generar QR de alta calidad para impresión (512x512, High error correction)
	qrPNG, err := qrcode.Encode(trackingURL, qrcode.High, 512)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error al generar QR"})
		return
	}

	c.Header("Content-Type", "image/png")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="QR_%s.png"`, shipment.TrackingID))

	c.Data(http.StatusOK, "image/png", qrPNG)
}
