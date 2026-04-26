package geo

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

var nominatimClient = &http.Client{Timeout: 4 * time.Second}

type nominatimResult struct {
	Lat     string `json:"lat"`
	Lon     string `json:"lon"`
	Class   string `json:"class"`
	Type    string `json:"type"`
	PlaceID int    `json:"place_id"`
}

// GeocodeAddress queries Nominatim with a full Argentine address and returns
// (lat, lng, true) on success. Returns (0, 0, false) on any error or no results.
func GeocodeAddress(street, city, province string) (float64, float64, bool) {
	q := buildQuery(street, city, province)
	apiURL := "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=" + url.QueryEscape(q)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return 0, 0, false
	}
	req.Header.Set("User-Agent", "LogiTrack/1.0")

	resp, err := nominatimClient.Do(req)
	if err != nil {
		return 0, 0, false
	}
	defer resp.Body.Close()

	var results []nominatimResult
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil || len(results) == 0 {
		return 0, 0, false
	}

	lat, err := strconv.ParseFloat(results[0].Lat, 64)
	if err != nil {
		return 0, 0, false
	}
	lng, err := strconv.ParseFloat(results[0].Lon, 64)
	if err != nil {
		return 0, 0, false
	}
	return lat, lng, true
}

func buildQuery(street, city, province string) string {
	if street != "" {
		return fmt.Sprintf("%s, %s, %s, Argentina", street, city, province)
	}
	return fmt.Sprintf("%s, %s, Argentina", city, province)
}
