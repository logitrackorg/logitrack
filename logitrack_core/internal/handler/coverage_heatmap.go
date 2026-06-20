package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	heatmapCacheTTL    = 15 * time.Minute
	heatmapMaxDeg      = 5.0
	heatmapOverpassURL = "https://overpass-api.de/api/interpreter"
)

type heatmapEntry struct {
	pts      [][2]float64
	cachedAt time.Time
}

var (
	heatmapMu     sync.Mutex
	heatmapCache  = make(map[string]heatmapEntry)
	heatmapClient = &http.Client{Timeout: 12 * time.Second}
)

func heatmapCacheKey(minLon, minLat, maxLon, maxLat float64) string {
	r := func(v float64) float64 { return math.Round(v*10) / 10 }
	return fmt.Sprintf("%.1f,%.1f,%.1f,%.1f", r(minLon), r(minLat), r(maxLon), r(maxLat))
}

// IndustrialHeatmap returns OSM "landuse=industrial" centroids inside the given
// bounding box (bbox query param: minLon,minLat,maxLon,maxLat) as an array of
// [lat, lng] pairs for leaflet.heat. Results are cached 15 minutes per bbox.
// Very large bboxes (> 5° wide) return an empty array without hitting Overpass.
func (h *CoverageHandler) IndustrialHeatmap(c *gin.Context) {
	bboxStr := c.Query("bbox")
	if bboxStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bbox es requerido (minLon,minLat,maxLon,maxLat)"})
		return
	}

	parts := strings.SplitN(bboxStr, ",", 5)
	if len(parts) != 4 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bbox debe contener exactamente 4 valores separados por coma"})
		return
	}

	var coords [4]float64
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("coordenada %d inválida", i+1)})
			return
		}
		coords[i] = v
	}
	minLon, minLat, maxLon, maxLat := coords[0], coords[1], coords[2], coords[3]

	if maxLon-minLon > heatmapMaxDeg || maxLat-minLat > heatmapMaxDeg {
		c.JSON(http.StatusOK, [][2]float64{})
		return
	}

	key := heatmapCacheKey(minLon, minLat, maxLon, maxLat)

	heatmapMu.Lock()
	if entry, ok := heatmapCache[key]; ok && time.Since(entry.cachedAt) < heatmapCacheTTL {
		pts := entry.pts
		heatmapMu.Unlock()
		c.JSON(http.StatusOK, pts)
		return
	}
	heatmapMu.Unlock()

	// Overpass bbox order: (south,west,north,east).
	query := fmt.Sprintf(
		`[out:json][timeout:10];(node["landuse"="industrial"](%f,%f,%f,%f);way["landuse"="industrial"](%f,%f,%f,%f););out center 300;`,
		minLat, minLon, maxLat, maxLon,
		minLat, minLon, maxLat, maxLon,
	)

	resp, err := heatmapClient.PostForm(heatmapOverpassURL, url.Values{"data": {query}})
	if err != nil || resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusOK, [][2]float64{})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusOK, [][2]float64{})
		return
	}

	var result struct {
		Elements []struct {
			Lat    float64 `json:"lat"`
			Lon    float64 `json:"lon"`
			Center struct {
				Lat float64 `json:"lat"`
				Lon float64 `json:"lon"`
			} `json:"center"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		c.JSON(http.StatusOK, [][2]float64{})
		return
	}

	pts := make([][2]float64, 0, len(result.Elements))
	for _, el := range result.Elements {
		lat, lon := el.Lat, el.Lon
		if el.Center.Lat != 0 || el.Center.Lon != 0 {
			lat, lon = el.Center.Lat, el.Center.Lon
		}
		if lat == 0 && lon == 0 {
			continue
		}
		pts = append(pts, [2]float64{lat, lon})
	}

	heatmapMu.Lock()
	heatmapCache[key] = heatmapEntry{pts: pts, cachedAt: time.Now()}
	heatmapMu.Unlock()

	c.JSON(http.StatusOK, pts)
}
