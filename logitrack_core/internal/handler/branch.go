package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type BranchHandler struct {
	svc *service.BranchService
}

func NewBranchHandler(svc *service.BranchService) *BranchHandler {
	return &BranchHandler{svc: svc}
}

func (h *BranchHandler) RegisterRoutes(r *gin.RouterGroup) {
	r.GET("/branches", h.List)
	r.POST("/branches", h.Create)
	r.GET("/branches/search", h.Search)
	r.PATCH("/branches/:id", h.Update)
	r.PATCH("/branches/:id/status", h.UpdateStatus)
}

// List returns all branches, optionally filtered by status.
func (h *BranchHandler) List(c *gin.Context) {
	status := c.Query("status")
	branches := h.svc.List()

	if status != "" {
		filtered := make([]model.Branch, 0)
		for _, b := range branches {
			if string(b.Status) == status {
				filtered = append(filtered, b)
			}
		}
		c.JSON(http.StatusOK, filtered)
		return
	}

	c.JSON(http.StatusOK, branches)
}

// Search returns branches matching name or ID.
func (h *BranchHandler) Search(c *gin.Context) {
	q := c.Query("q")
	c.JSON(http.StatusOK, h.svc.Search(q))
}

// Create registers a new branch/warehouse.
func (h *BranchHandler) Create(c *gin.Context) {
	var req model.CreateBranchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	branch, err := h.svc.Create(req)
	if err != nil {
		if errors.Is(err, service.ErrBranchDuplicateName) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, branch)
}

// Update edits branch data (only active branches).
func (h *BranchHandler) Update(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branch ID is required"})
		return
	}

	var req model.UpdateBranchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	branch, err := h.svc.Update(id, req)
	if err != nil {
		if errors.Is(err, service.ErrBranchNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, service.ErrBranchDuplicateName) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		if errors.Is(err, service.ErrBranchNotActive) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, branch)
}

// UpdateStatus changes branch operational status.
func (h *BranchHandler) UpdateStatus(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "branch ID is required"})
		return
	}

	var req model.UpdateBranchStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user := c.MustGet(middleware.UserKey).(model.User)

	branch, err := h.svc.UpdateStatus(id, req, user.Username)
	if err != nil {
		if errors.Is(err, service.ErrBranchNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, branch)
}
