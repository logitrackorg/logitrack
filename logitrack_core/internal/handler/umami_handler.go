package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

type UmamiHandler struct {
	host      string
	apiKey    string
	websiteID string
}

func NewUmamiHandler() *UmamiHandler {
	return &UmamiHandler{
		host:      os.Getenv("UMAMI_HOST"),
		apiKey:    os.Getenv("UMAMI_API_KEY"),
		websiteID: os.Getenv("UMAMI_WEBSITE_ID"),
	}
}

/*func (h *UmamiHandler) RegisterRoutes(r *gin.RouterGroup) {
	umami := r.Group("/umami")
	{
		umami.GET("/stats", h.GetStats)
		umami.GET("/pageviews", h.GetPageviews)
	}
}*/

func (h *UmamiHandler) doRequest(endpoint string) ([]byte, int, error) {
	requestURL := fmt.Sprintf("%s%s", h.host, endpoint)

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, 0, err
	}

	req.Header.Set("x-umami-api-key", h.apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}

	return body, resp.StatusCode, nil
}

// GetStats devuelve los totales (pageviews, visits, visitors, bounces, totaltime)
// de los últimos 30 días, con comparación contra el período anterior.
func (h *UmamiHandler) GetStats(c *gin.Context) {
	now := time.Now()
	startAt := now.AddDate(0, 0, -30).UnixMilli()
	endAt := now.UnixMilli()

	endpoint := fmt.Sprintf(
		"/v1/websites/%s/stats?startAt=%d&endAt=%d",
		h.websiteID, startAt, endAt,
	)

	body, status, err := h.doRequest(endpoint)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if status != http.StatusOK {
		c.JSON(status, gin.H{"error": "umami respondió con error", "details": string(body)})
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error parsing response"})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetPageviews devuelve la serie de tiempo de visitas por día para graficar
// la tendencia. Acepta ?days=N opcional (default 30).
func (h *UmamiHandler) GetPageviews(c *gin.Context) {
	days := 30
	if d := c.Query("days"); d != "" {
		if parsed, err := time.ParseDuration(d + "h"); err == nil {
			days = int(parsed.Hours() / 24)
		}
	}

	now := time.Now()
	startAt := now.AddDate(0, 0, -days).UnixMilli()
	endAt := now.UnixMilli()

	tz := url.QueryEscape("America/Argentina/Buenos_Aires")

	endpoint := fmt.Sprintf(
		"/v1/websites/%s/pageviews?startAt=%d&endAt=%d&unit=day&timezone=%s",
		h.websiteID, startAt, endAt, tz,
	)

	body, status, err := h.doRequest(endpoint)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if status != http.StatusOK {
		c.JSON(status, gin.H{"error": "umami respondió con error", "details": string(body)})
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "error parsing response"})
		return
	}

	c.JSON(http.StatusOK, result)
}
