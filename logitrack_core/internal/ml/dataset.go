package ml

import (
	"math"
	"math/rand"
)

// Province coordinates (lat, lng) — centroids for all 23 provinces + CABA.
var ProvinceCoords = map[string][2]float64{
	"Buenos Aires":           {-36.60, -60.50},
	"Ciudad de Buenos Aires": {-34.60, -58.38},
	"Catamarca":              {-28.47, -65.78},
	"Chaco":                  {-26.39, -60.73},
	"Chubut":                 {-43.30, -68.90},
	"Córdoba":                {-31.40, -64.18},
	"Corrientes":             {-28.66, -58.44},
	"Entre Ríos":             {-32.00, -59.20},
	"Formosa":                {-25.18, -59.73},
	"Jujuy":                  {-23.32, -65.73},
	"La Pampa":               {-36.62, -65.45},
	"La Rioja":               {-29.41, -66.85},
	"Mendoza":                {-33.88, -68.83},
	"Misiones":               {-26.88, -54.58},
	"Neuquén":                {-38.95, -68.06},
	"Río Negro":              {-40.30, -67.30},
	"Salta":                  {-24.78, -65.42},
	"San Juan":               {-31.53, -68.52},
	"San Luis":               {-33.30, -66.34},
	"Santa Cruz":             {-48.80, -69.65},
	"Santa Fe":               {-31.00, -61.00},
	"Santiago del Estero":    {-27.78, -63.25},
	"Tierra del Fuego":       {-53.80, -67.70},
	"Tucumán":                {-26.82, -65.22},
}

var provinces []string

func init() {
	for k := range ProvinceCoords {
		provinces = append(provinces, k)
	}
}

var (
	shipmentTypes = []string{"normal", "express"}
	timeWindows   = []string{"morning", "afternoon", "flexible"}
	packageTypes  = []string{"envelope", "box", "pallet"}
)

// HaversineKm calculates distance between two points on Earth using Haversine formula.
func HaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371 // Earth radius in km
	lat1r := lat1 * math.Pi / 180
	lng1r := lng1 * math.Pi / 180
	lat2r := lat2 * math.Pi / 180
	lng2r := lng2 * math.Pi / 180
	dlat := lat2r - lat1r
	dlng := lng2r - lng1r
	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(lat1r)*math.Cos(lat2r)*math.Sin(dlng/2)*math.Sin(dlng/2)
	c := 2 * math.Asin(math.Sqrt(a))
	return R * c
}

// ComputeDistance computes distance in km between two provinces.
func ComputeDistance(originProvince, destProvince string) float64 {
	o, ok := ProvinceCoords[originProvince]
	if !ok {
		o = ProvinceCoords["Ciudad de Buenos Aires"]
	}
	d, ok := ProvinceCoords[destProvince]
	if !ok {
		d = ProvinceCoords["Ciudad de Buenos Aires"]
	}
	return HaversineKm(o[0], o[1], d[0], d[1])
}

// NormalizeFactor normalizes a factor value to 0.0-1.0 range.
func NormalizeFactor(factorName string, value float64, strValue string) float64 {
	switch factorName {
	case "shipment_type":
		if strValue == "express" {
			return 1.0
		}
		return 0.0
	case "distance_km":
		return math.Min(value/2500.0, 1.0)
	case "restrictions":
		return value / 2.0
	case "time_window":
		switch strValue {
		case "morning":
			return 1.0
		case "afternoon":
			return 0.5
		default:
			return 0.0
		}
	case "volume_score":
		return math.Min(value/25.0, 1.0)
	case "route_saturation":
		return value
	}
	return 0.0
}

// ComputeVolumeScore computes volume score from package type and weight.
func ComputeVolumeScore(packageType string, weightKg float64) float64 {
	base, ok := PackageBaseSize[packageType]
	if !ok {
		base = 5
	}
	return base + (weightKg / 2.0)
}

// LabelPriority converts a 0-1 score to a priority label.
func LabelPriority(score float64) string {
	if score > AltaThreshold {
		return "alta"
	} else if score > MediaThreshold {
		return "media"
	}
	return "baja"
}

// ComputeScore computes weighted score from normalized factors.
func ComputeScore(normalized map[string]float64) float64 {
	totalWeight := 0.0
	for _, w := range PriorityFactors {
		totalWeight += w
	}
	weightedSum := 0.0
	for name, norm := range normalized {
		if w, ok := PriorityFactors[name]; ok {
			weightedSum += norm * w
		}
	}
	return weightedSum / totalWeight
}

// Sample represents one training sample.
type Sample struct {
	Features []float64 // normalized factors in FactorOrder
	Class    int       // 0=alta, 1=media, 2=baja
}

// GenerateDataset generates synthetic dataset of shipment samples with priority labels.
func GenerateDataset(size int, seed int64) []Sample {
	rng := rand.New(rand.NewSource(seed))
	samples := make([]Sample, 0, size)

	for i := 0; i < size; i++ {
		origin := provinces[rng.Intn(len(provinces))]
		dest := provinces[rng.Intn(len(provinces))]
		distance := ComputeDistance(origin, dest)
		shipmentType := shipmentTypes[rng.Intn(len(shipmentTypes))]
		timeWindow := timeWindows[rng.Intn(len(timeWindows))]
		packageType := packageTypes[rng.Intn(len(packageTypes))]
		weightKg := rng.Float64()*49.9 + 0.1
		isFragile := rng.Float64() < 0.25
		coldChain := rng.Float64() < 0.10
		routeSaturation := math.Round(rng.Float64()*100) / 100

		restrictionCount := 0.0
		if isFragile {
			restrictionCount++
		}
		if coldChain {
			restrictionCount++
		}
		volume := ComputeVolumeScore(packageType, weightKg)

		normalized := map[string]float64{
			"shipment_type":    NormalizeFactor("shipment_type", 0, shipmentType),
			"distance_km":      NormalizeFactor("distance_km", distance, ""),
			"restrictions":     NormalizeFactor("restrictions", restrictionCount, ""),
			"time_window":      NormalizeFactor("time_window", 0, timeWindow),
			"volume_score":     NormalizeFactor("volume_score", volume, ""),
			"route_saturation": NormalizeFactor("route_saturation", routeSaturation, ""),
		}

		score := ComputeScore(normalized)
		label := LabelPriority(score)

		// Build feature vector in consistent order
		features := make([]float64, len(FactorOrder))
		for j, name := range FactorOrder {
			features[j] = normalized[name]
		}

		class := LabelToClass[label]
		samples = append(samples, Sample{Features: features, Class: class})
	}

	// Apply label noise: flip some labels randomly
	for i := range samples {
		if rng.Float64() < LabelNoiseRate {
			otherClass := rng.Intn(NumClasses - 1)
			if otherClass >= samples[i].Class {
				otherClass++
			}
			samples[i].Class = otherClass
		}
	}

	return samples
}
