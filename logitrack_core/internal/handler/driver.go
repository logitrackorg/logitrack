package handler

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

// checkinStore holds one KSS check-in per (driverID, date) in memory.
var (
	checkinMu    sync.Mutex
	checkinStore = map[string]checkinRecord{}
)

type checkinRecord struct {
	DriverID   string    `json:"driver_id"`
	Date       string    `json:"date"`
	HorasSueno int       `json:"horas_sueno"`
	KSSLevel   int       `json:"kss_level"`
	RecordedAt time.Time `json:"recorded_at"`
}

func checkinKey(driverID, date string) string { return driverID + "|" + date }

type DriverHandler struct {
	routeSvc   *service.RouteService
	branchRepo repository.BranchRepository
}

func NewDriverHandler(routeSvc *service.RouteService, branchRepo repository.BranchRepository) *DriverHandler {
	return &DriverHandler{routeSvc: routeSvc, branchRepo: branchRepo}
}

// GetRoute returns today's assigned route and shipments for the authenticated driver.
func (h *DriverHandler) GetRoute(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	route, shipments, err := h.routeSvc.GetTodayRoute(user.ID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no tenés una ruta asignada para hoy"})
		return
	}

	// Generar waypoints desde todos los shipments de la ruta
	waypoints := make([]map[string]interface{}, 0)
	for i, shipment := range shipments {
		waypoint := map[string]interface{}{
			"sequence":    i + 1,
			"tracking_id": shipment.TrackingID,
			"latitude":    shipment.Recipient.Address.Latitude,
			"longitude":   shipment.Recipient.Address.Longitude,
			"name":        shipment.Recipient.Name,
			"address":     shipment.Recipient.Address.Street + ", " + shipment.Recipient.Address.City,
			"status":      shipment.Status,
		}
		waypoints = append(waypoints, waypoint)
	}

	// Incluir coordenadas de la sucursal del chofer como punto de partida
	var origin map[string]interface{}
	if branch, ok := h.branchRepo.GetByID(user.BranchID); ok {
		lat, lng := branch.Latitude, branch.Longitude
		if lat == nil {
			lat = branch.Address.Latitude
		}
		if lng == nil {
			lng = branch.Address.Longitude
		}
		if lat != nil && lng != nil {
			origin = map[string]interface{}{
				"latitude":  *lat,
				"longitude": *lng,
				"name":      branch.Name,
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"route":     route,
		"shipments": shipments,
		"waypoints": waypoints,
		"origin":    origin,
	})
}

// StartRoute transitions the driver's today route from pendiente → en_curso.
func (h *DriverHandler) StartRoute(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	route, err := h.routeSvc.StartRoute(user.ID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": route})
}

// SubmitCheckin records (or overwrites) the KSS fatigue check-in for today.
func (h *DriverHandler) SubmitCheckin(c *gin.Context) {
	var body struct {
		DriverID   string `json:"driver_id"`
		HorasSueno int    `json:"horas_sueno"`
		KSSLevel   int    `json:"kss_level"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "payload inválido"})
		return
	}
	if body.HorasSueno < 0 || body.HorasSueno > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "horas_sueno debe estar entre 0 y 10"})
		return
	}
	if body.KSSLevel < 1 || body.KSSLevel > 9 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kss_level debe estar entre 1 y 9"})
		return
	}
	today := time.Now().Format("2006-01-02")
	rec := checkinRecord{
		DriverID:   body.DriverID,
		Date:       today,
		HorasSueno: body.HorasSueno,
		KSSLevel:   body.KSSLevel,
		RecordedAt: time.Now(),
	}
	checkinMu.Lock()
	checkinStore[checkinKey(body.DriverID, today)] = rec
	checkinMu.Unlock()
	c.JSON(http.StatusOK, gin.H{"ok": true, "checkin": rec})
}
