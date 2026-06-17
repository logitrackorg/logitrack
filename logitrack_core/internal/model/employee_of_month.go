package model

import "time"

// EmployeeOfMonthCategory identifies the three ranking categories.
type EmployeeOfMonthCategory string

const (
	CategoryLastMileDriver    EmployeeOfMonthCategory = "last_mile_driver"
	CategoryInterBranchDriver EmployeeOfMonthCategory = "inter_branch_driver"
	CategoryOperator          EmployeeOfMonthCategory = "operator"
)

// EmployeeOfMonthWinner records the result of a monthly category calculation.
// When HasWinner is false, UserID and Score are nil (no eligible candidates).
// BranchID is "" for the inter-branch driver category (network-wide ranking).
type EmployeeOfMonthWinner struct {
	ID            string                  `json:"id"`
	Period        time.Time               `json:"period"` // first day of month (UTC midnight)
	Category      EmployeeOfMonthCategory `json:"category"`
	BranchID      string                  `json:"branch_id"` // "" = network-wide
	HasWinner     bool                    `json:"has_winner"`
	UserID        string                  `json:"user_id,omitempty"`
	Score         *float64                `json:"score,omitempty"`
	ActivityCount int                     `json:"activity_count,omitempty"`
	ComputedAt    time.Time               `json:"computed_at"`
}

// Award is the lightweight view embedded in user profiles.
type Award struct {
	Category  EmployeeOfMonthCategory `json:"category"`
	Period    time.Time               `json:"period"`
	Score     float64                 `json:"score"`
	BranchID  string                  `json:"branch_id,omitempty"`
}

// Scoring constants — thresholds and weights are not admin-configurable in this delivery.
const (
	// Minimum activity thresholds for eligibility.
	EOMMinLastMileDeliveries   = 10
	EOMMinInterBranchTrips     = 2
	EOMMinOperatorShipments    = 10

	// Score weights (must sum to 1.0 per category).
	EOMLastMileWeightFirstAttempt = 0.40
	EOMLastMileWeightSLA          = 0.30
	EOMLastMileWeightComplaints   = 0.30

	EOMInterBranchWeightPunctuality    = 0.50
	EOMInterBranchWeightFatigue        = 0.30
	EOMInterBranchWeightNoReassignment = 0.20

	EOMOperatorWeightVolume     = 0.40
	EOMOperatorWeightSuccess    = 0.40
	EOMOperatorWeightComplaints = 0.20
)
