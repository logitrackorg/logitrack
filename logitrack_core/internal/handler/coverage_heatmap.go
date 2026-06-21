package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	heatmapCacheTTL    = 15 * time.Minute
	heatmapMaxDeg      = 5.0
	heatmapOverpassURL = "https://overpass-api.de/api/interpreter"
)

// heatmapEntry caches the polygon rings returned for a given bbox.
// Each entry is one closed ring ([][2]float64) representing a single
// OSM way tagged landuse=industrial.
type heatmapEntry struct {
	polys    [][][2]float64
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

// IndustrialHeatmap returns OSM "landuse=industrial" polygon geometries inside
// the given bounding box (bbox query param: minLon,minLat,maxLon,maxLat) as a
// JSON array of polygon rings — each ring is [][2]float64 with [lat, lng] pairs.
// Only way elements are returned (nodes have no polygon geometry; relations are
// skipped for simplicity). Results are cached 15 minutes per bbox.
// Bboxes wider than 5° return an empty array without querying Overpass.
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
		c.JSON(http.StatusOK, [][][2]float64{})
		return
	}

	key := heatmapCacheKey(minLon, minLat, maxLon, maxLat)

	heatmapMu.Lock()
	if entry, ok := heatmapCache[key]; ok && time.Since(entry.cachedAt) < heatmapCacheTTL {
		polys := entry.polys
		heatmapMu.Unlock()
		c.JSON(http.StatusOK, polys)
		return
	}
	heatmapMu.Unlock()

	// Overpass bbox order: (south,west,north,east).
	// "out geom" includes the full node-coordinate list for each way so we can
	// draw the real polygon shape rather than just its centroid.
	query := fmt.Sprintf(
		`[out:json][timeout:12];way["landuse"="industrial"](%f,%f,%f,%f);out geom 200;`,
		minLat, minLon, maxLat, maxLon,
	)

	resp, err := heatmapClient.PostForm(heatmapOverpassURL, url.Values{"data": {query}})
	if err != nil || resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusOK, [][][2]float64{})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusOK, [][][2]float64{})
		return
	}

	var result struct {
		Elements []struct {
			Geometry []struct {
				Lat float64 `json:"lat"`
				Lon float64 `json:"lon"`
			} `json:"geometry"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		c.JSON(http.StatusOK, [][][2]float64{})
		return
	}

	polys := make([][][2]float64, 0, len(result.Elements))
	for _, el := range result.Elements {
		if len(el.Geometry) < 3 {
			continue
		}
		ring := make([][2]float64, len(el.Geometry))
		for i, g := range el.Geometry {
			ring[i] = [2]float64{g.Lat, g.Lon}
		}
		polys = append(polys, ring)
	}

	heatmapMu.Lock()
	heatmapCache[key] = heatmapEntry{polys: polys, cachedAt: time.Now()}
	heatmapMu.Unlock()

	c.JSON(http.StatusOK, polys)
}
