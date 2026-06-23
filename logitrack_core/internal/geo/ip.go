package geo

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

var ipGeoClient = &http.Client{Timeout: 3 * time.Second}

type IPLocation struct {
	Country string
	City    string
}

// LookupIP resolves the country and city for a given IP address.
// Uses ip-api.com (free, no key required, 45 req/min).
// Returns empty strings on any error or for private/loopback IPs.
func LookupIP(ip string) IPLocation {
	if ip == "" || ip == "127.0.0.1" || ip == "::1" {
		return IPLocation{Country: "Local", City: "Local"}
	}

	url := fmt.Sprintf("http://ip-api.com/json/%s?fields=country,city,status", ip)
	resp, err := ipGeoClient.Get(url)
	if err != nil {
		return IPLocation{}
	}
	defer resp.Body.Close()

	var result struct {
		Status  string `json:"status"`
		Country string `json:"country"`
		City    string `json:"city"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return IPLocation{}
	}
	if result.Status != "success" {
		return IPLocation{}
	}
	return IPLocation{
		Country: result.Country,
		City:    result.City,
	}
}
