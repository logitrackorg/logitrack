package service

import (
	"math"
	"testing"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func newPricingSvc() *PricingService {
	return NewPricingService(repository.NewInMemoryPricingConfigRepository(), nil)
}

func fPtr(f float64) *float64 { return &f }

// addrCABA returns a Buenos Aires address with lat/lng set.
func addrCABA() model.Address {
	return model.Address{
		City:      "Ciudad de Buenos Aires",
		Province:  "Buenos Aires",
		Latitude:  fPtr(-34.6037),
		Longitude: fPtr(-58.3816),
	}
}

// addrCordoba returns a Córdoba address with lat/lng set.
func addrCordoba() model.Address {
	return model.Address{
		City:      "Córdoba",
		Province:  "Córdoba",
		Latitude:  fPtr(-31.4201),
		Longitude: fPtr(-64.1888),
	}
}

func approxEq(a, b float64) bool {
	return math.Abs(a-b) < 0.5
}

func TestPricing_BaseCase_NormalBoxFlexible(t *testing.T) {
	svc := newPricingSvc()
	in := PricingInput{
		WeightKg:     2,
		PackageType:  model.PackageBox,
		ShipmentType: model.ShipmentTypeNormal,
		TimeWindow:   model.TimeWindowFlexible,
		Origin:       addrCABA(),
		Destination:  addrCABA(),
	}
	total, b := svc.Quote(in)

	if total != b.Total {
		t.Errorf("total %v != breakdown.Total %v", total, b.Total)
	}
	if b.DistanceKm != 0 {
		t.Errorf("intra-CABA debería dar 0 km, got %v", b.DistanceKm)
	}
	if b.WeightSurcharge != 0 {
		t.Errorf("2kg no debería tener recargo de peso, got %v", b.WeightSurcharge)
	}
	if b.TimeWindowSurplus != 0 || b.FragileSurplus != 0 {
		t.Errorf("flexible + no fragile no debería sumar, got tw=%v fr=%v", b.TimeWindowSurplus, b.FragileSurplus)
	}
	if !approxEq(total, 10000) {
		t.Errorf("base intra-CABA esperada 10000, got %v", total)
	}
}

func TestPricing_DistanceAffectsPrice(t *testing.T) {
	svc := newPricingSvc()
	in := PricingInput{
		WeightKg:     2,
		PackageType:  model.PackageBox,
		ShipmentType: model.ShipmentTypeNormal,
		TimeWindow:   model.TimeWindowFlexible,
		Origin:       addrCABA(),
		Destination:  addrCordoba(),
	}
	total, b := svc.Quote(in)
	if b.DistanceKm < 600 || b.DistanceKm > 800 {
		t.Errorf("CABA→CBA distancia esperada ~700km, got %v", b.DistanceKm)
	}
	cfg := model.DefaultPricingConfig()
	expected := cfg.BaseFare + cfg.CostPerKm*b.DistanceKm
	if !approxEq(total, expected) {
		t.Errorf("precio esperado %v, got %v", expected, total)
	}
}

func TestPricing_WeightTiers(t *testing.T) {
	svc := newPricingSvc()
	base := PricingInput{
		PackageType:  model.PackageBox,
		ShipmentType: model.ShipmentTypeNormal,
		TimeWindow:   model.TimeWindowFlexible,
		Origin:       addrCABA(),
		Destination:  addrCABA(),
	}
	cases := []struct {
		name     string
		weight   float64
		surplus  float64
	}{
		{"low", 4.9, 0},
		{"boundary-5", 5.0, 0},
		{"mid", 5.1, 5000},
		{"mid-25", 25.0, 5000},
		{"high", 25.1, 25000},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := base
			in.WeightKg = c.weight
			_, b := svc.Quote(in)
			if b.WeightSurcharge != c.surplus {
				t.Errorf("peso %v: esperaba surcharge %v, got %v", c.weight, c.surplus, b.WeightSurcharge)
			}
		})
	}
}


func TestPricing_ExpressMultiplier(t *testing.T) {
	svc := newPricingSvc()
	in := PricingInput{
		WeightKg:    1,
		PackageType: model.PackageBox,
		TimeWindow:  model.TimeWindowFlexible,
		Origin:      addrCABA(),
		Destination: addrCordoba(),
	}
	in.ShipmentType = model.ShipmentTypeNormal
	normal, _ := svc.Quote(in)
	in.ShipmentType = model.ShipmentTypeExpress
	express, _ := svc.Quote(in)

	mult := model.DefaultPricingConfig().ShipmentExpressMultiplier
	if !approxEq(express, normal*mult) {
		t.Errorf("express esperaba %v (%v×normal), got %v", normal*mult, mult, express)
	}
}

