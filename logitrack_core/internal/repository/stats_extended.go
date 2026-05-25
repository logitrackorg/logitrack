package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/logitrack/core/internal/model"
)

type StatsExtendedRepository interface {
	DriverPerformance(dateFrom, dateTo *time.Time, branchID string) (model.DriverPerformanceResponse, error)
	IncidentsByBranch(dateFrom, dateTo *time.Time, branchID string) (model.IncidentsByBranchResponse, error)
	BillingMetrics(dateFrom, dateTo *time.Time, branchID string) (model.BillingMetricsResponse, error)
	BranchRanking(dateFrom, dateTo *time.Time, branchID string) (model.BranchRankingResponse, error)
	VolumeByTimeWindow(dateFrom, dateTo *time.Time, branchID string) (model.VolumeByTimeWindowResponse, error)
	ReturnMetrics(dateFrom, dateTo *time.Time, branchID string) (model.ReturnMetricsResponse, error)
	SuccessRateByBranch(dateFrom, dateTo *time.Time, branchID string) (model.SuccessRateByBranchResponse, error)
}

type postgresStatsExtendedRepository struct {
	db *sql.DB
}

func NewPostgresStatsExtendedRepository(db *sql.DB) StatsExtendedRepository {
	return &postgresStatsExtendedRepository{db: db}
}

func (r *postgresStatsExtendedRepository) DriverPerformance(dateFrom, dateTo *time.Time, branchID string) (model.DriverPerformanceResponse, error) {
	from := time.Time{}
	to := time.Time{}
	now := time.Now()
	if dateFrom != nil {
		from = *dateFrom
	} else {
		from = now.AddDate(0, 0, -30)
	}
	if dateTo != nil {
		to = *dateTo
	} else {
		to = now
	}

	rows, err := r.db.Query(`
		WITH assignments AS (
			SELECT
				e.payload->>'DriverID' AS driver_id,
				e.tracking_id,
				MIN(e.timestamp) AS assigned_at
			FROM events e
			WHERE e.event_type = 'status_changed'
			  AND e.payload->>'ToStatus' = 'out_for_delivery'
			  AND e.timestamp >= $1 AND e.timestamp <= $2
			GROUP BY e.payload->>'DriverID', e.tracking_id
		),
		deliveries AS (
			SELECT
				e.tracking_id,
				MIN(e.timestamp) AS delivered_at
			FROM events e
			WHERE e.event_type = 'status_changed'
			  AND e.payload->>'ToStatus' = 'delivered'
			  AND e.timestamp >= $1 AND e.timestamp <= $2
			GROUP BY e.tracking_id
		),
		failures AS (
			SELECT
				e.tracking_id,
				MIN(e.timestamp) AS failed_at
			FROM events e
			WHERE e.event_type = 'status_changed'
			  AND e.payload->>'ToStatus' = 'delivery_failed'
			  AND e.timestamp >= $1 AND e.timestamp <= $2
			GROUP BY e.tracking_id
		)
		SELECT
			u.id AS driver_id,
			COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.username) AS driver_name,
			COALESCE(u.branch_id, '') AS branch_id,
			COALESCE(b.name, '') AS branch_name,
			COUNT(DISTINCT a.tracking_id) AS total_assigned,
			COUNT(DISTINCT d.tracking_id) AS delivered,
			COUNT(DISTINCT f.tracking_id) AS delivery_failed,
			COALESCE(AVG(EXTRACT(EPOCH FROM (d.delivered_at - a.assigned_at)) / 3600), 0) AS avg_delivery_hours
		FROM users u
		LEFT JOIN branches b ON b.id = u.branch_id
		LEFT JOIN assignments a ON a.driver_id = u.id
		LEFT JOIN deliveries d ON d.tracking_id = a.tracking_id
		LEFT JOIN failures f ON f.tracking_id = a.tracking_id
		WHERE u.role = 'driver'
		  AND ($3 = '' OR u.branch_id = $3)
		GROUP BY u.id, u.first_name, u.last_name, u.username, u.branch_id, b.name
		ORDER BY total_assigned DESC
	`, from, to, branchID)
	if err != nil {
		return model.DriverPerformanceResponse{}, fmt.Errorf("driver performance query failed: %w", err)
	}
	defer rows.Close()

	var result model.DriverPerformanceResponse
	for rows.Next() {
		var item model.DriverPerformanceItem
		var avgHours float64
		if err := rows.Scan(
			&item.DriverID,
			&item.DriverName,
			&item.BranchID,
			&item.BranchName,
			&item.TotalAssigned,
			&item.Delivered,
			&item.DeliveryFailed,
			&avgHours,
		); err != nil {
			return model.DriverPerformanceResponse{}, fmt.Errorf("scan driver performance row: %w", err)
		}
		if item.TotalAssigned > 0 {
			rate := (float64(item.Delivered) / float64(item.TotalAssigned)) * 100
			item.SuccessRate = &rate
		}
		if item.Delivered > 0 {
			item.AvgDeliveryHours = &avgHours
		}
		result.Drivers = append(result.Drivers, item)
	}
	if err := rows.Err(); err != nil {
		return model.DriverPerformanceResponse{}, fmt.Errorf("driver performance rows error: %w", err)
	}
	return result, nil
}

