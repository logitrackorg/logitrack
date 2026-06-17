package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/service"
)

type EmployeeOfMonthHandler struct {
	svc *service.EmployeeOfMonthService
}

func NewEmployeeOfMonthHandler(svc *service.EmployeeOfMonthService) *EmployeeOfMonthHandler {
	return &EmployeeOfMonthHandler{svc: svc}
}

// GetWinners returns the winners for a given period and branch.
// Supervisors are forced to their own branch. Period defaults to last month.
func (h *EmployeeOfMonthHandler) GetWinners(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)

	// Determine period.
	period := service.PreviousMonthStart()
	if p := c.Query("period"); p != "" {
		parsed, err := time.Parse("2006-01", p)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato de período inválido, usar YYYY-MM"})
			return
		}
		period = parsed
	}

	// Determine branch scope.
	branchID := c.Query("branch_id")
	if user.Role == model.RoleSupervisor {
		branchID = user.BranchID
	}

	winners, err := h.svc.GetWinners(period, branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"winners": winners, "period": period.Format("2006-01")})
}

// Run triggers a manual calculation for the previous month.
func (h *EmployeeOfMonthHandler) Run(c *gin.Context) {
	period := service.PreviousMonthStart()
	if p := c.Query("period"); p != "" {
		parsed, err := time.Parse("2006-01", p)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "formato de período inválido, usar YYYY-MM"})
			return
		}
		period = parsed
	}
	if err := h.svc.ComputeAndPersist(period); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "cálculo completado", "period": period.Format("2006-01")})
}
