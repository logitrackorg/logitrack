package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
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
