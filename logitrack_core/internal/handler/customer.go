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
