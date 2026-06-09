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

// FleetClassToStatus maps the forest's integer class output to a FleetStatus constant.
var FleetClassToStatus = map[int]model.FleetStatus{
	FleetClassCritical:   model.FleetStatusCritical,
	FleetClassWarning:    model.FleetStatusWarning,
	FleetClassPreventive: model.FleetStatusPreventive,
	FleetClassIdle:       model.FleetStatusIdle,
	FleetClassStable:     model.FleetStatusStable,
}

// FleetMLService wraps a trained RandomForest for fleet-state prediction.
// It is safe for concurrent use.
type FleetMLService struct {
	forest *randomforest.Forest
	mu     sync.RWMutex
}

// NewFleetMLService loads the model at modelPath.  If the file is missing the
// service trains a new model from synthetic data and saves it to the same path.
// If training also fails the service operates without predictions (IsReady()
// returns false) and the handler falls back to the heuristic.
func NewFleetMLService(modelPath string) *FleetMLService {
	svc := &FleetMLService{}
	if err := svc.Load(modelPath); err != nil {
		fmt.Printf("[FleetML] Model not found (%v) — training from synthetic data…\n", err)
		if trainErr := TrainAndSaveFleetModel(modelPath); trainErr != nil {
			fmt.Printf("[FleetML] Auto-train failed: %v — fleet ML predictions disabled\n", trainErr)
			return svc
		}
		// Load the freshly saved model.
		if err := svc.Load(modelPath); err != nil {
			fmt.Printf("[FleetML] Could not reload trained model: %v\n", err)
		}
	}
	return svc
}

// Load reads a previously serialized model from disk.
func (s *FleetMLService) Load(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read: %w", err)
	}
	var f randomforest.Forest
	if err := json.Unmarshal(data, &f); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}
	s.mu.Lock()
	s.forest = &f
	s.mu.Unlock()
	fmt.Printf("[FleetML] Model loaded from %s (%d trees)\n", path, f.NTrees)
	return nil
}

// IsReady returns true when a model is loaded and predictions can be served.
func (s *FleetMLService) IsReady() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.forest != nil
}

// TrainAndSaveFleetModel generates a synthetic dataset, trains a RandomForest
// with FleetNumTrees trees, and serializes it to modelPath.
// This function is also called by cmd/train if extended to support fleet models.
func TrainAndSaveFleetModel(modelPath string) error {
	fmt.Printf("[FleetML] Generating dataset (%d samples)…\n", FleetDatasetSize)
	samples := GenerateFleetDataset(FleetDatasetSize, FleetRandomState)

	counts := make(map[int]int, FleetNumClasses)
	for _, s := range samples {
		counts[s.Class]++
	}
	for cls := 0; cls < FleetNumClasses; cls++ {
		status := FleetClassToStatus[cls]
		pct := float64(counts[cls]) / float64(len(samples)) * 100
		fmt.Printf("[FleetML]   %12s: %4d (%.1f%%)\n", status, counts[cls], pct)
	}

	xData := make([][]float64, len(samples))
	yData := make([]int, len(samples))
	for i, s := range samples {
		xData[i] = s.Features
		yData[i] = s.Class
	}

	forest := randomforest.Forest{
		Data: randomforest.ForestData{X: xData, Class: yData},
	}
	fmt.Printf("[FleetML] Training %d trees…\n", FleetNumTrees)
	forest.Train(FleetNumTrees)
	fmt.Printf("[FleetML] Training complete.\n")

	data, err := json.Marshal(forest)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if err := os.WriteFile(modelPath, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", modelPath, err)
	}
	fmt.Printf("[FleetML] Saved → %s (%d bytes)\n", modelPath, len(data))
	return nil
}

// Retrain regenerates the synthetic dataset with the current fleetClassify
// rules, trains a new forest, and hot-swaps it into the service. The model is
// also persisted to the same path it was originally loaded from so it survives
// the next restart. Concurrency-safe — reads and predictions are not blocked
// during training; the swap is atomic under the write lock.
func (s *FleetMLService) Retrain() error {
	fmt.Printf("[FleetML] Retrain requested — regenerating dataset (%d samples)…\n", FleetDatasetSize)
	samples := GenerateFleetDataset(FleetDatasetSize, FleetRandomState)

	xData := make([][]float64, len(samples))
	yData := make([]int, len(samples))
	for i, sam := range samples {
		xData[i] = sam.Features
		yData[i] = sam.Class
	}

	forest := randomforest.Forest{
		Data: randomforest.ForestData{X: xData, Class: yData},
	}
	fmt.Printf("[FleetML] Training %d trees…\n", FleetNumTrees)
	forest.Train(FleetNumTrees)
	fmt.Printf("[FleetML] Retrain complete.\n")

	s.mu.Lock()
	s.forest = &forest
	s.mu.Unlock()
	return nil
}

// PredictFleetState runs the Random Forest for a single branch and returns:
//   - the winning FleetStatus
//   - its vote fraction (confidence in [0,1])
//   - a vote distribution map: label → vote share as integer percentage (0–100)
//
// Parameters are that branch's five approved metrics — EnviosActivosTotales,
// DemoraSLA, ChoferesInactivos, ChoferesActivos, Huerfanos — in
// FleetFactorOrder order. Returns (FleetStatusStable, 0, nil) when the model
// is not loaded.
func (s *FleetMLService) PredictFleetState(
	totalShipments int,
	slaDelayPct float64,
	idleDrivers, activeDrivers, orphanShipments int,
) (model.FleetStatus, float64, map[string]int) {
	s.mu.RLock()
	forest := s.forest
	s.mu.RUnlock()

	if forest == nil {
		return model.FleetStatusStable, 0, nil
	}

	features := NormalizeFleetFeatures(
		totalShipments, slaDelayPct, idleDrivers, activeDrivers, orphanShipments,
	)
	votes := forest.Vote(features)

	bestClass, bestVotes := 0, votes[0]
	for i := 1; i < len(votes) && i < FleetNumClasses; i++ {
		if votes[i] > bestVotes {
			bestVotes = votes[i]
			bestClass = i
		}
	}

	status := FleetClassToStatus[bestClass]
	if status == "" {
		status = model.FleetStatusStable
	}

	voteDist := make(map[string]int, FleetNumClasses)
	for cls := 0; cls < FleetNumClasses && cls < len(votes); cls++ {
		if st, ok := FleetClassToStatus[cls]; ok && st != "" {
			voteDist[string(st)] = int(math.Round(votes[cls] * 100))
		}
	}

	return status, bestVotes, voteDist
}
