package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// PriorityLogHandler exposes the automatic SLA reprioritisation audit log to
// supervisors and managers. The underlying data is the append-only JSON file
// written by SLAAnomalyService (data/priority_logs.json).
type PriorityLogHandler struct {
	repo *repository.PriorityLogRepository
}

func NewPriorityLogHandler(repo *repository.PriorityLogRepository) *PriorityLogHandler {
	return &PriorityLogHandler{repo: repo}
}

// List returns all priority-escalation entries, newest first.
// If the log file does not exist yet, an empty array is returned (not an error).
func (h *PriorityLogHandler) List(c *gin.Context) {
	entries := h.repo.ListAll()
	if entries == nil {
		entries = []model.PriorityLog{}
	}
	// Reverse so the most recent entry appears first.
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	c.JSON(http.StatusOK, gin.H{"logs": entries, "total": len(entries)})
}
