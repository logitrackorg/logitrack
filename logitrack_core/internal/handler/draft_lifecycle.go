package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

// DraftLifecycleHandler exposes the compliance endpoints for the draft lifecycle
// feature (Ley 25.326 / ARCO). All routes are restricted to admin role.
type DraftLifecycleHandler struct {
	svc *service.DraftLifecycleService
}

func NewDraftLifecycleHandler(svc *service.DraftLifecycleService) *DraftLifecycleHandler {
	return &DraftLifecycleHandler{svc: svc}
}

// GetAuditLog godoc
// GET /admin/compliance/audit?tracking_id=<id>
// Returns the draft audit trail. If tracking_id is provided, filters to that draft.
func (h *DraftLifecycleHandler) GetAuditLog(c *gin.Context) {
	trackingID := c.Query("tracking_id")
	var (
		entries interface{}
		err     error
	)
	if trackingID != "" {
		entries, err = h.svc.GetAuditLog(trackingID)
	} else {
		entries, err = h.svc.GetAllAuditLog()
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, entries)
}

// FindByDNI godoc
// GET /admin/compliance/drafts?dni=<dni>
// Returns all active/expired drafts that contain the given DNI (for ARCO preview).
func (h *DraftLifecycleHandler) FindByDNI(c *gin.Context) {
	dni := c.Query("dni")
	if dni == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "parámetro 'dni' requerido"})
		return
	}
	drafts, err := h.svc.FindDraftsByDNI(dni)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, drafts)
}

// Suppress godoc
// POST /admin/compliance/suppress
// Body: { "dni": "12345678" }
// Immediately anonymizes PII in all drafts matching the given DNI (CA-04 ARCO suppression).
func (h *DraftLifecycleHandler) Suppress(c *gin.Context) {
	var body struct {
		DNI string `json:"dni"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)
	username := user.Username
	count, err := h.svc.SuppressByDNI(body.DNI, username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"suppressed": count,
		"message":    "Supresión de datos personales ejecutada correctamente.",
	})
}

// TriggerExpiration godoc
// POST /admin/compliance/expire-drafts
// Manually triggers the expiration job (for testing or forced execution).
func (h *DraftLifecycleHandler) TriggerExpiration(c *gin.Context) {
	h.svc.RunExpirationJob()
	c.JSON(http.StatusOK, gin.H{"message": "Job de expiración ejecutado."})
}

// TriggerPurge godoc
// POST /admin/compliance/purge-pii
// Manually triggers the PII purge job.
func (h *DraftLifecycleHandler) TriggerPurge(c *gin.Context) {
	h.svc.RunPurgeJob()
	c.JSON(http.StatusOK, gin.H{"message": "Job de purga de PII ejecutado."})
}
