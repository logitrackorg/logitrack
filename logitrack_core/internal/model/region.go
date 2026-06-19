package model

// RegionType distinguishes system-provided zones from user-drawn ones.
type RegionType string

const (
	RegionTypePredefined RegionType = "predefined"
	RegionTypeCustom     RegionType = "custom"
)

// Region is a named geographic polygon used to restrict the coverage simulator
// to a specific area (e.g. CABA, AMBA, or a user-drawn zone).
type Region struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Type        RegionType `json:"type"`
	Coordinates []LatLng   `json:"coordinates"`
}

// CreateRegionRequest is the body of POST /regions.
type CreateRegionRequest struct {
	Name        string   `json:"name"`
	Coordinates []LatLng `json:"coordinates"`
}
