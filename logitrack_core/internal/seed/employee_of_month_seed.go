package seed

import (
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// monthStart devuelve el primer día del mes a N meses atrás desde now.
func monthStart(now time.Time, monthsAgo int) time.Time {
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, clock.LocalTZ)
	return first.AddDate(0, -monthsAgo, 0)
}

func flt(v float64) *float64 { return &v }

// LoadEmployeeOfMonthWinners siembra ganadores de los últimos 4 meses para que
// el dashboard y el perfil de empleado muestren historial sin esperar al job.
// Idempotente: usa UpsertWinner (ON CONFLICT DO UPDATE).
func LoadEmployeeOfMonthWinners(repo repository.EmployeeOfMonthRepository) {
	now := clock.Now().In(clock.LocalTZ)

	// Usuarios seed relevantes:
	//   "1"  = op_caba (operador CABA)
	//   "3"  = op_cordoba (operador Córdoba)
	//   "5"  = chofer_caba (última milla CABA)
	//   "10" = chofer_cordoba (última milla Córdoba)
	//   "12" = chofer_caba2 (última milla CABA)
	//   "15" = chofer_inter_1 (inter-sucursal, sin sucursal fija)
	//   "16" = chofer_inter_2 (inter-sucursal)

	type entry struct {
		monthsAgo     int
		category      model.EmployeeOfMonthCategory
		branchID      string
		hasWinner     bool
		userID        string
		score         *float64
		activityCount int
	}

	entries := []entry{
		// ── Mes anterior (M-1) ────────────────────────────────────────────────
		{1, model.CategoryLastMileDriver, "caba", true, "5", flt(87.5), 42},
		{1, model.CategoryLastMileDriver, "cordoba", true, "10", flt(79.3), 31},
		{1, model.CategoryOperator, "caba", true, "1", flt(75.0), 38},
		{1, model.CategoryOperator, "cordoba", false, "", nil, 0}, // sin elegibles
		{1, model.CategoryInterBranchDriver, "", true, "15", flt(82.1), 5},

		// ── Hace 2 meses (M-2) ───────────────────────────────────────────────
		{2, model.CategoryLastMileDriver, "caba", true, "12", flt(91.2), 47}, // otro chofer gana
		{2, model.CategoryLastMileDriver, "cordoba", true, "10", flt(83.7), 35},
		{2, model.CategoryOperator, "caba", true, "1", flt(70.8), 29},
		{2, model.CategoryOperator, "cordoba", true, "3", flt(68.4), 24},
		{2, model.CategoryInterBranchDriver, "", true, "16", flt(77.5), 4}, // otro inter-sucursal gana

		// ── Hace 3 meses (M-3) ───────────────────────────────────────────────
		{3, model.CategoryLastMileDriver, "caba", true, "5", flt(84.0), 39},
		{3, model.CategoryLastMileDriver, "cordoba", false, "", nil, 0}, // sin elegibles
		{3, model.CategoryOperator, "caba", true, "1", flt(72.3), 33},
		{3, model.CategoryOperator, "cordoba", true, "3", flt(65.9), 21},
		{3, model.CategoryInterBranchDriver, "", true, "15", flt(80.6), 6},

		// ── Hace 4 meses (M-4) ───────────────────────────────────────────────
		{4, model.CategoryLastMileDriver, "caba", true, "5", flt(88.9), 44},
		{4, model.CategoryLastMileDriver, "cordoba", true, "10", flt(76.1), 28},
		{4, model.CategoryOperator, "caba", false, "", nil, 0}, // sin elegibles ese mes
		{4, model.CategoryOperator, "cordoba", true, "3", flt(71.2), 26},
		{4, model.CategoryInterBranchDriver, "", true, "15", flt(85.3), 7},
	}

	for _, e := range entries {
		period := monthStart(now, e.monthsAgo)
		w := model.EmployeeOfMonthWinner{
			Period:        period,
			Category:      e.category,
			BranchID:      e.branchID,
			HasWinner:     e.hasWinner,
			UserID:        e.userID,
			Score:         e.score,
			ActivityCount: e.activityCount,
		}
		_ = repo.UpsertWinner(w)
	}
}
