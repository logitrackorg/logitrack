package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

type AnalyticsHandler struct{}

func NewAnalyticsHandler() *AnalyticsHandler {
	return &AnalyticsHandler{}
}

func getPosthogAPIKey() string {
	return os.Getenv("POSTHOG_PERSONAL_API_KEY")
}

func getPosthogHost() string {
	host := os.Getenv("POSTHOG_HOST")
	if host == "" {
		return "https://app.posthog.com"
	}
	return host
}

func (h *AnalyticsHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/analytics/chatbot", h.GetChatbotStats)
}

type ChatbotStats struct {
	TotalOpened int            `json:"total_opened"`
	TotalAuth   int            `json:"total_auth"`
	TotalClaims int            `json:"total_claims"`
	Actions     map[string]int `json:"actions"`
	ClaimTypes  map[string]int `json:"claim_types"`
}

// fetchAllEvents pagina automáticamente hasta traer todos los eventos
func fetchAllEvents(event string, since string) ([]map[string]interface{}, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	apiKey := getPosthogAPIKey()
	host := getPosthogHost()

	var allResults []map[string]interface{}

	// Primera página
	url := fmt.Sprintf(
		"%s/api/projects/@current/events/?event=%s&after=%s&limit=100",
		host, event, since,
	)

	for url != "" {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("posthog returned %d: %s", resp.StatusCode, string(body))
		}

		var page struct {
			Next    *string                  `json:"next"`
			Results []map[string]interface{} `json:"results"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, err
		}

		allResults = append(allResults, page.Results...)

		// Seguir paginando si hay más
		if page.Next != nil && *page.Next != "" {
			url = *page.Next
		} else {
			url = ""
		}
	}

	return allResults, nil
}

func (h *AnalyticsHandler) GetChatbotStats(c *gin.Context) {
	if getPosthogAPIKey() == "" {
		c.JSON(http.StatusOK, ChatbotStats{
			Actions:    map[string]int{},
			ClaimTypes: map[string]int{},
		})
		return
	}

	since := time.Now().AddDate(0, 0, -30).Format("2006-01-02")

	stats := ChatbotStats{
		Actions:    make(map[string]int),
		ClaimTypes: make(map[string]int),
	}

	// ── Chatbot abierto ──────────────────────────────────────
	openedEvents, err := fetchAllEvents("chatbot_opened", since)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "no se pudo conectar con PostHog"})
		return
	}
	stats.TotalOpened = len(openedEvents)

	// ── Autenticaciones ──────────────────────────────────────
	authEvents, _ := fetchAllEvents("chatbot_authenticated", since)
	stats.TotalAuth = len(authEvents)

	// ── Opciones más usadas ──────────────────────────────────
	actionEvents, _ := fetchAllEvents("chatbot_option_selected", since)
	for _, ev := range actionEvents {
		props, ok := ev["properties"].(map[string]interface{})
		if !ok {
			continue
		}
		if action, ok := props["action"].(string); ok {
			stats.Actions[action]++
		}
	}

	// ── Tipos de reclamos ────────────────────────────────────
	claimTypeEvents, _ := fetchAllEvents("chatbot_claim_type_selected", since)
	for _, ev := range claimTypeEvents {
		props, ok := ev["properties"].(map[string]interface{})
		if !ok {
			continue
		}
		if ct, ok := props["claim_type"].(string); ok {
			stats.ClaimTypes[ct]++
		}
	}
	for _, count := range stats.ClaimTypes {
		stats.TotalClaims += count
	}

	c.JSON(http.StatusOK, stats)
}
