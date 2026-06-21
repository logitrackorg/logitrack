package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/geo"
)

// IndustrialHeatmap returns the official IGN industrial zones ("áreas de
// fabricación y procesamiento", incl. parques industriales y polos
// petroquímicos) whose geometry intersects the given bounding box, as a JSON
// array of polygon rings — each ring is [][2]float64 with [lat, lng] pairs.
//
// The data is the embedded IGN dataset queried entirely in memory, so there is
// no upstream call, no timeout, no per-bbox size limit and no cache TTL: the
// previous Overpass dependency (and its 5° guard) is gone.
//
// bbox query param order: minLon,minLat,maxLon,maxLat (Leaflet getBounds order).
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

	rings := geo.IndustrialRingsInBBox(minLon, minLat, maxLon, maxLat)
	c.JSON(http.StatusOK, rings)
}