func (r *postgresStatsExtendedRepository) IncidentsByBranch(dateFrom, dateTo *time.Time, branchID string) (model.IncidentsByBranchResponse, error) {
	from := time.Time{}
	to := time.Time{}
	now := time.Now()
	if dateFrom != nil {
		from = *dateFrom
	} else {
		from = now.AddDate(0, 0, -30)
	}
	if dateTo != nil {
		to = *dateTo
	} else {
		to = now
	}

	rows, err := r.db.Query(`
		SELECT
			b.id AS branch_id,
			b.name AS branch_name,
			COALESCE(i.incident_type, '') AS incident_type,
			COUNT(i.tracking_id) AS cnt
		FROM branches b
		LEFT JOIN shipments s ON s.receiving_branch_id = b.id
		LEFT JOIN shipment_incidents i ON i.tracking_id = s.tracking_id
										AND i.created_at >= $1 AND i.created_at <= $2
		WHERE ($3 = '' OR b.id = $3)
		GROUP BY b.id, b.name, i.incident_type
		ORDER BY b.id, i.incident_type
	`, from, to, branchID)
	if err != nil {
		return model.IncidentsByBranchResponse{}, fmt.Errorf("incidents by branch query failed: %w", err)
	}
	defer rows.Close()

	result := model.IncidentsByBranchResponse{
		Branches:         []model.IncidentsByBranchItem{},
		GrandTotalByType: map[string]int{},
	}

	branchMap := map[string]*model.IncidentsByBranchItem{}
	for rows.Next() {
		var branchID, branchName, incidentType string
		var cnt int
		if err := rows.Scan(&branchID, &branchName, &incidentType, &cnt); err != nil {
			return model.IncidentsByBranchResponse{}, fmt.Errorf("scan incidents row: %w", err)
		}

		item, ok := branchMap[branchID]
		if !ok {
			item = &model.IncidentsByBranchItem{
				BranchID:   branchID,
				BranchName: branchName,
				ByType:     map[string]int{},
			}
			branchMap[branchID] = item
		}

		if incidentType != "" {
			item.ByType[incidentType] = cnt
			item.Total += cnt
			result.Total += cnt
			result.GrandTotalByType[incidentType] += cnt
		}
	}
	if err := rows.Err(); err != nil {
		return model.IncidentsByBranchResponse{}, fmt.Errorf("incidents rows error: %w", err)
	}

	for _, item := range branchMap {
		result.Branches = append(result.Branches, *item)
	}
	return result, nil
}

