package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

type ClaimHandler struct {
	svc *service.ClaimService
}

func NewClaimHandler(svc *service.ClaimService) *ClaimHandler {
	return &ClaimHandler{svc: svc}
}

// ListClaims returns claims for the user's origin branch.
//
// @Summary      List claims
// @Description  Returns claims filtered to the user's origin branch. Operator and supervisor only.
// @Tags         claims
// @Produce      json
// @Security     BearerAuth
// @Success      200  {array}  model.Claim
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Router       /claims [get]
func (h *ClaimHandler) ListClaims(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	claims, err := h.svc.ListByOriginBranch(user.BranchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if claims == nil {
		claims = []model.Claim{}
	}
	c.JSON(http.StatusOK, claims)
}

// GetClaim returns a claim by ID (branch-restricted).
//
// @Summary      Get claim
// @Description  Returns a claim by ID for the user's origin branch. Operator and supervisor only.
// @Tags         claims
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {object}  model.Claim
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id} [get]
func (h *ClaimHandler) GetClaim(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.GetByIDForBranch(c.Param("id"), user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// UpdateClaimCategory derives a claim to a category.
//
// @Summary      Update claim category
// @Description  Updates the claim category and marks it as derived. Operator and supervisor only.
// @Tags         claims
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Param        body body      model.UpdateClaimCategoryRequest true "Category data"
// @Success      200  {object}  model.Claim
// @Failure      400  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/category [patch]
func (h *ClaimHandler) UpdateClaimCategory(c *gin.Context) {
	var req model.UpdateClaimCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.UpdateCategory(c.Param("id"), req.AssignedCategory, user.Username, user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// ResolveClaim resolves a claim with a resolution type.
//
// @Summary      Resolve claim
// @Description  Resolves a claim with a resolution type. Operator and supervisor only.
// @Tags         claims
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Param        body body      model.ResolveClaimRequest true "Resolution data"
// @Success      200  {object}  model.Claim
// @Failure      400  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/resolve [post]
func (h *ClaimHandler) ResolveClaim(c *gin.Context) {
	var req model.ResolveClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.Resolve(c.Param("id"), req.ResolutionType, user.Username, user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// GetClaimEvents returns the event history for a claim.
//
// @Summary      Get claim events
// @Description  Returns the event timeline for a claim. Operator and supervisor only.
// @Tags         claims
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {array}   model.ClaimEvent
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/events [get]
func (h *ClaimHandler) GetClaimEvents(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	events, err := h.svc.GetEvents(c.Param("id"), user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound || err == repository.ErrClaimEventStreamNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if events == nil {
		events = []model.ClaimEvent{}
	}
	c.JSON(http.StatusOK, events)
}

// CreatePublicClaim creates a public claim without authentication.
//
// @Summary      Create public claim
// @Description  Creates a claim linked to a shipment. No authentication required.
// @Tags         public
// @Accept       json
// @Produce      json
// @Param        body  body      model.CreatePublicClaimRequest  true  "Claim data"
// @Success      201   {object}  model.Claim
// @Failure      400   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Router       /public/claims [post]
func (h *ClaimHandler) CreatePublicClaim(c *gin.Context) {
	var req model.CreatePublicClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	claim, err := h.svc.CreatePublicClaim(req)
	if err != nil {
		if err.Error() == "envio no encontrado" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, claim)
}

// GetPublicClaim returns a public claim by ID.
//
// @Summary      Get public claim
// @Description  Returns a claim by ID. No authentication required.
// @Tags         public
// @Produce      json
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {object}  model.Claim
// @Failure      404  {object}  map[string]string
// @Router       /public/claims/{id} [get]
func (h *ClaimHandler) GetPublicClaim(c *gin.Context) {
	claim, err := h.svc.GetByID(c.Param("id"))
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}
