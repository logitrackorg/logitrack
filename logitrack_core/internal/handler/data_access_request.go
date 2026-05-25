package handler

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

type DataAccessRequestHandler struct {
	repo        repository.DataAccessRequestRepository
	checkinRepo *repository.CheckinRepository
	notifSvc    *service.NotificationService
}

func NewDataAccessRequestHandler(
	repo repository.DataAccessRequestRepository,
	checkinRepo *repository.CheckinRepository,
	notifSvc *service.NotificationService,
) *DataAccessRequestHandler {
	return &DataAccessRequestHandler{repo: repo, checkinRepo: checkinRepo, notifSvc: notifSvc}
}

// Create — POST /users/me/data-request
// Chofer solicita acceso a su historial de check-in. Persiste la solicitud y notifica a los admins.
func (h *DataAccessRequestHandler) Create(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	if user.Role != model.RoleDriver {
		c.JSON(http.StatusForbidden, gin.H{"error": "solo los choferes pueden solicitar datos de monitoreo"})
		return
	}

	fullName := strings.TrimSpace(user.FirstName + " " + user.LastName)
	if fullName == "" {
		fullName = user.Username
	}

	req := model.DataAccessRequest{
		ID:          uuid.NewString(),
		DriverID:    user.ID,
		DriverName:  fullName,
		BranchID:    user.BranchID,
		Status:      model.DataAccessPending,
		RequestedAt: time.Now().UTC(),
	}
	if err := h.repo.Create(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo registrar la solicitud"})
		return
	}

	go h.notifSvc.NotifyDataAccessRequest(user.ID, user.Username, fullName)

	c.JSON(http.StatusOK, gin.H{
		"message": "Solicitud enviada. El supervisor fue notificado y revisara tu pedido a la brevedad.",
		"request": req,
	})
}

// ListMine — GET /users/me/data-requests
// Chofer ve sus propias solicitudes (con el checkin_data si fue aceptada).
func (h *DataAccessRequestHandler) ListMine(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	reqs, err := h.repo.ListByDriver(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener el historial"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// ListPending — GET /supervisor/data-requests
// Supervisor ve todas las solicitudes de su sucursal.
func (h *DataAccessRequestHandler) ListPending(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	reqs, err := h.repo.ListByBranch(user.BranchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener las solicitudes"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": reqs})
}

// Accept — PATCH /supervisor/data-requests/:id/accept
// Supervisor aprueba: se toma snapshot del ultimo checkin del chofer y se persiste.
func (h *DataAccessRequestHandler) Accept(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	id := c.Param("id")

	dar, ok := h.repo.GetByID(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "solicitud no encontrada"})
		return
	}
	if dar.BranchID != user.BranchID {
		c.JSON(http.StatusForbidden, gin.H{"error": "la solicitud no pertenece a tu sucursal"})
		return
	}
	if dar.Status != model.DataAccessPending {
		c.JSON(http.StatusBadRequest, gin.H{"error": "la solicitud ya fue revisada"})
		return
	}

	// Snapshot del ultimo check-in del chofer al momento de aceptar.
	var lastCheckin *model.DriverCheckin
	all := h.checkinRepo.AllForDriver(dar.DriverID)
	if len(all) > 0 {
		sort.Slice(all, func(i, j int) bool { return all[i].Date > all[j].Date })
		lastCheckin = &all[0]
	}

	if err := h.repo.Accept(id, user.Username, lastCheckin); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo actualizar la solicitud"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Reject — PATCH /supervisor/data-requests/:id/reject
func (h *DataAccessRequestHandler) Reject(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	id := c.Param("id")

	dar, ok := h.repo.GetByID(id)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "solicitud no encontrada"})
		return
	}
	if dar.BranchID != user.BranchID {
		c.JSON(http.StatusForbidden, gin.H{"error": "la solicitud no pertenece a tu sucursal"})
		return
	}
	if dar.Status != model.DataAccessPending {
		c.JSON(http.StatusBadRequest, gin.H{"error": "la solicitud ya fue revisada"})
		return
	}

	if err := h.repo.Reject(id, user.Username); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo actualizar la solicitud"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
