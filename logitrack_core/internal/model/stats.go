package model

type Stats struct {
	Total          int            `json:"total"`
	ByStatus       map[Status]int `json:"by_status"`
	ByBranch       map[string]int `json:"by_branch"`        // branch ID → shipment count (excludes delivered/returned)
	ByDay          map[string]int `json:"by_day"`           // YYYY-MM-DD → shipments created that day (within requested range)
	ByDayDelivered map[string]int `json:"by_day_delivered"` // YYYY-MM-DD → shipments delivered that day (within requested range)
}

// PublicStats is a redacted, auth-free snapshot used by the login screen.
// Excludes drafts from totals so the number reflects real, confirmed activity.
type PublicStats struct {
	TotalShipments int `json:"total_shipments"` // confirmed shipments only (excludes drafts)
	InTransit      int `json:"in_transit"`      // loaded + in_transit + out_for_delivery
	ActiveBranches int `json:"active_branches"` // branches with status = activo
}