func (r *postgresStatsExtendedRepository) BillingMetrics(dateFrom, dateTo *time.Time, branchID string) (model.BillingMetricsResponse, error) {
	from := time.Time{}
	to := time.Time{}
	now := time.Now()
	if dateFrom != nil {
		from = *dateFrom
	} else {
		from = now.AddDate(0, 0, -30)
	}
	if dateTo != nil {
		to = *dateTo
	} else {
		to = now
	}

	result := model.BillingMetricsResponse{
		Currency: "ARS",
		ByBranch: map[string]model.BranchBilling{},
		ByPeriod: map[string]float64{},
	}

	// Aggregate totals
	row := r.db.QueryRow(`
		SELECT COALESCE(SUM(price), 0), COUNT(*)
		FROM shipments
		WHERE status NOT IN ('draft', 'cancelled', 'expired')
		  AND price > 0
		  AND created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
	`, from, to, branchID)
	var totalRevenue float64
	var count int
	if err := row.Scan(&totalRevenue, &count); err != nil {
		return model.BillingMetricsResponse{}, fmt.Errorf("billing totals query failed: %w", err)
	}
	result.TotalRevenue = totalRevenue
	result.Count = count
	if count > 0 {
		avg := totalRevenue / float64(count)
		result.AvgTicket = &avg
	}

	// Per-branch breakdown
	branchRows, err := r.db.Query(`
		SELECT receiving_branch_id, COALESCE(SUM(price), 0), COUNT(*)
		FROM shipments
		WHERE status NOT IN ('draft', 'cancelled', 'expired')
		  AND price > 0
		  AND created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
		GROUP BY receiving_branch_id
	`, from, to, branchID)
	if err != nil {
		return model.BillingMetricsResponse{}, fmt.Errorf("billing by branch query failed: %w", err)
	}
	defer branchRows.Close()
	for branchRows.Next() {
		var bID string
		var revenue float64
		var cnt int
		if err := branchRows.Scan(&bID, &revenue, &cnt); err != nil {
			return model.BillingMetricsResponse{}, fmt.Errorf("scan billing branch row: %w", err)
		}
		avgTicket := 0.0
		if cnt > 0 {
			avgTicket = revenue / float64(cnt)
		}
		result.ByBranch[bID] = model.BranchBilling{
			Revenue:   revenue,
			Count:     cnt,
			AvgTicket: avgTicket,
		}
	}
	if err := branchRows.Err(); err != nil {
		return model.BillingMetricsResponse{}, fmt.Errorf("billing branch rows error: %w", err)
	}

	// Per-period breakdown
	periodRows, err := r.db.Query(`
		SELECT DATE(created_at)::text AS day, COALESCE(SUM(price), 0)
		FROM shipments
		WHERE status NOT IN ('draft', 'cancelled', 'expired')
		  AND price > 0
		  AND created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
		GROUP BY DATE(created_at)
		ORDER BY day
	`, from, to, branchID)
	if err != nil {
		return model.BillingMetricsResponse{}, fmt.Errorf("billing by period query failed: %w", err)
	}
	defer periodRows.Close()
	for periodRows.Next() {
		var day string
		var revenue float64
		if err := periodRows.Scan(&day, &revenue); err != nil {
			return model.BillingMetricsResponse{}, fmt.Errorf("scan billing period row: %w", err)
		}
		result.ByPeriod[day] = revenue
	}
	if err := periodRows.Err(); err != nil {
		return model.BillingMetricsResponse{}, fmt.Errorf("billing period rows error: %w", err)
	}

	return result, nil
}

func (r *postgresStatsExtendedRepository) BranchRanking(dateFrom, dateTo *time.Time, branchID string) (model.BranchRankingResponse, error) {
	from := time.Time{}
	to := time.Time{}
	now := time.Now()
	if dateFrom != nil {
		from = *dateFrom
	} else {
		from = now.AddDate(0, 0, -30)
	}
	if dateTo != nil {
		to = *dateTo
	} else {
		to = now
	}

	rows, err := r.db.Query(`
		SELECT
			b.id AS branch_id,
			b.name AS branch_name,
			COUNT(DISTINCT s.tracking_id) FILTER (WHERE s.status NOT IN ('draft', 'cancelled', 'expired')) AS volume_confirmed,
			COUNT(DISTINCT s.tracking_id) FILTER (WHERE s.status = 'delivered') AS delivered
		FROM branches b
		LEFT JOIN shipments s ON s.receiving_branch_id = b.id
								AND s.created_at >= $1 AND s.created_at <= $2
		GROUP BY b.id, b.name
		ORDER BY volume_confirmed DESC, delivered DESC
	`, from, to)
	if err != nil {
		return model.BranchRankingResponse{}, fmt.Errorf("branch ranking query failed: %w", err)
	}
	defer rows.Close()

	result := model.BranchRankingResponse{
		Ranking: []model.BranchRankingItem{},
	}
	if dateFrom != nil {
		s := from.Format("2006-01-02")
		result.Period.DateFrom = &s
	}
	if dateTo != nil {
		s := to.Format("2006-01-02")
		result.Period.DateTo = &s
	}

	rank := 1
	for rows.Next() {
		var item model.BranchRankingItem
		if err := rows.Scan(&item.BranchID, &item.BranchName, &item.VolumeConfirmed, &item.Delivered); err != nil {
			return model.BranchRankingResponse{}, fmt.Errorf("scan branch ranking row: %w", err)
		}
		item.Rank = rank
		if item.VolumeConfirmed > 0 {
			rate := (float64(item.Delivered) / float64(item.VolumeConfirmed)) * 100
			item.SuccessRate = &rate
			item.CompositeScore = float64(item.VolumeConfirmed) * (rate / 100.0)
		}
		result.Ranking = append(result.Ranking, item)
		rank++
	}
	if err := rows.Err(); err != nil {
		return model.BranchRankingResponse{}, fmt.Errorf("branch ranking rows error: %w", err)
	}
	return result, nil
}

