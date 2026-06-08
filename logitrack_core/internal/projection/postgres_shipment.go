package projection

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
)

// PostgresShipmentProjection is a write-through materialized view backed by PostgreSQL.
// It mirrors the interface of ShipmentProjection but persists state in the shipments table.
type PostgresShipmentProjection struct {
	db *sql.DB
}

func NewPostgresShipmentProjection(db *sql.DB) *PostgresShipmentProjection {
	return &PostgresShipmentProjection{db: db}
}

// Apply updates the projection for a single event. Called after every Append.
func (p *PostgresShipmentProjection) Apply(event model.DomainEvent) {
	// Errors are logged but not returned — projection failures are not fatal for writes.
	if err := p.apply(event); err != nil {
		fmt.Printf("projection apply error [%s %s]: %v\n", event.EventType, event.TrackingID, err)
	}
}

func (p *PostgresShipmentProjection) apply(event model.DomainEvent) error {
	switch event.EventType {
	case model.EventShipmentCreated:
		payload := event.Payload.(model.ShipmentCreatedPayload)
		return p.upsertShipment(payload.Shipment)

	case model.EventDraftSaved:
		payload := event.Payload.(model.DraftSavedPayload)
		return p.upsertShipment(payload.Shipment)

	case model.EventDraftUpdated:
		payload := event.Payload.(model.DraftUpdatedPayload)
		return p.upsertShipment(payload.Shipment)

	case model.EventDraftConfirmed:
		payload := event.Payload.(model.DraftConfirmedPayload)
		var priceBreakdown []byte
		if payload.PriceBreakdown != nil {
			priceBreakdown, _ = json.Marshal(payload.PriceBreakdown)
		}
		if payload.Prediction != nil {
			factorsJSON, _ := json.Marshal(payload.Prediction.Factors)
			_, err := p.db.Exec(`
				UPDATE shipments
				SET tracking_id = $1, status = $2, updated_at = $3,
				    priority = $4, priority_score = $5, priority_confidence = $6, priority_factors = $7,
				    estimated_delivery_at = $8,
				    price = COALESCE($9, price),
				    price_breakdown = COALESCE($10, price_breakdown),
				    security_keyword = CASE WHEN $11 != '' THEN $11 ELSE security_keyword END
				WHERE tracking_id = $12`,
				payload.NewTrackingID, string(model.StatusAtOriginHub), event.Timestamp,
				payload.Prediction.Priority, payload.Prediction.Score, payload.Prediction.Confidence, factorsJSON,
				payload.EstimatedDeliveryAt,
				nullableFloat(payload.Price), nullableBytes(priceBreakdown),
				payload.SecurityKeyword,
				payload.OldTrackingID,
			)
			return err
		}
		_, err := p.db.Exec(`
			UPDATE shipments
			SET tracking_id = $1, status = $2, updated_at = $3, estimated_delivery_at = $4,
			    price = COALESCE($5, price),
			    price_breakdown = COALESCE($6, price_breakdown),
			    security_keyword = CASE WHEN $7 != '' THEN $7 ELSE security_keyword END
			WHERE tracking_id = $8`,
			payload.NewTrackingID, string(model.StatusAtOriginHub), event.Timestamp,
			payload.EstimatedDeliveryAt,
			nullableFloat(payload.Price), nullableBytes(priceBreakdown),
			payload.SecurityKeyword,
			payload.OldTrackingID,
		)
		return err

	case model.EventDeliveryKeywordFailed:
		_, err := p.db.Exec(`
			UPDATE shipments SET keyword_attempts = keyword_attempts + 1, updated_at = $1 WHERE tracking_id = $2`,
			event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventStatusChanged:
		payload := event.Payload.(model.StatusChangedPayload)
		if payload.ToStatus == model.StatusDelivered {
			_, err := p.db.Exec(`
				UPDATE shipments
				SET status = $1, updated_at = $2, delivered_at = $3, contingency_delivery = $4
				WHERE tracking_id = $5`,
				string(payload.ToStatus), event.Timestamp, event.Timestamp, payload.ContingencyDelivery, event.TrackingID,
			)
			return err
		}
		if payload.ToStatus == model.StatusDeliveryFailed {
			_, err := p.db.Exec(`
				UPDATE shipments
				SET status = $1, updated_at = $2,
				    delivery_attempts = delivery_attempts + 1,
				    rejected_by_recipient = $3
				WHERE tracking_id = $4`,
				string(payload.ToStatus), event.Timestamp, payload.RejectedByRecipient, event.TrackingID,
			)
			return err
		}
		if payload.ToStatus == model.StatusNoEntregado || payload.ToStatus == model.StatusRechazado {
			_, err := p.db.Exec(`
				UPDATE shipments
				SET status = $1, updated_at = $2, is_returning = TRUE,
				    final_branch_id = origin_branch_id
				WHERE tracking_id = $3`,
				string(payload.ToStatus), event.Timestamp, event.TrackingID,
			)
			return err
		}
		if payload.Location != "" {
			if payload.ToStatus == model.StatusAtHub || payload.ToStatus == model.StatusAtOriginHub {
				// Auto-promover a ready_for_pickup cuando un envío con branch_pickup llega
				// a la sucursal final (at_hub con location == final_branch_id).
				_, err := p.db.Exec(`
					UPDATE shipments
					SET status = CASE
					        WHEN $1 = $5 AND delivery_method = $6 AND $2 = final_branch_id THEN $7
					        ELSE $1
					    END,
					    current_location = $2,
					    receiving_branch_id = $2,
					    updated_at = $3
					WHERE tracking_id = $4`,
					string(payload.ToStatus), payload.Location, event.Timestamp, event.TrackingID,
					string(model.StatusAtHub),
					string(model.DeliveryMethodBranchPickup),
					string(model.StatusReadyForPickup),
				)
				return err
			}
			_, err := p.db.Exec(`
				UPDATE shipments
				SET status = $1, current_location = $2, updated_at = $3
				WHERE tracking_id = $4`,
				string(payload.ToStatus), payload.Location, event.Timestamp, event.TrackingID,
			)
			return err
		}
		_, err := p.db.Exec(`
			UPDATE shipments SET status = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(payload.ToStatus), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventShipmentCorrected:
		payload := event.Payload.(model.ShipmentCorrectedPayload)
		// Read current corrections, merge, write back
		var raw []byte
		err := p.db.QueryRow(
			`SELECT COALESCE(corrections, 'null') FROM shipments WHERE tracking_id = $1`,
			event.TrackingID,
		).Scan(&raw)
		if err != nil {
			return err
		}
		var current model.ShipmentCorrections
		if string(raw) != "null" {
			if err := json.Unmarshal(raw, &current); err != nil {
				return err
			}
		}
		current.Merge(payload.Corrections)
		merged, err := json.Marshal(current)
		if err != nil {
			return err
		}
		if payload.Prediction != nil {
			factorsJSON, _ := json.Marshal(payload.Prediction.Factors)
			_, err = p.db.Exec(`
				UPDATE shipments
				SET corrections = $1, updated_at = $2,
				    priority = $3, priority_score = $4, priority_confidence = $5, priority_factors = $6
				WHERE tracking_id = $7`,
				merged, event.Timestamp,
				payload.Prediction.Priority, payload.Prediction.Score, payload.Prediction.Confidence, factorsJSON,
				event.TrackingID,
			)
		} else {
			_, err = p.db.Exec(`
				UPDATE shipments SET corrections = $1, updated_at = $2 WHERE tracking_id = $3`,
				merged, event.Timestamp, event.TrackingID,
			)
		}
		if err == nil && payload.FinalBranchID != "" {
			_, err = p.db.Exec(
				`UPDATE shipments SET final_branch_id = $1 WHERE tracking_id = $2`,
				payload.FinalBranchID, event.TrackingID,
			)
		}
		return err

	case model.EventShipmentCancelled:
		_, err := p.db.Exec(`
			UPDATE shipments SET status = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(model.StatusCancelled), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventIncidentReported:
		payload := event.Payload.(model.IncidentReportedPayload)
		_, err := p.db.Exec(`
			UPDATE shipments SET has_incident = TRUE, incident_type = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(payload.IncidentType), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventShipmentETAExtended:
		payload := event.Payload.(model.ShipmentETAExtendedPayload)
		_, err := p.db.Exec(`
			UPDATE shipments SET estimated_delivery_at = $1, updated_at = $2 WHERE tracking_id = $3`,
			payload.NewETA, event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventPaymentRequested:
		// Stamp the price/priority already on the draft and transition to pending_payment.
		// The shipment struct in the cmd already has Price/PriceBreakdown/Priority stamped —
		// we only need to update the status; the rest was persisted by UpdateDraft before this event.
		_, err := p.db.Exec(`
			UPDATE shipments SET status = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(model.StatusPendingPayment), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventPaymentConfirmed:
		payload := event.Payload.(model.PaymentConfirmedPayload)
		var priceBreakdown []byte // price already stamped at request-payment time; no change needed here
		_ = priceBreakdown
		if payload.Prediction != nil {
			factorsJSON, _ := json.Marshal(payload.Prediction.Factors)
			_, err := p.db.Exec(`
				UPDATE shipments
				SET tracking_id = $1, status = $2, updated_at = $3,
				    priority = $4, priority_score = $5, priority_confidence = $6, priority_factors = $7,
				    estimated_delivery_at = $8
				WHERE tracking_id = $9`,
				payload.NewTrackingID, string(model.StatusAtOriginHub), event.Timestamp,
				payload.Prediction.Priority, payload.Prediction.Score, payload.Prediction.Confidence, factorsJSON,
				payload.EstimatedDeliveryAt,
				payload.OldTrackingID,
			)
			return err
		}
		_, err := p.db.Exec(`
			UPDATE shipments
			SET tracking_id = $1, status = $2, updated_at = $3, estimated_delivery_at = $4
			WHERE tracking_id = $5`,
			payload.NewTrackingID, string(model.StatusAtOriginHub), event.Timestamp,
			payload.EstimatedDeliveryAt,
			payload.OldTrackingID,
		)
		return err

	case model.EventReturnedToDraft:
		_, err := p.db.Exec(`
			UPDATE shipments SET status = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(model.StatusDraft), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventPickupRequested:
		// Cambia el método de entrega. Solo promueve a ready_for_pickup si el envío
		// ya está en la sucursal final (at_hub con current_location == final_branch_id).
		// En caso contrario el status queda como está y se auto-promueve al llegar.
		_, err := p.db.Exec(`
			UPDATE shipments
			SET delivery_method = $1,
			    status = CASE
			        WHEN status = $2 AND current_location = final_branch_id THEN $3
			        ELSE status
			    END,
			    updated_at = $4
			WHERE tracking_id = $5`,
			string(model.DeliveryMethodBranchPickup),
			string(model.StatusAtHub),
			string(model.StatusReadyForPickup),
			event.Timestamp,
			event.TrackingID,
		)
		return err

	case model.EventDeliveryRescheduled:
	payload := event.Payload.(model.DeliveryRescheduledPayload)
	
	chatbotMetadata := map[string]interface{}{
		"reschedule_count":         payload.RescheduleCount,
		"max_reschedules":          2,
		"original_delivery_date":   payload.OriginalDate,
		"scheduled_delivery_date":  payload.NewDeliveryDate,
		"last_chatbot_interaction": event.Timestamp,
	}
	
	metadataJSON, err := json.Marshal(chatbotMetadata)
	if err != nil {
		return err
	}
	
	// Obtener el estado actual
	var currentStatus string
	err = p.db.QueryRow(`SELECT status FROM shipments WHERE tracking_id = $1`, event.TrackingID).Scan(&currentStatus)
	if err != nil {
		return err
	}
	
	// Solo cambiar a redelivery_scheduled si viene de delivery_failed
	newStatus := currentStatus
	if currentStatus == string(model.StatusDeliveryFailed) {
		newStatus = string(model.StatusRedeliveryScheduled)
	}
	
	// ✅ ACTUALIZAR: Guardar también en la tabla de eventos con ubicación
	_, err = p.db.Exec(`
		UPDATE shipments 
		SET estimated_delivery_at = $1, 
		    status = $2,
		    chatbot_metadata = $3,
		    updated_at = $4 
		WHERE tracking_id = $5`,
		payload.NewDeliveryDate,
		newStatus,
		metadataJSON,
		event.Timestamp,
		event.TrackingID,
	)
	
	// ✅ NUEVO: Guardar evento con ubicación en la tabla events
	if err == nil && payload.CurrentLocation != nil {
		var locationTypeStr, locationCodeStr, locationNameStr, locationStatusStr interface{}
		locationTypeStr = payload.CurrentLocation.Type
		locationCodeStr = payload.CurrentLocation.BranchCode
		locationNameStr = payload.CurrentLocation.BranchName
		locationStatusStr = payload.CurrentLocation.Status
		
		// Actualizar evento en la tabla events
		_, err = p.db.Exec(`
			UPDATE events 
			SET current_location_type = $1,
			    current_location_code = $2,
			    current_location_name = $3,
			    current_location_status = $4,
			    rescheduled_date = $5,
			    via = $6
			WHERE tracking_id = $7 AND id = $8`,
			locationTypeStr,
			locationCodeStr,
			locationNameStr,
			locationStatusStr,
			payload.NewDeliveryDate,
			payload.RequestedVia,
			event.TrackingID,
			event.ID,
		)
	}
	
	return err

	case model.EventCancelledByRecipient:
		_, err := p.db.Exec(`
			UPDATE shipments
			SET status = $1, updated_at = $2, is_returning = TRUE,
			    final_branch_id = origin_branch_id
			WHERE tracking_id = $3`,
			string(model.StatusRechazado), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventCancelledBySender:
		_, err := p.db.Exec(`
			UPDATE shipments SET status = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(model.StatusCancelled), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventShipmentZoned:
		payload := event.Payload.(model.ShipmentZonedPayload)
		_, err := p.db.Exec(`
			UPDATE shipments SET current_zone = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(payload.Zone), event.Timestamp, event.TrackingID,
		)
		return err

	case model.EventShipmentMoved:
		payload := event.Payload.(model.ShipmentMovedPayload)
		_, err := p.db.Exec(`
			UPDATE shipments SET current_zone = $1, updated_at = $2 WHERE tracking_id = $3`,
			string(payload.ToZone), event.Timestamp, event.TrackingID,
		)
		return err
	}
	return nil
}

func (p *PostgresShipmentProjection) upsertShipment(s model.Shipment) error {
	sender, err := json.Marshal(s.Sender)
	if err != nil {
		return err
	}
	recipient, err := json.Marshal(s.Recipient)
	if err != nil {
		return err
	}
	var corrections []byte
	if s.Corrections != nil {
		corrections, err = json.Marshal(s.Corrections)
		if err != nil {
			return err
		}
	}
	var priorityFactors []byte
	if s.PriorityFactors != nil {
		priorityFactors, err = json.Marshal(s.PriorityFactors)
		if err != nil {
			return err
		}
	}
	var priceBreakdown []byte
	if s.PriceBreakdown != nil {
		priceBreakdown, err = json.Marshal(s.PriceBreakdown)
		if err != nil {
			return err
		}
	}

	deliveryMethod := s.DeliveryMethod
	if deliveryMethod == "" {
		deliveryMethod = model.DeliveryMethodLastMile
	}
	priceCurrency := s.PriceCurrency
	if priceCurrency == "" {
		priceCurrency = model.CurrencyARS
	}

	_, err = p.db.Exec(`
		INSERT INTO shipments (
			tracking_id, status, current_location, current_zone, weight_kg, package_type,
			is_fragile, special_instructions, receiving_branch_id, origin_branch_id,
			created_at, updated_at, estimated_delivery_at, delivered_at,
			sender, recipient, corrections,
			shipment_type, time_window,
			priority, priority_score, priority_confidence, priority_factors,
			has_incident, incident_type,
			parent_shipment_id, delivery_attempts, is_returning,
			final_branch_id, delivery_method,
			price, price_breakdown, price_currency,
			rejected_by_recipient, chatbot_metadata,
			security_keyword, keyword_attempts, contingency_delivery
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
		ON CONFLICT (tracking_id) DO UPDATE SET
			status                = EXCLUDED.status,
			current_location      = EXCLUDED.current_location,
			current_zone          = EXCLUDED.current_zone,
			weight_kg             = EXCLUDED.weight_kg,
			package_type          = EXCLUDED.package_type,
			is_fragile            = EXCLUDED.is_fragile,
			special_instructions  = EXCLUDED.special_instructions,
			receiving_branch_id   = EXCLUDED.receiving_branch_id,
			updated_at            = EXCLUDED.updated_at,
			estimated_delivery_at = EXCLUDED.estimated_delivery_at,
			delivered_at          = EXCLUDED.delivered_at,
			sender                = EXCLUDED.sender,
			recipient             = EXCLUDED.recipient,
			corrections           = EXCLUDED.corrections,
			shipment_type         = EXCLUDED.shipment_type,
			time_window           = EXCLUDED.time_window,
			priority              = EXCLUDED.priority,
			priority_score        = EXCLUDED.priority_score,
			priority_confidence   = EXCLUDED.priority_confidence,
			priority_factors      = EXCLUDED.priority_factors,
			parent_shipment_id    = EXCLUDED.parent_shipment_id,
			delivery_attempts     = EXCLUDED.delivery_attempts,
			is_returning          = EXCLUDED.is_returning,
			final_branch_id       = CASE WHEN EXCLUDED.final_branch_id != '' THEN EXCLUDED.final_branch_id ELSE shipments.final_branch_id END,
			delivery_method       = EXCLUDED.delivery_method,
			price                 = COALESCE(EXCLUDED.price, shipments.price),
			price_breakdown       = COALESCE(EXCLUDED.price_breakdown, shipments.price_breakdown),
			price_currency        = EXCLUDED.price_currency,
			rejected_by_recipient = EXCLUDED.rejected_by_recipient,
			chatbot_metadata      = EXCLUDED.chatbot_metadata,
			security_keyword      = CASE WHEN EXCLUDED.security_keyword != '' THEN EXCLUDED.security_keyword ELSE shipments.security_keyword END,
			keyword_attempts      = EXCLUDED.keyword_attempts,
			contingency_delivery  = EXCLUDED.contingency_delivery`,
		s.TrackingID, string(s.Status), s.CurrentLocation, s.CurrentZone, s.WeightKg, string(s.PackageType),
		s.IsFragile, s.SpecialInstructions, s.ReceivingBranchID, s.OriginBranchID,
		s.CreatedAt, s.UpdatedAt, nullableTime(s.EstimatedDeliveryAt), s.DeliveredAt,
		sender, recipient, nullableBytes(corrections),
		string(s.ShipmentType), string(s.TimeWindow),
		s.Priority, s.PriorityScore, s.PriorityConfidence, nullableBytes(priorityFactors),
		s.HasIncident, string(s.IncidentType),
		s.ParentShipmentID, s.DeliveryAttempts, s.IsReturning,
		s.FinalBranchID, string(deliveryMethod),
		nullableFloat(s.Price), nullableBytes(priceBreakdown), priceCurrency,
		s.RejectedByRecipient, serializeChatbotMetadata(s.ChatbotMetadata),
		s.SecurityKeyword, s.KeywordAttempts, s.ContingencyDelivery,
)
	return err
}

// Rebuild replays events into the projection. Idempotent: uses upserts, no DELETE.
// For the Postgres projection, Apply already keeps the table in sync on every write.
// Rebuild is only needed when replaying historical events (e.g., first seed run).
func (p *PostgresShipmentProjection) Rebuild(events []model.DomainEvent) {
	for _, event := range events {
		p.Apply(event)
	}
}

func (p *PostgresShipmentProjection) Get(trackingID string) (model.Shipment, error) {
	row := p.db.QueryRow(`
		SELECT tracking_id, status, current_location, current_zone, weight_kg, package_type,
		       is_fragile, special_instructions, receiving_branch_id, origin_branch_id,
		       created_at, updated_at, estimated_delivery_at, delivered_at,
		       sender, recipient, corrections,
		       shipment_type, time_window,
		       priority, priority_score, priority_confidence, priority_factors,
		       has_incident, incident_type,
		       parent_shipment_id, delivery_attempts, is_returning, final_branch_id, delivery_method,
		       price, price_breakdown, price_currency, reserved_for_trip_id, sla_notified_at, sla_expired_notified_at,
		       rejected_by_recipient, chatbot_metadata,
		       security_keyword, keyword_attempts, contingency_delivery
		FROM shipments WHERE tracking_id = $1`, trackingID)
	s, err := scanShipment(row)
	if err == nil {
		now := clock.Now()
		s.IsDelayed = s.ComputeIsDelayed(now)
		s.IsAtRisk = s.ComputeIsAtRisk(now)
	}
	return s, err
}

func (p *PostgresShipmentProjection) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	selectCols := `
		SELECT tracking_id, status, current_location, current_zone, weight_kg, package_type,
		       is_fragile, special_instructions, receiving_branch_id, origin_branch_id,
		       created_at, updated_at, estimated_delivery_at, delivered_at,
		       sender, recipient, corrections,
		       shipment_type, time_window,
		       priority, priority_score, priority_confidence, priority_factors,
		       has_incident, incident_type,
		       parent_shipment_id, delivery_attempts, is_returning, final_branch_id, delivery_method,
		       price, price_breakdown, price_currency, reserved_for_trip_id, sla_notified_at, sla_expired_notified_at,
		       rejected_by_recipient, chatbot_metadata,
		       security_keyword, keyword_attempts, contingency_delivery
		FROM shipments WHERE `
	var statusCond string
	if filter.IncludeExpired {
		// Include non-expired + expired that haven't had PII purged yet
		statusCond = "(status != 'expired' OR (status = 'expired' AND pii_purged_at IS NULL))"
	} else {
		statusCond = "status != 'expired'"
	}
	query := selectCols + statusCond
	args := []interface{}{}
	i := 1
	if filter.ReceivingBranchID != "" {
		query += fmt.Sprintf(" AND (receiving_branch_id = $%d OR (status = 'in_transit' AND current_location = $%d))", i, i+1)
		args = append(args, filter.ReceivingBranchID, filter.ReceivingBranchID)
		i += 2
	}
	if filter.DateFrom != nil {
		query += fmt.Sprintf(" AND created_at >= $%d", i)
		args = append(args, *filter.DateFrom)
		i++
	}
	if filter.DateTo != nil {
		query += fmt.Sprintf(" AND created_at <= $%d", i)
		args = append(args, *filter.DateTo)
		i++
	}
	query += " ORDER BY tracking_id ASC"

	rows, err := p.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list, err := scanShipments(rows)
	if err != nil {
		return nil, err
	}
	now := clock.Now()
	for i := range list {
		list[i].IsDelayed = list[i].ComputeIsDelayed(now)
		list[i].IsAtRisk = list[i].ComputeIsAtRisk(now)
	}
	return list, nil
}

func (p *PostgresShipmentProjection) Search(query string) ([]model.Shipment, error) {
	q := "%" + strings.ToLower(query) + "%"
	rows, err := p.db.Query(`
		SELECT tracking_id, status, current_location, current_zone, weight_kg, package_type,
		       is_fragile, special_instructions, receiving_branch_id, origin_branch_id,
		       created_at, updated_at, estimated_delivery_at, delivered_at,
		       sender, recipient, corrections,
		       shipment_type, time_window,
		       priority, priority_score, priority_confidence, priority_factors,
		       has_incident, incident_type,
		       parent_shipment_id, delivery_attempts, is_returning, final_branch_id, delivery_method,
		       price, price_breakdown, price_currency, reserved_for_trip_id, sla_notified_at, sla_expired_notified_at,
		       rejected_by_recipient, chatbot_metadata,
		       security_keyword, keyword_attempts, contingency_delivery
		FROM shipments
		WHERE status != 'expired'
		  AND (   LOWER(tracking_id) LIKE $1
		       OR LOWER(sender->>'name') LIKE $1
		       OR LOWER(recipient->>'name') LIKE $1
		       OR LOWER(sender->'address'->>'city') LIKE $1
		       OR LOWER(recipient->'address'->>'city') LIKE $1)
		ORDER BY tracking_id ASC`, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list, err := scanShipments(rows)
	if err != nil {
		return nil, err
	}
	now := clock.Now()
	for i := range list {
		list[i].IsDelayed = list[i].ComputeIsDelayed(now)
		list[i].IsAtRisk = list[i].ComputeIsAtRisk(now)
	}
	return list, nil
}

func (p *PostgresShipmentProjection) Stats(filter model.ShipmentFilter) (model.Stats, error) {
	stats := model.Stats{
		ByStatus:       map[model.Status]int{},
		ByBranch:       map[string]int{},
		ByDay:          map[string]int{},
		ByDayDelivered: map[string]int{},
	}

	branchFilter := filter.ReceivingBranchID

	// Build WHERE clauses for totals queries — respect date range when provided.
	type whereBuilder struct {
		clauses []string
		args    []interface{}
		idx     int
	}
	wb := whereBuilder{idx: 1}

	wb.clauses = append(wb.clauses, "status != 'expired'")
	if branchFilter != "" {
		wb.clauses = append(wb.clauses, fmt.Sprintf("receiving_branch_id = $%d", wb.idx))
		wb.args = append(wb.args, branchFilter)
		wb.idx++
	}
	if filter.DateFrom != nil {
		wb.clauses = append(wb.clauses, fmt.Sprintf("created_at >= $%d", wb.idx))
		wb.args = append(wb.args, *filter.DateFrom)
		wb.idx++
	}
	if filter.DateTo != nil {
		wb.clauses = append(wb.clauses, fmt.Sprintf("created_at <= $%d", wb.idx))
		wb.args = append(wb.args, *filter.DateTo)
		wb.idx++
	}
	whereTotal := strings.Join(wb.clauses, " AND ")

	var (
		rows *sql.Rows
		err  error
	)
	rows, err = p.db.Query(`SELECT status, current_location, has_incident FROM shipments WHERE `+whereTotal, wb.args...)
	if err != nil {
		return model.Stats{}, err
	}
	defer rows.Close()

	totalDelivered := 0
	for rows.Next() {
		var status, location string
		var hasIncident bool
		if err := rows.Scan(&status, &location, &hasIncident); err != nil {
			return model.Stats{}, err
		}
		stats.Total++
		stats.ByStatus[model.Status(status)]++
		s := model.Status(status)
		if s != model.StatusDelivered && s != model.StatusReturned && location != "" {
			stats.ByBranch[location]++
		}
		if s == model.StatusDelivered {
			totalDelivered++
		}
		if hasIncident {
			stats.OpenIncidents++
		}
	}
	if err := rows.Err(); err != nil {
		return model.Stats{}, err
	}

	// Cycle time & success rate.
	if stats.Total > 0 {
		rate := (float64(totalDelivered) / float64(stats.Total)) * 100
		stats.SuccessRate = &rate
	}
	if totalDelivered > 0 {
		// Reuse the same date filter for cycle time query (filter on created_at).
		cycleClauses := []string{"status = 'delivered'", "delivered_at IS NOT NULL"}
		cycleArgs := []interface{}{}
		ci := 1
		if branchFilter != "" {
			cycleClauses = append(cycleClauses, fmt.Sprintf("receiving_branch_id = $%d", ci))
			cycleArgs = append(cycleArgs, branchFilter)
			ci++
		}
		if filter.DateFrom != nil {
			cycleClauses = append(cycleClauses, fmt.Sprintf("created_at >= $%d", ci))
			cycleArgs = append(cycleArgs, *filter.DateFrom)
			ci++
		}
		if filter.DateTo != nil {
			cycleClauses = append(cycleClauses, fmt.Sprintf("created_at <= $%d", ci))
			cycleArgs = append(cycleArgs, *filter.DateTo)
			ci++
		}
		row := p.db.QueryRow(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - created_at)) / 3600)::numeric, 2)::float8
			FROM shipments WHERE `+strings.Join(cycleClauses, " AND "), cycleArgs...)
		var avg float64
		if err := row.Scan(&avg); err == nil {
			stats.AvgCycleTimeHours = &avg
		}
	}

	// Recent shipments (last 5, no drafts, within date range when provided).
	recentClauses := []string{"status != 'expired'", "status != 'draft'"}
	recentArgs := []interface{}{}
	ri := 1
	if branchFilter != "" {
		recentClauses = append(recentClauses, fmt.Sprintf("receiving_branch_id = $%d", ri))
		recentArgs = append(recentArgs, branchFilter)
		ri++
	}
	if filter.DateFrom != nil {
		recentClauses = append(recentClauses, fmt.Sprintf("created_at >= $%d", ri))
		recentArgs = append(recentArgs, *filter.DateFrom)
		ri++
	}
	if filter.DateTo != nil {
		recentClauses = append(recentClauses, fmt.Sprintf("created_at <= $%d", ri))
		recentArgs = append(recentArgs, *filter.DateTo)
		ri++
	}
	recentRows, err := p.db.Query(`
		SELECT tracking_id, status, current_location, current_zone, weight_kg, package_type,
		       is_fragile, special_instructions, receiving_branch_id, origin_branch_id,
		       created_at, updated_at, estimated_delivery_at, delivered_at,
		       sender, recipient, corrections,
		       shipment_type, time_window,
		       priority, priority_score, priority_confidence, priority_factors,
		       has_incident, incident_type,
		       parent_shipment_id, delivery_attempts, is_returning, final_branch_id, delivery_method,
		       price, price_breakdown, price_currency, reserved_for_trip_id, sla_notified_at, sla_expired_notified_at,
		       rejected_by_recipient, chatbot_metadata,
		       security_keyword, keyword_attempts, contingency_delivery
		FROM shipments
		WHERE `+strings.Join(recentClauses, " AND ")+`
		ORDER BY created_at DESC LIMIT 5`, recentArgs...)
	if err != nil {
		return model.Stats{}, err
	}
	defer recentRows.Close()
	recent, err := scanShipments(recentRows)
	if err != nil {
		return model.Stats{}, err
	}
	stats.RecentShipments = recent

	// Pre-fill zeros for every day in the requested range.
	if filter.DateFrom != nil && filter.DateTo != nil {
		for d := filter.DateFrom.Truncate(24 * time.Hour); !d.After(*filter.DateTo); d = d.AddDate(0, 0, 1) {
			key := d.Format("2006-01-02")
			stats.ByDay[key] = 0
			stats.ByDayDelivered[key] = 0
		}

		var dayRows *sql.Rows
		if branchFilter != "" {
			dayRows, err = p.db.Query(`
				SELECT DATE(created_at)::text AS day, COUNT(*) AS cnt
				FROM shipments
				WHERE created_at >= $1 AND created_at <= $2 AND receiving_branch_id = $3
				GROUP BY DATE(created_at)`, *filter.DateFrom, *filter.DateTo, branchFilter)
		} else {
			dayRows, err = p.db.Query(`
				SELECT DATE(created_at)::text AS day, COUNT(*) AS cnt
				FROM shipments
				WHERE created_at >= $1 AND created_at <= $2
				GROUP BY DATE(created_at)`, *filter.DateFrom, *filter.DateTo)
		}
		if err != nil {
			return model.Stats{}, err
		}
		defer dayRows.Close()
		for dayRows.Next() {
			var day string
			var cnt int
			if err := dayRows.Scan(&day, &cnt); err != nil {
				return model.Stats{}, err
			}
			stats.ByDay[day] = cnt
		}
		if err := dayRows.Err(); err != nil {
			return model.Stats{}, err
		}

		var deliveredRows *sql.Rows
		if branchFilter != "" {
			deliveredRows, err = p.db.Query(`
				SELECT DATE(delivered_at)::text AS day, COUNT(*) AS cnt
				FROM shipments
				WHERE delivered_at >= $1 AND delivered_at <= $2 AND receiving_branch_id = $3
				GROUP BY DATE(delivered_at)`, *filter.DateFrom, *filter.DateTo, branchFilter)
		} else {
			deliveredRows, err = p.db.Query(`
				SELECT DATE(delivered_at)::text AS day, COUNT(*) AS cnt
				FROM shipments
				WHERE delivered_at >= $1 AND delivered_at <= $2
				GROUP BY DATE(delivered_at)`, *filter.DateFrom, *filter.DateTo)
		}
		if err != nil {
			return model.Stats{}, err
		}
		defer deliveredRows.Close()
		for deliveredRows.Next() {
			var day string
			var cnt int
			if err := deliveredRows.Scan(&day, &cnt); err != nil {
				return model.Stats{}, err
			}
			stats.ByDayDelivered[day] = cnt
		}
		if err := deliveredRows.Err(); err != nil {
			return model.Stats{}, err
		}
	}
	return stats, nil
}

// StatsDetail returns KPI breakdown by branch for drill-down.
func (p *PostgresShipmentProjection) StatsDetail(statusFilter string, dateFrom, dateTo *time.Time) (map[string]int, error) {
	args := []interface{}{}
	where := "status != 'expired'"
	i := 1

	if statusFilter != "" {
		where += fmt.Sprintf(" AND status = $%d", i)
		args = append(args, statusFilter)
		i++
	}
	if dateFrom != nil {
		where += fmt.Sprintf(" AND created_at >= $%d", i)
		args = append(args, *dateFrom)
		i++
	}
	if dateTo != nil {
		where += fmt.Sprintf(" AND created_at <= $%d", i)
		args = append(args, *dateTo)
		i++
	}

	query := fmt.Sprintf(`
		SELECT receiving_branch_id, COUNT(*) AS cnt
		FROM shipments
		WHERE %s AND receiving_branch_id != ''
		GROUP BY receiving_branch_id
		ORDER BY cnt DESC`, where)

	rows, err := p.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]int{}
	for rows.Next() {
		var branchID string
		var cnt int
		if err := rows.Scan(&branchID, &cnt); err != nil {
			return nil, err
		}
		result[branchID] = cnt
	}
	return result, rows.Err()
}

// CancellationStats returns cancellations grouped by day and reason.
func (p *PostgresShipmentProjection) CancellationStats(dateFrom, dateTo *time.Time, branchID string) (model.CancellationStats, error) {
	result := model.CancellationStats{
		ByDay:            map[string]int{},
		ReasonsBreakdown: map[string]int{},
	}

	// Default to last 30 days if no range specified.
	from := dateFrom
	to := dateTo
	now := time.Now()
	if from == nil {
		f := now.AddDate(0, 0, -30)
		from = &f
	}
	if to == nil {
		to = &now
	}

	// Pre-fill zeros for every day in the requested range.
	for d := from.Truncate(24 * time.Hour); !d.After(*to); d = d.AddDate(0, 0, 1) {
		result.ByDay[d.Format("2006-01-02")] = 0
	}

	// Query the events table for shipment_cancelled events,
	// joining with shipments to support branch filtering.
	whereBranch := ""
	args := []interface{}{}
	if branchID != "" {
		whereBranch = " AND s.receiving_branch_id = $3"
		args = append(args, branchID)
	}

	rows, err := p.db.Query(`
		SELECT DATE(e.timestamp)::text AS day,
		       e.payload->>'Reason' AS reason,
		       COUNT(*) AS cnt
		FROM events e
		JOIN shipments s ON s.tracking_id = e.tracking_id
		WHERE e.event_type = 'shipment_cancelled'
		  AND e.timestamp >= $1 AND e.timestamp <= $2`+whereBranch+`
		GROUP BY DATE(e.timestamp), e.payload->>'Reason'
		ORDER BY day`, append([]interface{}{*from, *to}, args...)...)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	for rows.Next() {
		var day, reason string
		var cnt int
		if err := rows.Scan(&day, &reason, &cnt); err != nil {
			return result, err
		}
		result.ByDay[day] += cnt
		result.ReasonsBreakdown[reason] += cnt
		result.Total += cnt
	}
	if err := rows.Err(); err != nil {
		return result, err
	}

	// Compute top reason.
	if result.Total > 0 {
		maxCount := 0
		for reason, count := range result.ReasonsBreakdown {
			if count > maxCount {
				maxCount = count
				result.TopReason = reason
			}
		}
		// If zero-fill days inflated the total, recount from reasons.
		computedTotal := 0
		for _, count := range result.ReasonsBreakdown {
			computedTotal += count
		}
		result.Total = computedTotal
	}

	return result, nil
}

// AvgTimePerStatus returns average hours spent in each status within the given date range.
func (p *PostgresShipmentProjection) AvgTimePerStatus(dateFrom, dateTo *time.Time) (model.AvgTimePerStatus, error) {
	from := dateFrom
	to := dateTo
	now := time.Now()
	if from == nil {
		f := now.AddDate(0, 0, -30)
		from = &f
	}
	if to == nil {
		to = &now
	}

	rows, err := p.db.Query(`
		WITH ordered AS (
			SELECT tracking_id,
			       e.payload->>'FromStatus' AS from_status,
			       e.timestamp,
			       LEAD(e.timestamp) OVER (PARTITION BY e.tracking_id ORDER BY e.timestamp ASC) AS next_ts
			FROM events e
			WHERE e.event_type = 'status_changed'
			  AND e.timestamp >= $1 AND e.timestamp <= $2
		)
		SELECT from_status,
		       COALESCE(AVG(EXTRACT(EPOCH FROM (next_ts - timestamp)) / 3600), 0) AS avg_hours
		FROM ordered
		WHERE next_ts IS NOT NULL
		  AND from_status != ''
		GROUP BY from_status
		ORDER BY avg_hours DESC`, *from, *to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result model.AvgTimePerStatus
	for rows.Next() {
		var status string
		var avgHours float64
		if err := rows.Scan(&status, &avgHours); err != nil {
			return nil, err
		}
		result = append(result, model.AvgTimePerStatusItem{
			Status:   model.Status(status),
			AvgHours: avgHours,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Mark the bottleneck (highest avg time).
	if len(result) > 0 {
		result[0].IsBottleneck = true
	}
	return result, nil
}

// CountActiveByBranch returns the number of non-terminal shipments assigned to a branch.
func (p *PostgresShipmentProjection) CountActiveByBranch(branchID string) int {
	var count int
	p.db.QueryRow(`
		SELECT COUNT(*) FROM shipments
		WHERE receiving_branch_id = $1
		  AND status NOT IN ('delivered', 'returned', 'cancelled', 'lost', 'destroyed', 'draft')`,
		branchID).Scan(&count)
	return count
}

// scanShipment scans a single row into a Shipment.
func scanShipment(row *sql.Row) (model.Shipment, error) {
	var (
		s                   model.Shipment
		status              string
		packageType         string
		shipmentType        string
		timeWindow          string
		incidentType        string
		deliveryMethod      string
		senderJSON          []byte
		recipientJSON       []byte
		correctionsJSON     []byte
		priorityFactorsJSON []byte
		estimatedAt         *time.Time
		price               sql.NullFloat64
		priceBreakdownJSON  []byte
		priceCurrency       string
		reservedForTripID    sql.NullString
		slaNotifiedAt        *time.Time
		slaExpiredNotifiedAt *time.Time
		chatbotMetadataJSON []byte
	)
	err := row.Scan(
		&s.TrackingID, &status, &s.CurrentLocation, &s.CurrentZone, &s.WeightKg, &packageType,
		&s.IsFragile, &s.SpecialInstructions, &s.ReceivingBranchID, &s.OriginBranchID,
		&s.CreatedAt, &s.UpdatedAt, &estimatedAt, &s.DeliveredAt,
		&senderJSON, &recipientJSON, &correctionsJSON,
		&shipmentType, &timeWindow,
		&s.Priority, &s.PriorityScore, &s.PriorityConfidence, &priorityFactorsJSON,
		&s.HasIncident, &incidentType,
		&s.ParentShipmentID, &s.DeliveryAttempts, &s.IsReturning, &s.FinalBranchID, &deliveryMethod,
		&price, &priceBreakdownJSON, &priceCurrency, &reservedForTripID, &slaNotifiedAt, &slaExpiredNotifiedAt,
		&s.RejectedByRecipient, &chatbotMetadataJSON,
		&s.SecurityKeyword, &s.KeywordAttempts, &s.ContingencyDelivery,
	)
	if err == sql.ErrNoRows {
		return model.Shipment{}, fmt.Errorf("shipment not found")
	}
	if err != nil {
		return model.Shipment{}, err
	}
	if reservedForTripID.Valid {
		s.ReservedForTripID = &reservedForTripID.String
	}
	s.SLANotifiedAt = slaNotifiedAt
	s.SLAExpiredNotifiedAt = slaExpiredNotifiedAt
	s.Status = model.Status(status)
	s.PackageType = model.PackageType(packageType)
	s.ShipmentType = model.ShipmentType(shipmentType)
	s.TimeWindow = model.TimeWindow(timeWindow)
	s.IncidentType = model.IncidentType(incidentType)
	s.DeliveryMethod = model.DeliveryMethod(deliveryMethod)
	s.EstimatedDeliveryAt = estimatedAt
	s.PriceCurrency = priceCurrency
	if price.Valid {
		v := price.Float64
		s.Price = &v
	}
	if len(priceBreakdownJSON) > 0 {
		var b model.PriceBreakdown
		if err := json.Unmarshal(priceBreakdownJSON, &b); err != nil {
			return model.Shipment{}, err
		}
		s.PriceBreakdown = &b
	}
	if err := json.Unmarshal(senderJSON, &s.Sender); err != nil {
		return model.Shipment{}, err
	}
	if err := json.Unmarshal(recipientJSON, &s.Recipient); err != nil {
		return model.Shipment{}, err
	}
	if len(correctionsJSON) > 0 {
		var c model.ShipmentCorrections
		if err := json.Unmarshal(correctionsJSON, &c); err != nil {
			return model.Shipment{}, err
		}
		s.Corrections = &c
	}
	if len(priorityFactorsJSON) > 0 {
		var f map[string]model.FactorDetail
		if err := json.Unmarshal(priorityFactorsJSON, &f); err != nil {
			return model.Shipment{}, err
		}
		s.PriorityFactors = f
	}
	if len(chatbotMetadataJSON) > 0 {
		var metadata model.ChatbotMetadata
		if err := json.Unmarshal(chatbotMetadataJSON, &metadata); err != nil {
			return model.Shipment{}, err
		}
		s.ChatbotMetadata = &metadata
	}
	return s, nil
}

func scanShipments(rows *sql.Rows) ([]model.Shipment, error) {
	var result []model.Shipment
	for rows.Next() {
		var (
			s                   model.Shipment
			status              string
			packageType         string
			shipmentType        string
			timeWindow          string
			incidentType        string
			deliveryMethod      string
			senderJSON          []byte
			recipientJSON       []byte
			correctionsJSON     []byte
			priorityFactorsJSON []byte
			estimatedAt         *time.Time
			price               sql.NullFloat64
			priceBreakdownJSON  []byte
			priceCurrency       string
			reservedForTripID    sql.NullString
			slaNotifiedAt        *time.Time
			slaExpiredNotifiedAt *time.Time
			chatbotMetadataJSON []byte
		)
		err := rows.Scan(
			&s.TrackingID, &status, &s.CurrentLocation, &s.CurrentZone, &s.WeightKg, &packageType,
			&s.IsFragile, &s.SpecialInstructions, &s.ReceivingBranchID, &s.OriginBranchID,
			&s.CreatedAt, &s.UpdatedAt, &estimatedAt, &s.DeliveredAt,
			&senderJSON, &recipientJSON, &correctionsJSON,
			&shipmentType, &timeWindow,
			&s.Priority, &s.PriorityScore, &s.PriorityConfidence, &priorityFactorsJSON,
			&s.HasIncident, &incidentType,
			&s.ParentShipmentID, &s.DeliveryAttempts, &s.IsReturning, &s.FinalBranchID, &deliveryMethod,
			&price, &priceBreakdownJSON, &priceCurrency, &reservedForTripID, &slaNotifiedAt, &slaExpiredNotifiedAt,
			&s.RejectedByRecipient, &chatbotMetadataJSON,
			&s.SecurityKeyword, &s.KeywordAttempts, &s.ContingencyDelivery,
		)
		if err != nil {
			return nil, err
		}
		if reservedForTripID.Valid {
			s.ReservedForTripID = &reservedForTripID.String
		}
		s.SLANotifiedAt = slaNotifiedAt
		s.SLAExpiredNotifiedAt = slaExpiredNotifiedAt
		s.Status = model.Status(status)
		s.PackageType = model.PackageType(packageType)
		s.ShipmentType = model.ShipmentType(shipmentType)
		s.TimeWindow = model.TimeWindow(timeWindow)
		s.IncidentType = model.IncidentType(incidentType)
		s.DeliveryMethod = model.DeliveryMethod(deliveryMethod)
		s.EstimatedDeliveryAt = estimatedAt
		s.PriceCurrency = priceCurrency
		if price.Valid {
			v := price.Float64
			s.Price = &v
		}
		if len(priceBreakdownJSON) > 0 {
			var b model.PriceBreakdown
			if err := json.Unmarshal(priceBreakdownJSON, &b); err != nil {
				return nil, err
			}
			s.PriceBreakdown = &b
		}
		if err := json.Unmarshal(senderJSON, &s.Sender); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(recipientJSON, &s.Recipient); err != nil {
			return nil, err
		}
		if len(correctionsJSON) > 0 {
			var c model.ShipmentCorrections
			if err := json.Unmarshal(correctionsJSON, &c); err != nil {
				return nil, err
			}
			s.Corrections = &c
		}
		if len(priorityFactorsJSON) > 0 {
			var f map[string]model.FactorDetail
			if err := json.Unmarshal(priorityFactorsJSON, &f); err != nil {
				return nil, err
			}
			s.PriorityFactors = f
		}

		if len(chatbotMetadataJSON) > 0 {
		var metadata model.ChatbotMetadata
		if err := json.Unmarshal(chatbotMetadataJSON, &metadata); err != nil {
			return nil, err
		}
		s.ChatbotMetadata = &metadata
	}
		result = append(result, s)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].TrackingID < result[j].TrackingID
	})

	
	return result, rows.Err()
}

func nullableTime(t *time.Time) interface{} {
	if t == nil || t.IsZero() {
		return nil
	}
	return *t
}

func nullableBytes(b []byte) interface{} {
	if b == nil {
		return nil
	}
	return b
}

func nullableFloat(f *float64) interface{} {
	if f == nil {
		return nil
	}
	return *f
}

// ReserveForTrip marca el envío como reservado para un trip multi-hop.
// Atómico: solo reserva si el envío no está ya reservado.
func (p *PostgresShipmentProjection) ReserveForTrip(trackingID, tripID string) error {
	_, err := p.db.Exec(
		`UPDATE shipments SET reserved_for_trip_id = $1 WHERE tracking_id = $2 AND reserved_for_trip_id IS NULL`,
		tripID, trackingID,
	)
	return err
}

// ReleaseFromTrip libera la reserva del envío.
func (p *PostgresShipmentProjection) ReleaseFromTrip(trackingID string) error {
	_, err := p.db.Exec(
		`UPDATE shipments SET reserved_for_trip_id = NULL WHERE tracking_id = $1`,
		trackingID,
	)
	return err
}

// SetSLANotified actualiza sla_notified_at del envío (nil = resetear, &t = marcar notificado).
func (p *PostgresShipmentProjection) SetSLANotified(trackingID string, notifiedAt *time.Time) error {
	_, err := p.db.Exec(
		`UPDATE shipments SET sla_notified_at = $1 WHERE tracking_id = $2`,
		notifiedAt, trackingID,
	)
	return err
}

// SetSLAExpiredNotified actualiza sla_expired_notified_at del envío.
func (p *PostgresShipmentProjection) SetSLAExpiredNotified(trackingID string, notifiedAt *time.Time) error {
	_, err := p.db.Exec(
		`UPDATE shipments SET sla_expired_notified_at = $1 WHERE tracking_id = $2`,
		notifiedAt, trackingID,
	)
	return err
}

// SetConfirmationEmailSent marca el envío como notificado por email de forma atómica (CA-05).
// Solo actualiza si confirmation_email_sent_at aún es NULL. Devuelve true si fue el primer
// llamado para ese tracking ID (el UPDATE afectó una fila), false si ya estaba marcado.
func (p *PostgresShipmentProjection) SetConfirmationEmailSent(trackingID string) (bool, error) {
	res, err := p.db.Exec(
		`UPDATE shipments SET confirmation_email_sent_at = NOW() WHERE tracking_id = $1 AND confirmation_email_sent_at IS NULL`,
		trackingID,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
// serializeChatbotMetadata serializa ChatbotMetadata a JSON
func serializeChatbotMetadata(metadata *model.ChatbotMetadata) interface{} {
	if metadata == nil {
		return nil
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		return nil
	}
	return data
}
