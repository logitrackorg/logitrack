package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type PricingHandler struct {
	svc *service.PricingService
}

func NewPricingHandler(svc *service.PricingService) *PricingHandler {
	return &PricingHandler{svc: svc}
}

// QuoteRequest mirrors PricingInput at the wire level. We keep them separate so
// internal pricing logic can evolve independently from the public API contract.
type QuoteRequest struct {
	WeightKg       float64              `json:"weight_kg"       binding:"required,gt=0"`
	PackageType    model.PackageType    `json:"package_type"    binding:"required"`
	ShipmentType   model.ShipmentType   `json:"shipment_type"`
	TimeWindow     model.TimeWindow     `json:"time_window"`
	IsFragile      bool                 `json:"is_fragile"`
	DeliveryMethod model.DeliveryMethod `json:"delivery_method"`
	Origin         model.Address        `json:"origin"          binding:"required"`
	Destination    model.Address        `json:"destination"     binding:"required"`
}

type QuoteResponse struct {
	Total     float64              `json:"total"`
	Currency  string               `json:"currency"`
	Breakdown model.PriceBreakdown `json:"breakdown"`
}

func (h *PricingHandler) Quote(c *gin.Context) {
	var req QuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	shipmentType := req.ShipmentType
	if shipmentType == "" {
		shipmentType = model.ShipmentTypeNormal
	}
	timeWindow := req.TimeWindow
	if timeWindow == "" {
		timeWindow = model.TimeWindowFlexible
	}
	deliveryMethod := req.DeliveryMethod
	if deliveryMethod == "" {
		deliveryMethod = model.DeliveryMethodLastMile
	}
	total, breakdown := h.svc.Quote(service.PricingInput{
		WeightKg:       req.WeightKg,
		PackageType:    req.PackageType,
		ShipmentType:   shipmentType,
		TimeWindow:     timeWindow,
		IsFragile:      req.IsFragile,
		DeliveryMethod: deliveryMethod,
		Origin:         req.Origin,
		Destination:    req.Destination,
	})
	c.JSON(http.StatusOK, QuoteResponse{Total: total, Currency: model.CurrencyARS, Breakdown: breakdown})
}

func (h *PricingHandler) GetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.GetConfig())
}

func (h *PricingHandler) UpdateConfig(c *gin.Context) {
	var cfg model.PricingConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updated, err := h.svc.UpdateConfig(cfg)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, updated)
}
