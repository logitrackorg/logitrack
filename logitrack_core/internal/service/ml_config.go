package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// terminalStatuses are shipment statuses that should NOT have their priority recalculated.
var terminalStatuses = map[model.Status]bool{
	model.StatusDelivered: true,
	model.StatusReturned:  true,
	model.StatusCancelled: true,
}

// MLConfigService manages ML configuration versions, model training, and priority recalculation.
type MLConfigService struct {
	repo         repository.MLConfigRepository
	mlService    *MLService
	shipmentRepo repository.ShipmentRepository
	db           *sql.DB
	mu           sync.Mutex // prevents concurrent regeneration
}

func NewMLConfigService(
	repo repository.MLConfigRepository,
	mlService *MLService,
	shipmentRepo repository.ShipmentRepository,
	db *sql.DB,
) *MLConfigService {
	return &MLConfigService{
		repo:         repo,
		mlService:    mlService,
		shipmentRepo: shipmentRepo,
		db:           db,
	}
}

// InitFromDB loads the active config and model from the database on startup.
// If no active config exists, the service continues using the file-based model and default factors.
func (s *MLConfigService) InitFromDB() {
	cfg, err := s.repo.GetActive()
	if err != nil {
		fmt.Printf("[MLConfig] WARNING: could not load active config from DB: %v\n", err)
	}

	if cfg != nil {
		ml.SetFactors(cfg.Factors)
		ml.SetThresholds(cfg.AltaThreshold, cfg.MediaThreshold)
		fmt.Printf("[MLConfig] Loaded active config #%d from DB.\n", cfg.ID)

		modelData, err := s.repo.GetActiveModel()
		if err != nil {
			fmt.Printf("[MLConfig] WARNING: could not load model from DB: %v\n", err)
		} else if modelData != nil {
			if err := s.mlService.LoadFromBytes(modelData); err != nil {
				fmt.Printf("[MLConfig] WARNING: could not load model bytes: %v\n", err)
			}
		} else {
			fmt.Printf("[MLConfig] No model blob in DB — keeping file-based model.\n")
		}
	}

	// If the model is still not ready (no model.json and no DB model), auto-train with defaults.
	if !s.mlService.IsReady() {
		fmt.Printf("[MLConfig] No model available — auto-training with default configuration...\n")
		_, _, err := s.Regenerate(ml.DefaultFactors(), ml.AltaThreshold, ml.MediaThreshold, "system", "Auto-generated on startup")
		if err != nil {
			fmt.Printf("[MLConfig] WARNING: auto-training failed: %v\n", err)
		}
	}
}

// GetActiveConfig returns the currently active config, or a default config if none exists.
func (s *MLConfigService) GetActiveConfig() (*model.MLConfig, error) {
	cfg, err := s.repo.GetActive()
	if err != nil {
		return nil, err
	}
	if cfg == nil {
		defaults := &model.MLConfig{
			Factors:        ml.DefaultFactors(),
			AltaThreshold:  ml.AltaThreshold,
			MediaThreshold: ml.MediaThreshold,
			IsActive:       true,
			CreatedBy:      "system",
			Notes:          "Default configuration",
		}
		return defaults, nil
	}
	return cfg, nil
}

// ListConfigs returns the full configuration history.
func (s *MLConfigService) ListConfigs() ([]model.MLConfig, error) {
	return s.repo.List()
}