func TestPricing_RestrictiveTimeWindowAddsSurcharge(t *testing.T) {
	svc := newPricingSvc()
	base := PricingInput{
		WeightKg:     1,
		PackageType:  model.PackageBox,
		ShipmentType: model.ShipmentTypeNormal,
		Origin:       addrCABA(),
		Destination:  addrCordoba(),
	}
	base.TimeWindow = model.TimeWindowFlexible
	flex, _ := svc.Quote(base)
	base.TimeWindow = model.TimeWindowMorning
	morning, _ := svc.Quote(base)
	base.TimeWindow = model.TimeWindowAfternoon
	afternoon, _ := svc.Quote(base)

	if !approxEq(morning, afternoon) {
		t.Errorf("morning y afternoon deberían tener mismo precio, got m=%v a=%v", morning, afternoon)
	}
	mult := model.DefaultPricingConfig().TimeWindowRestrictiveMultiplier
	if !approxEq(morning, flex*mult) {
		t.Errorf("restrictive esperaba %vx, flex=%v restrictive=%v", mult, flex, morning)
	}
}

func TestPricing_FragileSurcharge(t *testing.T) {
	svc := newPricingSvc()
	in := PricingInput{
		WeightKg:     1,
		PackageType:  model.PackageBox,
		ShipmentType: model.ShipmentTypeNormal,
		TimeWindow:   model.TimeWindowFlexible,
		Origin:       addrCABA(),
		Destination:  addrCordoba(),
	}
	in.IsFragile = false
	noFr, _ := svc.Quote(in)
	in.IsFragile = true
	fr, _ := svc.Quote(in)
	if !approxEq(fr, noFr*1.20) {
		t.Errorf("fragile esperaba +20%%, no=%v fragile=%v", noFr, fr)
	}
}

func TestPricing_DistanceFallbackToProvince(t *testing.T) {
	svc := newPricingSvc()
	in := PricingInput{
		WeightKg:     1,
		PackageType:  model.PackageBox,
		ShipmentType: model.ShipmentTypeNormal,
		TimeWindow:   model.TimeWindowFlexible,
		Origin:       model.Address{City: "Ciudad de Buenos Aires", Province: "Buenos Aires"},
		Destination:  model.Address{City: "Córdoba", Province: "Córdoba"},
	}
	_, b := svc.Quote(in)
	if b.DistanceKm < 100 {
		t.Errorf("fallback a provincia debería dar distancia > 0, got %v", b.DistanceKm)
	}
}

func TestPricing_UpdateConfig_Validation(t *testing.T) {
	svc := newPricingSvc()
	bad := model.PricingConfig{}
	if _, err := svc.UpdateConfig(bad); err == nil {
		t.Error("config con multiplicadores en 0 debería fallar")
	}
	good := model.DefaultPricingConfig()
	good.BaseFare = 2000
	updated, err := svc.UpdateConfig(good)
	if err != nil {
		t.Fatalf("update válido falló: %v", err)
	}
	if updated.BaseFare != 2000 {
		t.Errorf("BaseFare no se actualizó, got %v", updated.BaseFare)
	}
}

func TestPricing_FullCombination(t *testing.T) {
	svc := newPricingSvc()
	in := PricingInput{
		WeightKg:     30,
		PackageType:  model.PackageBox,
		ShipmentType: model.ShipmentTypeExpress,
		TimeWindow:   model.TimeWindowMorning,
		IsFragile:    true,
		Origin:       addrCABA(),
		Destination:  addrCordoba(),
	}
	total, b := svc.Quote(in)
	if total != b.Total {
		t.Errorf("total mismatch")
	}
	if b.WeightSurcharge != 25000 {
		t.Errorf("30kg debería dar surcharge 25000, got %v", b.WeightSurcharge)
	}
	expected := model.DefaultPricingConfig().ShipmentExpressMultiplier
	if b.ShipmentMultiplier != expected {
		t.Errorf("express esperaba %v, got %v", expected, b.ShipmentMultiplier)
	}
	if b.TimeWindowSurplus <= 0 || b.FragileSurplus <= 0 {
		t.Errorf("morning + fragile deberían sumar, got tw=%v fr=%v", b.TimeWindowSurplus, b.FragileSurplus)
	}
}
