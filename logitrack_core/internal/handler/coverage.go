package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
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

// Diagnose evaluates a simulated new-branch coverage radius against every
// branch's real post-clip Voronoi area, for the coverage simulator panel's
// "Confirmar y Diagnosticar" action. Accepts a JSON body (DiagnoseRequest):
// area_km2 (required), excluded_branch_ids (optional array), and
// custom_bounding_area (optional polygon — clips Voronoi to the drawn region).
func (h *CoverageHandler) Diagnose(c *gin.Context) {
	var req model.DiagnoseRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.AreaKm2 <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "area_km2 es requerido y debe ser un número positivo"})
		return
	}
	if len(req.ExcludedBranchIDs) == 0 {
		c.JSON(http.StatusOK, h.svc.Diagnose(req.AreaKm2, req.CustomBoundingArea, req.IncludeInactive))
	} else {
		c.JSON(http.StatusOK, h.svc.DiagnoseExcluding(req.AreaKm2, req.ExcludedBranchIDs, req.CustomBoundingArea, req.IncludeInactive))
	}
}

// SnapToCity resolves a batch of geometric suggested-location points (from a
// previous Diagnose) to nearby real populated places via chunked OSM Overpass
// requests, for the coverage simulator's "Aterrizar sugerencias en ciudades
// reales" action. Results preserve request order so the frontend can merge by
// index. Points whose Overpass lookup fails (e.g. rate-limited) fall back to
// Snapped=false rather than failing the whole request.
func (h *CoverageHandler) SnapToCity(c *gin.Context) {
	var req model.SnapToCityRequest
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Points) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "points es requerido y no puede estar vacío"})
		return
	}

	results := h.svc.SnapToCities(req.Points, req.RadiusKm, req.MinPopulation, req.BlacklistedCities)

	c.JSON(http.StatusOK, model.SnapToCityResponse{Results: results})
}

// Project answers "what if the network also included these candidate
// new-branch locations?" for the coverage simulator's "Proyección de
// Impacto" section: rebuilds the Voronoi diagram over the active branches
// plus the given suggestions, and returns each existing branch's current vs.
// projected coverage percentage for the given simulated coverage area.
func (h *CoverageHandler) Project(c *gin.Context) {
	var req model.ProjectionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.AreaKm2 <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "area_km2 es requerido y debe ser un número positivo"})
		return
	}

	c.JSON(http.StatusOK, h.svc.ProjectScenario(req.AreaKm2, req.Suggestions))
}
