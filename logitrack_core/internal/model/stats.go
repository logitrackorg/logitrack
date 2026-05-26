package model

type Stats struct {
	Total              int                   `json:"total"`
	ByStatus           map[Status]int        `json:"by_status"`
	ByBranch           map[string]int        `json:"by_branch"`            // branch ID → shipment count (excludes delivered/returned)
	ByDay              map[string]int        `json:"by_day"`               // YYYY-MM-DD → shipments created that day (within requested range)
	ByDayDelivered     map[string]int        `json:"by_day_delivered"`     // YYYY-MM-DD → shipments delivered that day (within requested range)
	AvgCycleTimeHours  *float64              `json:"avg_cycle_time_hours"` // tiempo promedio desde creación hasta entrega (en horas), null si no hay entregados
	SuccessRate        *float64              `json:"success_rate"`         // porcentaje de entregas exitosas sobre el total (0–100), null si total=0
	OpenIncidents      int                   `json:"open_incidents"`       // cantidad de envíos con has_incident=true
	RecentShipments    []Shipment            `json:"recent_shipments"`     // últimos 5 envíos creados (no borradores)
}

// StatsDetailItem is a row in the KPI drill-down detail by branch.
type StatsDetailItem struct {
	BranchID   string `json:"branch_id"`
	BranchName string `json:"branch_name"`
	Count      int    `json:"count"`
}

// AvgTimePerStatusItem represents the average time a shipment spends in a given status.
type AvgTimePerStatusItem struct {
	Status       Status  `json:"status"`
	AvgHours     float64 `json:"avg_hours"`
	IsBottleneck bool    `json:"is_bottleneck"` // true for the status with the highest avg time
}

// AvgTimePerStatus is the response for the average-time-per-status endpoint.
type AvgTimePerStatus []AvgTimePerStatusItem

// CancellationStats represents cancellations grouped by day and reason.
type CancellationStats struct {
	ByDay            map[string]int `json:"by_day"`             // YYYY-MM-DD → cancellation count
	Total            int            `json:"total"`              // total cancellations in range
	TopReason        string         `json:"top_reason"`         // most frequent reason overall
	ReasonsBreakdown map[string]int `json:"reasons_breakdown"`  // reason → count
}

// PublicStats is a redacted, auth-free snapshot used by the login screen.
// Excludes drafts from totals so the number reflects real, confirmed activity.
type PublicStats struct {
	TotalShipments int `json:"total_shipments"` // confirmed shipments only (excludes drafts)
	InTransit      int `json:"in_transit"`      // loaded + in_transit + out_for_delivery
	ActiveBranches int `json:"active_branches"` // branches with status = activo
}

type DriverPerformanceItem struct {
	DriverID         string   `json:"driver_id"`
	DriverName       string   `json:"driver_name"`
	BranchID         string   `json:"branch_id"`
	BranchName       string   `json:"branch_name"`
	TotalAssigned    int      `json:"total_assigned"`
	Delivered        int      `json:"delivered"`
	DeliveryFailed   int      `json:"delivery_failed"`
	SuccessRate      *float64 `json:"success_rate"`
	AvgDeliveryHours *float64 `json:"avg_delivery_hours"`
}

type DriverPerformanceResponse struct {
	Drivers []DriverPerformanceItem `json:"drivers"`
}

type IncidentsByBranchItem struct {
	BranchID  string         `json:"branch_id"`
	BranchName string        `json:"branch_name"`
	Total     int            `json:"total"`
	ByType    map[string]int `json:"by_type"`
}

type IncidentsByBranchResponse struct {
	Branches         []IncidentsByBranchItem `json:"branches"`
	Total            int                     `json:"total"`
	GrandTotalByType map[string]int          `json:"grand_total_by_type"`
}

type BranchBilling struct {
	Revenue    float64 `json:"revenue"`
	Count      int     `json:"count"`
	AvgTicket  float64 `json:"avg_ticket"`
}

type BillingMetricsResponse struct {
	TotalRevenue float64                  `json:"total_revenue"`
	AvgTicket    *float64                 `json:"avg_ticket"`
	Currency     string                   `json:"currency"`
	Count        int                      `json:"count"`
	ByBranch     map[string]BranchBilling `json:"by_branch"`
	ByPeriod     map[string]float64       `json:"by_period"`
}

type BranchRankingItem struct {
	Rank           int     `json:"rank"`
	BranchID       string  `json:"branch_id"`
	BranchName     string  `json:"branch_name"`
	VolumeConfirmed int    `json:"volume_confirmed"`
	Delivered      int     `json:"delivered"`
	SuccessRate    *float64 `json:"success_rate"`
	CompositeScore float64 `json:"composite_score"`
}

type BranchRankingResponse struct {
	Ranking []BranchRankingItem `json:"ranking"`
	Period  struct {
		DateFrom *string `json:"date_from"`
		DateTo   *string `json:"date_to"`
	} `json:"period"`
}

type TimeWindowBucket struct {
	TimeWindow string `json:"time_window"`
	Count      int    `json:"count"`
}

type VolumeByTimeWindowResponse struct {
	Total   int                `json:"total"`
	Buckets []TimeWindowBucket `json:"buckets"`
}

type ShipmentTypeBucket struct {
	ShipmentType string `json:"shipment_type"`
	Count        int    `json:"count"`
}

type VolumeByShipmentTypeResponse struct {
	Total   int                  `json:"total"`
	Buckets []ShipmentTypeBucket `json:"buckets"`
}

type DeliveryMethodBucket struct {
	DeliveryMethod string `json:"delivery_method"`
	Count          int    `json:"count"`
}

type VolumeByDeliveryMethodResponse struct {
	Total   int                    `json:"total"`
	Buckets []DeliveryMethodBucket `json:"buckets"`
}

type ReturnBranchMetrics struct {
	Returned       int `json:"returned"`
	ReadyForReturn int `json:"ready_for_return"`
	Total          int `json:"total"`
}

type ReturnMetricsResponse struct {
	TotalReturned       int                       `json:"total_returned"`
	TotalReadyForReturn int                       `json:"total_ready_for_return"`
	TotalReturnEligible int                       `json:"total_return_eligible"`
	ReturnRate          *float64                  `json:"return_rate"`
	ByBranch            map[string]ReturnBranchMetrics `json:"by_branch"`
	ByDay               map[string]int            `json:"by_day"`
}

type SuccessRateByBranchItem struct {
	BranchID    string  `json:"branch_id"`
	BranchName  string  `json:"branch_name"`
	Total       int     `json:"total"`
	Delivered   int     `json:"delivered"`
	Failed      int     `json:"failed"`
	SuccessRate float64 `json:"success_rate"`
}

type SuccessRateByBranchResponse struct {
	Branches []SuccessRateByBranchItem `json:"branches"`
}
