package model

type Stats struct {
	Total          int            `json:"total"`
	ByStatus       map[Status]int `json:"by_status"`
	ByBranch       map[string]int `json:"by_branch"`        // branch ID → shipment count (excludes delivered/returned)
	ByDay          map[string]int `json:"by_day"`           // YYYY-MM-DD → shipments created that day (within requested range)
	ByDayDelivered map[string]int `json:"by_day_delivered"` // YYYY-MM-DD → shipments delivered that day (within requested range)
}
