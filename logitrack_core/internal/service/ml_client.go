package service

import (
	"fmt"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
)

// MLService wraps the ML prediction functionality.
// It delegates to the internal/ml package which uses a RandomForest model.
type MLService = ml.MLService

// NewMLService creates a new ML service and loads the model from the given path.
// If the model file doesn't exist, the service operates without predictions (returns nil).
func NewMLService(modelPath string) *MLService {
	return ml.NewMLService(modelPath)
}

// setPriority copies the full prediction result onto a shipment.
func setPriority(shipment *model.Shipment, prediction *model.PriorityPrediction) {
	if prediction != nil {
		shipment.Priority = prediction.Priority
		shipment.PriorityScore = prediction.Score
		shipment.PriorityConfidence = prediction.Confidence
		shipment.PriorityFactors = prediction.Factors
		fmt.Printf("[ML] Shipment %s priority set to: %s (score=%.2f, confidence=%.2f)\n",
			shipment.TrackingID, prediction.Priority, prediction.Score, prediction.Confidence)
	}
}
