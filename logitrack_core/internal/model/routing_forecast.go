package model

import "time"

// =============================================================================
// Phase 4 Sprint 9 — Demand forecasting
// =============================================================================

// ODForecast es la predicción de volumen para un par origen-destino en una fecha.
// Computado por ForecastService usando promedio por día de semana sobre los últimos
// 90 días de od_pair_daily_volume.
type ODForecast struct {
	OriginBranchID      string  `json:"origin_branch_id"`
	DestinationBranchID string  `json:"destination_branch_id"`
	Date                string  `json:"date"` // YYYY-MM-DD
	PredictedCount      float64 `json:"predicted_count"`
	PredictedWeightKg   float64 `json:"predicted_weight_kg"`
	// CILow y CIHigh son la banda de confianza (one stdev del histórico).
	// Si no hay suficientes datos para calcular stdev, ambos = PredictedCount.
	CILow  float64 `json:"ci_low"`
	CIHigh float64 `json:"ci_high"`
	// Confidence indica qué tan confiable es la predicción:
	//   - "high":   ≥ 12 observaciones para ese día de semana
	//   - "medium": 4 a 11 observaciones
	//   - "low":    1 a 3 observaciones
	//   - "none":   sin datos históricos
	Confidence string `json:"confidence"`
}

// ForecastQuality es el resultado del backtest del modelo.
// MAPE (Mean Absolute Percentage Error) es la métrica primaria.
type ForecastQuality struct {
	MAPE           float64 `json:"mape"`        // promedio del error porcentual
	SampleSize     int     `json:"sample_size"` // # de observaciones evaluadas
	ODPairsCovered int     `json:"od_pairs_covered"`
	EvaluatedFrom  string  `json:"evaluated_from"` // YYYY-MM-DD
	EvaluatedTo    string  `json:"evaluated_to"`
}

// =============================================================================
// Phase 4 Sprint 11 — Rolling horizon multi-día
// =============================================================================

// RollingHorizonPlan es la vista multi-día del plan de ruteo.
//   - Día 1 (firm): plan global real, ya generado
//   - Días 2..N (tentative): proyección basada en forecast + envíos pendientes
//
// El operador puede regenerar para refrescar.
type RollingHorizonPlan struct {
	GeneratedAt time.Time           `json:"generated_at"`
	HorizonDays int                 `json:"horizon_days"`
	Days        []RollingHorizonDay `json:"days"`
}

// RollingHorizonDay resume el plan para un día específico.
//   - Day 1 (IsFirm=true): mirror del plan global real
//   - Days 2..N (IsFirm=false): proyección del forecasting
type RollingHorizonDay struct {
	Date             string                   `json:"date"`    // YYYY-MM-DD
	IsFirm           bool                     `json:"is_firm"` // día 1 vs tentativo
	Summary          RollingHorizonDaySummary `json:"summary"`
	ExpectedByODPair []RollingHorizonODBucket `json:"expected_by_od_pair"`
}

// RollingHorizonDaySummary son contadores agregados del día.
type RollingHorizonDaySummary struct {
	TotalExpectedShipments int     `json:"total_expected_shipments"`
	TotalExpectedWeightKg  float64 `json:"total_expected_weight_kg"`
	// EstimatedVehiclesNeeded es una estimación gruesa: peso_total / capacidad_media.
	EstimatedVehiclesNeeded int `json:"estimated_vehicles_needed"`
}

// RollingHorizonODBucket es el volumen esperado para un par O-D ese día.
type RollingHorizonODBucket struct {
	OriginBranchID      string  `json:"origin_branch_id"`
	DestinationBranchID string  `json:"destination_branch_id"`
	ExpectedShipments   float64 `json:"expected_shipments"`
	ExpectedWeightKg    float64 `json:"expected_weight_kg"`
	Confidence          string  `json:"confidence"`
}
