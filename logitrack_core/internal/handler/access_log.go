package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type AccessLogHandler struct {
	repo repository.AccessLogRepository
}

func NewAccessLogHandler(repo repository.AccessLogRepository) *AccessLogHandler {
	return &AccessLogHandler{repo: repo}
}

func (h *AccessLogHandler) List(c *gin.Context) {
	limit := 500
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	logs, err := h.repo.List(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if logs == nil {
		logs = []model.AccessLog{}
	}
	c.JSON(http.StatusOK, gin.H{"logs": logs})
}
