package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/service"
)

// CoverageHandler exposes the branch-coverage detector: the Voronoi diagram with
// per-branch service areas and gap classification, plus the optimal-branch
// lookup used by the new-shipment flow.
type CoverageHandler struct {
	svc *service.CoverageService
}

func NewCoverageHandler(svc *service.CoverageService) *CoverageHandler {
	return &CoverageHandler{svc: svc}
}

// GetDiagram recomputes and returns the current coverage diagram. The geometry
// is cheap (a handful of branches) so it is recomputed on each request to always
// reflect the active branch set and the configured threshold.
//
// The response is the rich diagram (cells with lat/lng polygons, areas, gap
// severity and suggested locations) rather than bare GeoJSON: the frontend draws
// the polygons with Leaflet's L.polygon (lat/lng order) and needs the per-cell
// metadata alongside the geometry. A strict GeoJSON FeatureCollection is
// trivially derivable from this payload if an external consumer needs it.
func (h *CoverageHandler) GetDiagram(c *gin.Context) {
	c.JSON(http.StatusOK, h.svc.Refresh())
}

// BranchForPoint returns the branch whose coverage cell contains the given
// coordinate (the nearest active branch), along with whether that cell is an
// under-covered zone. Used by the new-shipment form to suggest the optimal
// branch and warn about coverage gaps.
func (h *CoverageHandler) BranchForPoint(c *gin.Context) {
	lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
	lng, errLng := strconv.ParseFloat(c.Query("lng"), 64)
	if errLat != nil || errLng != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lat y lng son requeridos y deben ser numéricos"})
		return
	}
	cell, ok := h.svc.CoverageForPoint(lat, lng)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"branch_id": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"branch_id":    cell.BranchID,
		"branch_name":  cell.BranchName,
		"area_km2":     cell.AreaKm2,
		"is_gap":       cell.IsGap,
		"gap_severity": cell.GapSeverity,
	})
}
