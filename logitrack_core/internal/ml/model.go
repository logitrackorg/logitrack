package ml

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sync"

	randomforest "github.com/malaschitz/randomForest"

	"github.com/logitrack/core/internal/model"
)

// MLService provides shipment priority prediction using a RandomForest model.
type MLService struct {
	forest *randomforest.Forest
	mu     sync.RWMutex
}

// NewMLService creates a new MLService and loads the model from the given path.
// If the model file doesn't exist, the service operates without predictions (returns nil).
func NewMLService(modelPath string) *MLService {
	svc := &MLService{}
	if err := svc.Load(modelPath); err != nil {
		fmt.Printf("[ML] WARNING: could not load model from %s: %v\n", modelPath, err)
		fmt.Printf("[ML] Run 'go run cmd/train/main.go' to generate the model.\n")
	}
	return svc
}

// Load loads a trained model from disk.
func (s *MLService) Load(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read model file: %w", err)
	}
	var forest randomforest.Forest
	if err := json.Unmarshal(data, &forest); err != nil {
		return fmt.Errorf("unmarshal model: %w", err)
	}
	s.mu.Lock()
	s.forest = &forest
	s.mu.Unlock()
	fmt.Printf("[ML] Model loaded from %s (%d trees)\n", path, forest.NTrees)
	return nil
}

// IsReady returns true if a model is loaded.
func (s *MLService) IsReady() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.forest != nil
}

// Train trains a new RandomForest model and saves it to the given path.
func TrainAndSave(modelPath string) error {
	fmt.Printf("[ML] Generating dataset (%d samples)...\n", DatasetSize)
	samples := GenerateDataset(DatasetSize, RandomState)

	// Print distribution
	classCounts := make(map[int]int)
	for _, s := range samples {
		classCounts[s.Class]++
	}
	fmt.Printf("[ML] Dataset distribution:\n")
	for class := 0; class < NumClasses; class++ {
		count := classCounts[class]
		pct := float64(count) / float64(len(samples)) * 100
		fmt.Printf("  %5s: %5d (%.1f%%)\n", ClassToLabel[class], count, pct)
	}

	// Build ForestData
	xData := make([][]float64, len(samples))
	yData := make([]int, len(samples))
	for i, s := range samples {
		xData[i] = s.Features
		yData[i] = s.Class
	}

	forest := randomforest.Forest{
		Data: randomforest.ForestData{
			X:     xData,
			Class: yData,
		},
	}

	fmt.Printf("[ML] Training RandomForest (%d trees)...\n", NumTrees)
	forest.Train(NumTrees)
	fmt.Printf("[ML] Training complete.\n")

	// Save model
	return SaveModel(&forest, modelPath)
}

// SaveModel saves a trained model to disk as JSON.
func SaveModel(forest *randomforest.Forest, path string) error {
	data, err := json.Marshal(forest)
	if err != nil {
		return fmt.Errorf("marshal model: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write model file: %w", err)
	}
	fmt.Printf("[ML] Model saved to %s (%d bytes)\n", path, len(data))
	return nil
}

// PredictFromShipment predicts priority for an existing shipment.
func (s *MLService) PredictFromShipment(shipment model.Shipment) *model.PriorityPrediction {
	origin := shipment.Sender.Address.Province
	dest := shipment.Recipient.Address.Province
	return s.predict(
		origin, dest,
		string(shipment.ShipmentType),
		string(shipment.TimeWindow),
		string(shipment.PackageType),
		shipment.WeightKg,
		shipment.IsFragile,
		shipment.ColdChain,
	)
}

// PredictFromCreateRequest predicts priority from a create shipment request.
func (s *MLService) PredictFromCreateRequest(req model.CreateShipmentRequest) *model.PriorityPrediction {
	shipmentType := string(req.ShipmentType)
	if shipmentType == "" {
		shipmentType = "normal"
	}
	timeWindow := string(req.TimeWindow)
	if timeWindow == "" {
		timeWindow = "flexible"
	}
	return s.predict(
		req.Sender.Address.Province,
		req.Recipient.Address.Province,
		shipmentType,
		timeWindow,
		string(req.PackageType),
		req.WeightKg,
		req.IsFragile,
		req.ColdChain,
	)
}

func (s *MLService) predict(
	originProvince, destProvince, shipmentType, timeWindow, packageType string,
	weightKg float64,
	isFragile, coldChain bool,
) *model.PriorityPrediction {
	s.mu.RLock()
	forest := s.forest
	s.mu.RUnlock()

	if forest == nil {
		return nil
	}

	// Compute derived values
	distance := ComputeDistance(originProvince, destProvince)
	restrictionCount := 0.0
	if isFragile {
		restrictionCount++
	}
	if coldChain {
		restrictionCount++
	}
	volume := ComputeVolumeScore(packageType, weightKg)

	// Simulated route saturation (deterministic based on route hash)
	h := fnv32(originProvince + "-" + destProvince)
	routeSaturation := float64(h%100) / 100.0

	// Normalize factors
	normalized := map[string]float64{
		"shipment_type":    NormalizeFactor("shipment_type", 0, shipmentType),
		"distance_km":      NormalizeFactor("distance_km", distance, ""),
		"restrictions":     NormalizeFactor("restrictions", restrictionCount, ""),
		"time_window":      NormalizeFactor("time_window", 0, timeWindow),
		"volume_score":     NormalizeFactor("volume_score", volume, ""),
		"route_saturation": NormalizeFactor("route_saturation", routeSaturation, ""),
	}

	rawValues := map[string]interface{}{
		"shipment_type":    shipmentType,
		"distance_km":      math.Round(distance*10) / 10,
		"restrictions":     int(restrictionCount),
		"time_window":      timeWindow,
		"volume_score":     math.Round(volume*100) / 100,
		"route_saturation": routeSaturation,
	}

	// Build feature vector
	features := make([]float64, len(FactorOrder))
	for i, name := range FactorOrder {
		features[i] = normalized[name]
	}

	// Vote
	votes := forest.Vote(features)

	// Find class with max votes
	bestClass := 0
	bestVotes := votes[0]
	for i := 1; i < len(votes) && i < NumClasses; i++ {
		if votes[i] > bestVotes {
			bestVotes = votes[i]
			bestClass = i
		}
	}

	priority := ClassToLabel[bestClass]
	confidence := bestVotes

	// Compute score (weighted sum) — deterministic, same as dataset generation
	score := ComputeScore(normalized)

	// Compute per-factor contributions
	totalWeight := 0.0
	for _, w := range PriorityFactors {
		totalWeight += w
	}

	factors := make(map[string]model.FactorDetail)
	for _, name := range FactorOrder {
		norm := normalized[name]
		w := PriorityFactors[name]
		contribution := (norm * w) / totalWeight
		factors[name] = model.FactorDetail{
			Value:        rawValues[name],
			Normalized:   math.Round(norm*10000) / 10000,
			Weight:       w,
			Contribution: math.Round(contribution*10000) / 10000,
		}
	}

	return &model.PriorityPrediction{
		Priority:   priority,
		Confidence: math.Round(confidence*10000) / 10000,
		Score:      math.Round(score*10000) / 10000,
		Factors:    factors,
	}
}

// fnv32 computes a simple hash for route saturation (matches Python's hash behavior).
func fnv32(s string) uint32 {
	h := uint32(2166136261)
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	if h&0x80000000 != 0 {
		return ^(h - 1)
	}
	return h
}
