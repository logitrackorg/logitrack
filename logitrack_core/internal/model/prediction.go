package model

// PriorityPrediction is the result from the ML priority prediction.
type PriorityPrediction struct {
	Priority   string                  `json:"priority"`   // alta / media / baja
	Confidence float64                 `json:"confidence"` // 0.0-1.0
	Score      float64                 `json:"score"`      // 0.0-1.0 weighted score
	Factors    map[string]FactorDetail `json:"factors"`
}

// FactorDetail shows how each factor contributed to the priority score.
type FactorDetail struct {
	Value        interface{} `json:"value"`
	Normalized   float64     `json:"normalized"`
	Weight       float64     `json:"weight"`
	Contribution float64     `json:"contribution"`
}
