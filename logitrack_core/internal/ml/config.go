package ml

// Priority factor weights (higher = more influence on final priority).
var PriorityFactors = map[string]float64{
	"shipment_type":    3.0, // Express = highest priority
	"distance_km":      2.5, // Longer distance = more delay risk
	"restrictions":     2.0, // Fragile/cold chain = special handling
	"time_window":      1.5, // Morning = tighter deadline
	"volume_score":     1.0, // Larger = more complex logistics
	"route_saturation": 0.8, // Busy route = congestion risk
}

// Factor order must be consistent for training and prediction.
var FactorOrder = []string{
	"shipment_type",
	"distance_km",
	"restrictions",
	"time_window",
	"volume_score",
	"route_saturation",
}

const (
	AltaThreshold  = 0.65 // score > 0.65 → alta
	MediaThreshold = 0.35 // score > 0.35 → media, else baja
)

// Package base sizes for volume score calculation.
var PackageBaseSize = map[string]float64{
	"envelope": 1,
	"box":      5,
	"pallet":   15,
}

// Dataset generation constants.
const (
	DatasetSize    = 2000
	LabelNoiseRate = 0.10
	RandomState    = 42
	NumTrees       = 100
	NumClasses     = 3 // alta=0, media=1, baja=2
)

// Class label mappings.
var ClassToLabel = map[int]string{
	0: "alta",
	1: "media",
	2: "baja",
}

var LabelToClass = map[string]int{
	"alta":  0,
	"media": 1,
	"baja":  2,
}
