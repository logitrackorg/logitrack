package service

import (
	"fmt"
	"math"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// PricingService computes the cost of a shipment based on the active PricingConfig.
// Pricing is calculated once at creation/confirmation and never recalculated —
// see CLAUDE.md and docs/specs for the immutability rules and which fields are
// blocked from post-confirmation editing because they would change the price.
type PricingService struct {
	repo repository.PricingConfigRepository
}

func NewPricingService(repo repository.PricingConfigRepository) *PricingService {
	return &PricingService{repo: repo}
}

func (s *PricingService) GetConfig() model.PricingConfig {
	return s.repo.Get()
}

func (s *PricingService) UpdateConfig(cfg model.PricingConfig) (model.PricingConfig, error) {
	if err := validatePricingConfig(cfg); err != nil {
		return model.PricingConfig{}, err
	}
	if err := s.repo.Update(cfg); err != nil {
		return model.PricingConfig{}, err
	}
	return s.repo.Get(), nil
}

// Quote returns the calculated price + breakdown for a shipment without persisting it.
// Used by the /pricing/quote endpoint and during creation flows.
func (s *PricingService) Quote(input PricingInput) (float64, model.PriceBreakdown) {
	cfg := s.repo.Get()
	return computePrice(cfg, input)
}

// CalculateForShipment is a convenience helper for service-level callers that
// have a fully-formed Shipment in hand (e.g. seed loading or post-creation hooks).
func (s *PricingService) CalculateForShipment(shipment model.Shipment) (float64, model.PriceBreakdown) {
	return s.Quote(PricingInput{
		WeightKg:     shipment.WeightKg,
		PackageType:  shipment.PackageType,
		ShipmentType: shipment.ShipmentType,
		TimeWindow:   shipment.TimeWindow,
		IsFragile:      shipment.IsFragile,
		DeliveryMethod: shipment.DeliveryMethod,
		Origin:         shipment.Sender.Address,
		Destination:    shipment.Recipient.Address,
	})
}

// PricingInput holds the minimum data needed to quote a shipment. Fields mirror
// the shipment model but are decoupled so quoting works before a Shipment exists
// (e.g. while the user is still filling the New Shipment form).
type PricingInput struct {
	WeightKg       float64                `json:"weight_kg"`
	PackageType    model.PackageType      `json:"package_type"`
	ShipmentType   model.ShipmentType     `json:"shipment_type"`
	TimeWindow     model.TimeWindow       `json:"time_window"`
	IsFragile      bool                   `json:"is_fragile"`
	DeliveryMethod model.DeliveryMethod   `json:"delivery_method"`
	Origin         model.Address          `json:"origin"`
	Destination    model.Address          `json:"destination"`
}

func computePrice(cfg model.PricingConfig, in PricingInput) (float64, model.PriceBreakdown) {
	distanceKm := resolveDistance(in.Origin, in.Destination)
	distanceCost := cfg.CostPerKm * distanceKm
	shipmentMultiplier := model.ShipmentTypeMultiplier(in.ShipmentType, cfg)

	weightSurcharge := 0.0
	switch {
	case in.WeightKg > model.WeightTierHighLowKg:
		weightSurcharge = cfg.WeightSurchargeHigh
	case in.WeightKg > model.WeightTierMidLowKg:
		weightSurcharge = cfg.WeightSurchargeMid
	}

	lastMileSurcharge := 0.0
	if in.DeliveryMethod == model.DeliveryMethodLastMile {
		lastMileSurcharge = cfg.LastMileSurcharge
	}

	subtotal := (cfg.BaseFare+distanceCost)*shipmentMultiplier + weightSurcharge + lastMileSurcharge

	timeWindowMult := model.TimeWindowMultiplier(in.TimeWindow, cfg)
	fragileMult := 1.0
	if in.IsFragile {
		fragileMult = cfg.FragileMultiplier
	}

	afterTimeWindow := subtotal * timeWindowMult
	timeWindowSurplus := afterTimeWindow - subtotal
	total := afterTimeWindow * fragileMult
	fragileSurplus := total - afterTimeWindow

	return round2(total), model.PriceBreakdown{
		BaseFare:           round2(cfg.BaseFare),
		DistanceKm:         round2(distanceKm),
		DistanceCost:       round2(distanceCost),
		WeightSurcharge:    round2(weightSurcharge),
		LastMileSurcharge:  round2(lastMileSurcharge),
		ShipmentMultiplier: shipmentMultiplier,
		TimeWindowSurplus:  round2(timeWindowSurplus),
		FragileSurplus:     round2(fragileSurplus),
		Subtotal:           round2(subtotal),
		Total:              round2(total),
	}
}

// resolveDistance picks the most precise distance available: real lat/lng first,
// falling back to province centroids if either side lacks coordinates.
func resolveDistance(origin, destination model.Address) float64 {
	if origin.Latitude != nil && origin.Longitude != nil &&
		destination.Latitude != nil && destination.Longitude != nil {
		return ml.HaversineKm(*origin.Latitude, *origin.Longitude, *destination.Latitude, *destination.Longitude)
	}
	oLat, oLng := origin.Latitude, origin.Longitude
	if oLat == nil || oLng == nil {
		lat, lng, _ := geo.GeocodeShipmentAddress(origin.Street, origin.City, origin.Province)
		if lat != 0 || lng != 0 {
			oLat, oLng = &lat, &lng
		}
	}
	dLat, dLng := destination.Latitude, destination.Longitude
	if dLat == nil || dLng == nil {
		lat, lng, _ := geo.GeocodeShipmentAddress(destination.Street, destination.City, destination.Province)
		if lat != 0 || lng != 0 {
			dLat, dLng = &lat, &lng
		}
	}
	if oLat != nil && oLng != nil && dLat != nil && dLng != nil {
		return ml.HaversineKm(*oLat, *oLng, *dLat, *dLng)
	}
	return ml.ComputeDistance(origin.Province, destination.Province)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func validatePricingConfig(cfg model.PricingConfig) error {
	if cfg.BaseFare < 0 || cfg.CostPerKm < 0 ||
		cfg.WeightSurchargeMid < 0 || cfg.WeightSurchargeHigh < 0 || cfg.LastMileSurcharge < 0 {
		return fmt.Errorf("los importes no pueden ser negativos")
	}
	if cfg.ShipmentExpressMultiplier < 1 {
		return fmt.Errorf("el multiplicador express debe ser ≥ 1")
	}
	if cfg.TimeWindowRestrictiveMultiplier < 1 || cfg.FragileMultiplier < 1 {
		return fmt.Errorf("los multiplicadores de ventana y frágil deben ser ≥ 1")
	}
	return nil
}
