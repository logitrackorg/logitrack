package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/repository"
)

type CustomerHandler struct {
	repo repository.CustomerRepository
}

func NewCustomerHandler(repo repository.CustomerRepository) *CustomerHandler {
	return &CustomerHandler{repo: repo}
}

// GetByDNI looks up a customer by their exact DNI.
//
// @Summary      Get customer by DNI
// @Description  Returns a previously stored customer by exact DNI match. Used for autocomplete.
// @Tags         customers
// @Produce      json
// @Security     BearerAuth
// @Param        dni  query     string  true  "Customer DNI (digits only)"
// @Success      200  {object}  model.Customer
// @Failure      400  {object}  map[string]string
// @Failure      401  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /customers [get]
func (h *CustomerHandler) GetByDNI(c *gin.Context) {
	dni := strings.TrimSpace(c.Query("dni"))
	if dni == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dni query param is required"})
		return
	}
	customer, ok := h.repo.GetByDNI(dni)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "customer not found"})
		return
	}
	c.JSON(http.StatusOK, customer)
}
