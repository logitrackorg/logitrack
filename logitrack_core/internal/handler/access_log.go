package handler

import (
	"net/http"

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
	filter := model.AccessLogFilter{
		Username: c.Query("username"),
		DateFrom: c.Query("date_from"),
		DateTo:   c.Query("date_to"),
		Limit:    500,
	}

	logs, err := h.repo.ListFiltered(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener el historial"})
		return
	}
	if logs == nil {
		logs = []model.AccessLog{}
	}
	c.JSON(http.StatusOK, logs)
}
