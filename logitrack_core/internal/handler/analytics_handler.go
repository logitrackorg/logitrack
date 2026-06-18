package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	posthogAPIKey  = "phx_QesTGvgaRtijuGXHG4V3vRtmLXZptMi54SdS5ivbVcERVZqM"
	posthogHost    = "https://us.posthog.com"
)

type AnalyticsHandler struct{}

func NewAnalyticsHandler() *AnalyticsHandler {
	return &AnalyticsHandler{}
}

func (h *AnalyticsHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/analytics/chatbot", h.GetChatbotStats)
}

type ChatbotStats struct {
	TotalOpened  int            `json:"total_opened"`
	TotalAuth    int            `json:"total_auth"`
	TotalClaims  int            `json:"total_claims"`
	Actions      map[string]int `json:"actions"`
	ClaimTypes   map[string]int `json:"claim_types"`
}

func posthogEventCount(event string, since string) (int, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	url := fmt.Sprintf(
		"%s/api/projects/@current/events/?event=%s&after=%s&limit=1",
		posthogHost, event, since,
	)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+posthogAPIKey)

	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var result struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, err
	}
	return result.Count, nil
}

func posthogEventList(event string, since string, limit int) ([]map[string]interface{}, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	url := fmt.Sprintf(
		"%s/api/projects/@current/events/?event=%s&after=%s&limit=%d",
		posthogHost, event, since, limit,
	)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+posthogAPIKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result struct {
		Results []map[string]interface{} `json:"results"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	return result.Results, nil
}

func (h *AnalyticsHandler) GetChatbotStats(c *gin.Context) {
	since := time.Now().AddDate(0, 0, -30).Format("2006-01-02")

	stats := ChatbotStats{
		Actions:    make(map[string]int),
		ClaimTypes: make(map[string]int),
	}

	// Total opened
	opened, err := posthogEventCount("chatbot_opened", since)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "no se pudo conectar con PostHog"})
		return
	}
	stats.TotalOpened = opened

	// Total auth
	auth, _ := posthogEventCount("chatbot_authenticated", since)
	stats.TotalAuth = auth

	// Total claims submitted
	claims, _ := posthogEventCount("chatbot_claim_submitted", since)
	stats.TotalClaims = claims

	// Actions breakdown
	actionEvents, _ := posthogEventList("chatbot_option_selected", since, 1000)
	for _, ev := range actionEvents {
		props, ok := ev["properties"].(map[string]interface{})
		if !ok {
			continue
		}
		if action, ok := props["action"].(string); ok {
			stats.Actions[action]++
		}
	}

	// Claim types breakdown
	claimEvents, _ := posthogEventList("chatbot_claim_type_selected", since, 1000)
	for _, ev := range claimEvents {
		props, ok := ev["properties"].(map[string]interface{})
		if !ok {
			continue
		}
		if ct, ok := props["claim_type"].(string); ok {
			stats.ClaimTypes[ct]++
		}
	}

	c.JSON(http.StatusOK, stats)
}