func (r *postgresStatsExtendedRepository) VolumeByTimeWindow(dateFrom, dateTo *time.Time, branchID string) (model.VolumeByTimeWindowResponse, error) {
	from := time.Time{}
	to := time.Time{}
	now := time.Now()
	if dateFrom != nil {
		from = *dateFrom
	} else {
		from = now.AddDate(0, 0, -30)
	}
	if dateTo != nil {
		to = *dateTo
	} else {
		to = now
	}

	result := model.VolumeByTimeWindowResponse{
		Buckets: []model.TimeWindowBucket{},
	}

	row := r.db.QueryRow(`
		SELECT COUNT(*)
		FROM shipments
		WHERE status NOT IN ('draft', 'cancelled', 'expired')
		  AND created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
	`, from, to, branchID)
	if err := row.Scan(&result.Total); err != nil {
		return model.VolumeByTimeWindowResponse{}, fmt.Errorf("volume total query failed: %w", err)
	}

	rows, err := r.db.Query(`
		SELECT time_window, COUNT(*)
		FROM shipments
		WHERE status NOT IN ('draft', 'cancelled', 'expired')
		  AND created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
		GROUP BY time_window
		ORDER BY time_window
	`, from, to, branchID)
	if err != nil {
		return model.VolumeByTimeWindowResponse{}, fmt.Errorf("volume by time window query failed: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var bucket model.TimeWindowBucket
		if err := rows.Scan(&bucket.TimeWindow, &bucket.Count); err != nil {
			return model.VolumeByTimeWindowResponse{}, fmt.Errorf("scan volume time window row: %w", err)
		}
		result.Buckets = append(result.Buckets, bucket)
	}
	if err := rows.Err(); err != nil {
		return model.VolumeByTimeWindowResponse{}, fmt.Errorf("volume time window rows error: %w", err)
	}

	return result, nil
}

func (r *postgresStatsExtendedRepository) ReturnMetrics(dateFrom, dateTo *time.Time, branchID string) (model.ReturnMetricsResponse, error) {
	from := time.Time{}
	to := time.Time{}
	now := time.Now()
	if dateFrom != nil {
		from = *dateFrom
	} else {
		from = now.AddDate(0, 0, -30)
	}
	if dateTo != nil {
		to = *dateTo
	} else {
		to = now
	}

	result := model.ReturnMetricsResponse{
		ByBranch: map[string]model.ReturnBranchMetrics{},
		ByDay:    map[string]int{},
	}

	row := r.db.QueryRow(`
		SELECT
			COUNT(*) FILTER (WHERE status = 'returned') AS returned,
			COUNT(*) FILTER (WHERE status = 'ready_for_return') AS ready_for_return,
			COUNT(*) FILTER (WHERE is_returning = true AND status NOT IN ('draft', 'cancelled', 'expired', 'lost', 'destroyed')) AS total_eligible
		FROM shipments
		WHERE created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
	`, from, to, branchID)
	if err := row.Scan(&result.TotalReturned, &result.TotalReadyForReturn, &result.TotalReturnEligible); err != nil {
		return model.ReturnMetricsResponse{}, fmt.Errorf("return metrics totals query failed: %w", err)
	}
	if result.TotalReturnEligible > 0 {
		rate := (float64(result.TotalReturned) / float64(result.TotalReturnEligible)) * 100
		result.ReturnRate = &rate
	}

	branchRows, err := r.db.Query(`
		SELECT
			receiving_branch_id,
			COUNT(*) FILTER (WHERE status = 'returned') AS returned,
			COUNT(*) FILTER (WHERE status = 'ready_for_return') AS ready_for_return,
			COUNT(*) FILTER (WHERE is_returning = true AND status NOT IN ('draft', 'cancelled', 'expired', 'lost', 'destroyed')) AS total
		FROM shipments
		WHERE created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
		GROUP BY receiving_branch_id
	`, from, to, branchID)
	if err != nil {
		return model.ReturnMetricsResponse{}, fmt.Errorf("return metrics by branch query failed: %w", err)
	}
	defer branchRows.Close()
	for branchRows.Next() {
		var bID string
		var metrics model.ReturnBranchMetrics
		if err := branchRows.Scan(&bID, &metrics.Returned, &metrics.ReadyForReturn, &metrics.Total); err != nil {
			return model.ReturnMetricsResponse{}, fmt.Errorf("scan return metrics branch row: %w", err)
		}
		result.ByBranch[bID] = metrics
	}
	if err := branchRows.Err(); err != nil {
		return model.ReturnMetricsResponse{}, fmt.Errorf("return metrics branch rows error: %w", err)
	}

	dayRows, err := r.db.Query(`
		SELECT DATE(created_at)::text AS day, COUNT(*)
		FROM shipments
		WHERE status = 'returned'
		  AND created_at >= $1 AND created_at <= $2
		  AND ($3 = '' OR receiving_branch_id = $3)
		GROUP BY DATE(created_at)
		ORDER BY day
	`, from, to, branchID)
	if err != nil {
		return model.ReturnMetricsResponse{}, fmt.Errorf("return metrics by day query failed: %w", err)
	}
	defer dayRows.Close()
	for dayRows.Next() {
		var day string
		var cnt int
		if err := dayRows.Scan(&day, &cnt); err != nil {
			return model.ReturnMetricsResponse{}, fmt.Errorf("scan return metrics day row: %w", err)
		}
		result.ByDay[day] = cnt
	}
	if err := dayRows.Err(); err != nil {
		return model.ReturnMetricsResponse{}, fmt.Errorf("return metrics day rows error: %w", err)
	}

	return result, nil
}

func (r *postgresStatsExtendedRepository) SuccessRateByBranch(dateFrom, dateTo *time.Time, branchID string) (model.SuccessRateByBranchResponse, error) {
	from := time.Time{}
	to := time.Time{}
	now := time.Now()
	if dateFrom != nil {
		from = *dateFrom
	} else {
		from = now.AddDate(0, 0, -30)
	}
	if dateTo != nil {
		to = *dateTo
	} else {
		to = now
	}

	rows, err := r.db.Query(`
		SELECT
			b.id AS branch_id,
			b.name AS branch_name,
			COUNT(s.tracking_id) FILTER (WHERE s.status IN ('delivered', 'delivery_failed', 'no_entregado', 'rechazado', 'lost', 'destroyed')) AS total,
			COUNT(s.tracking_id) FILTER (WHERE s.status = 'delivered') AS delivered
		FROM branches b
		LEFT JOIN shipments s ON s.receiving_branch_id = b.id
							AND s.created_at >= $1 AND s.created_at <= $2
		GROUP BY b.id, b.name
		ORDER BY b.id
	`, from, to)
	if err != nil {
		return model.SuccessRateByBranchResponse{}, fmt.Errorf("success rate by branch query failed: %w", err)
	}
	defer rows.Close()

	result := model.SuccessRateByBranchResponse{
		Branches: []model.SuccessRateByBranchItem{},
	}
	for rows.Next() {
		var item model.SuccessRateByBranchItem
		if err := rows.Scan(&item.BranchID, &item.BranchName, &item.Total, &item.Delivered); err != nil {
			return model.SuccessRateByBranchResponse{}, fmt.Errorf("scan success rate branch row: %w", err)
		}
		item.Failed = item.Total - item.Delivered
		if item.Total > 0 {
			item.SuccessRate = (float64(item.Delivered) / float64(item.Total)) * 100
		}
		result.Branches = append(result.Branches, item)
	}
	if err := rows.Err(); err != nil {
		return model.SuccessRateByBranchResponse{}, fmt.Errorf("success rate branch rows error: %w", err)
	}
	return result, nil
}