// Regenerate saves a new config, trains a model with it, hot-swaps the model,
// and recalculates priorities for all active shipments.
// Returns the new config and the number of shipments recalculated.
func (s *MLConfigService) Regenerate(
	factors map[string]float64,
	altaThreshold, mediaThreshold float64,
	username, notes string,
) (*model.MLConfig, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Validate factors
	for _, name := range ml.FactorOrder {
		v, ok := factors[name]
		if !ok {
			return nil, 0, fmt.Errorf("factor faltante: %s", name)
		}
		if v < 1.0 || v > 5.0 {
			return nil, 0, fmt.Errorf("el factor %s debe estar entre 1.0 y 5.0 (valor recibido: %.2f)", name, v)
		}
	}
	if altaThreshold <= mediaThreshold {
		return nil, 0, fmt.Errorf("el umbral alta (%.2f) debe ser mayor que el umbral media (%.2f)", altaThreshold, mediaThreshold)
	}
	if altaThreshold < 0 || altaThreshold > 1 || mediaThreshold < 0 || mediaThreshold > 1 {
		return nil, 0, fmt.Errorf("los umbrales deben estar entre 0.0 y 1.0")
	}

	// Persist the new config
	cfg, err := s.repo.Create(model.MLConfig{
		Factors:        factors,
		AltaThreshold:  altaThreshold,
		MediaThreshold: mediaThreshold,
		CreatedBy:      username,
		Notes:          notes,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("save config: %w", err)
	}

	// Apply factors globally so GenerateDataset and ComputeScore use them
	ml.SetFactors(factors)
	ml.SetThresholds(altaThreshold, mediaThreshold)

	// Train model with new factors
	modelData, err := ml.TrainAndReturnBytes()
	if err != nil {
		return nil, 0, fmt.Errorf("train model: %w", err)
	}

	// Persist model blob
	if err := s.repo.SaveModel(cfg.ID, modelData); err != nil {
		return nil, 0, fmt.Errorf("save model: %w", err)
	}

	// Activate config
	if err := s.repo.Activate(cfg.ID); err != nil {
		return nil, 0, fmt.Errorf("activate config: %w", err)
	}
	cfg.IsActive = true

	// Hot-swap in-memory model
	if err := s.mlService.LoadFromBytes(modelData); err != nil {
		return nil, 0, fmt.Errorf("load model: %w", err)
	}

	// Recalculate active shipments
	count, err := s.recalculateActive()
	if err != nil {
		// Non-fatal: config and model are already updated
		fmt.Printf("[MLConfig] WARNING: recalculation partially failed: %v\n", err)
	}

	return &cfg, count, nil
}

// ActivateConfig rolls back to a previous config version.
func (s *MLConfigService) ActivateConfig(id int) (*model.MLConfig, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load the target config's model
	configs, err := s.repo.List()
	if err != nil {
		return nil, 0, err
	}
	var target *model.MLConfig
	for i := range configs {
		if configs[i].ID == id {
			target = &configs[i]
			break
		}
	}
	if target == nil {
		return nil, 0, fmt.Errorf("config %d not found", id)
	}

	// Activate it in DB
	if err := s.repo.Activate(id); err != nil {
		return nil, 0, fmt.Errorf("activate config: %w", err)
	}
	target.IsActive = true

	// Load its model blob
	var blob []byte
	err = s.db.QueryRow(`
		SELECT model_data FROM ml_models WHERE config_id = $1 ORDER BY created_at DESC LIMIT 1
	`, id).Scan(&blob)
	if err != nil {
		return nil, 0, fmt.Errorf("load model for config %d: %w", id, err)
	}

	// Apply factors and thresholds
	ml.SetFactors(target.Factors)
	ml.SetThresholds(target.AltaThreshold, target.MediaThreshold)

	// Hot-swap model
	if err := s.mlService.LoadFromBytes(blob); err != nil {
		return nil, 0, fmt.Errorf("load model: %w", err)
	}

	// Recalculate
	count, err := s.recalculateActive()
	if err != nil {
		fmt.Printf("[MLConfig] WARNING: recalculation partially failed: %v\n", err)
	}

	return target, count, nil
}

// recalculateActive updates priority for all non-terminal shipments using the current model.
func (s *MLConfigService) recalculateActive() (int, error) {
	shipments, err := s.shipmentRepo.List(model.ShipmentFilter{})
	if err != nil {
		return 0, fmt.Errorf("list shipments: %w", err)
	}

	count := 0
	for _, shipment := range shipments {
		if terminalStatuses[shipment.Status] {
			continue
		}
		prediction := s.mlService.PredictFromShipment(shipment)
		if prediction == nil {
			continue
		}

		factorsJSON, err := json.Marshal(prediction.Factors)
		if err != nil {
			continue
		}
		_, err = s.db.Exec(`
			UPDATE shipments
			SET priority = $1, priority_score = $2, priority_confidence = $3, priority_factors = $4
			WHERE tracking_id = $5
		`, prediction.Priority, prediction.Score, prediction.Confidence, factorsJSON, shipment.TrackingID)
		if err != nil {
			fmt.Printf("[MLConfig] WARNING: could not update priority for %s: %v\n", shipment.TrackingID, err)
			continue
		}
		count++
	}

	fmt.Printf("[MLConfig] Recalculated priority for %d active shipments.\n", count)
	return count, nil
}
