package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type ShipmentService struct {
	repo         repository.ShipmentRepository
	branchRepo   repository.BranchRepository
	customerRepo repository.CustomerRepository
}

func NewShipmentService(repo repository.ShipmentRepository, branchRepo repository.BranchRepository, customerRepo repository.CustomerRepository) *ShipmentService {
	return &ShipmentService{repo: repo, branchRepo: branchRepo, customerRepo: customerRepo}
}

func (s *ShipmentService) upsertParties(shipment model.Shipment) {
	if shipment.SenderDNI != "" {
		s.customerRepo.Upsert(model.Customer{
			DNI:     shipment.SenderDNI,
			Name:    shipment.SenderName,
			Phone:   shipment.SenderPhone,
			Email:   shipment.SenderEmail,
			Address: shipment.Origin,
		})
	}
	if shipment.RecipientDNI != "" {
		s.customerRepo.Upsert(model.Customer{
			DNI:     shipment.RecipientDNI,
			Name:    shipment.RecipientName,
			Phone:   shipment.RecipientPhone,
			Email:   shipment.RecipientEmail,
			Address: shipment.Destination,
		})
	}
}

func (s *ShipmentService) Create(req model.CreateShipmentRequest) (model.Shipment, error) {
	if strings.TrimSpace(req.Origin.City) == "" || strings.TrimSpace(req.Origin.Province) == "" {
		return model.Shipment{}, fmt.Errorf("origin city and province are required")
	}
	if strings.TrimSpace(req.Destination.City) == "" || strings.TrimSpace(req.Destination.Province) == "" {
		return model.Shipment{}, fmt.Errorf("destination city and province are required")
	}
	now := time.Now().UTC()
	currentLocation := req.Origin.City
	if b, ok := s.branchRepo.GetByID(req.ReceivingBranchID); ok {
		currentLocation = b.City
	}
	shipment := model.Shipment{
		TrackingID:          generateTrackingID(),
		SenderName:          req.SenderName,
		SenderPhone:         req.SenderPhone,
		SenderEmail:         req.SenderEmail,
		SenderDNI:           req.SenderDNI,
		Origin:              req.Origin,
		RecipientName:       req.RecipientName,
		RecipientPhone:      req.RecipientPhone,
		RecipientEmail:      req.RecipientEmail,
		RecipientDNI:        req.RecipientDNI,
		Destination:         req.Destination,
		WeightKg:            req.WeightKg,
		PackageType:         req.PackageType,
		SpecialInstructions: req.SpecialInstructions,
		ReceivingBranchID:   req.ReceivingBranchID,
		Status:              model.StatusInProgress,
		CurrentLocation:     currentLocation,
		CreatedAt:           now,
		EstimatedDeliveryAt: now.AddDate(0, 0, 7),
	}
	created, err := s.repo.Create(shipment)
	if err != nil {
		return model.Shipment{}, err
	}
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: created.TrackingID,
		FromStatus: "",
		ToStatus:   model.StatusInProgress,
		ChangedBy:  req.CreatedBy,
		Notes:      "Shipment created",
		Timestamp:  now,
	}
	_ = s.repo.AddEvent(event)
	s.upsertParties(created)
	return created, nil
}

func (s *ShipmentService) SaveDraft(req model.SaveDraftRequest) (model.Shipment, error) {
	now := time.Now().UTC()
	currentLocation := req.Origin.City
	if b, ok := s.branchRepo.GetByID(req.ReceivingBranchID); ok {
		currentLocation = b.City
	}
	shipment := model.Shipment{
		TrackingID:          generateDraftID(),
		SenderName:          req.SenderName,
		SenderPhone:         req.SenderPhone,
		SenderEmail:         req.SenderEmail,
		SenderDNI:           req.SenderDNI,
		Origin:              req.Origin,
		RecipientName:       req.RecipientName,
		RecipientPhone:      req.RecipientPhone,
		RecipientEmail:      req.RecipientEmail,
		RecipientDNI:        req.RecipientDNI,
		Destination:         req.Destination,
		WeightKg:            req.WeightKg,
		PackageType:         req.PackageType,
		SpecialInstructions: req.SpecialInstructions,
		ReceivingBranchID:   req.ReceivingBranchID,
		Status:              model.StatusPending,
		CurrentLocation:     currentLocation,
		CreatedAt:           now,
		EstimatedDeliveryAt: now.AddDate(0, 0, 7),
	}
	created, err := s.repo.Create(shipment)
	if err != nil {
		return model.Shipment{}, err
	}
	return created, nil
}

func (s *ShipmentService) UpdateDraft(draftID string, req model.SaveDraftRequest) (model.Shipment, error) {
	existing, err := s.repo.GetByTrackingID(draftID)
	if err != nil {
		return model.Shipment{}, err
	}
	if existing.Status != model.StatusPending {
		return model.Shipment{}, fmt.Errorf("only draft shipments can be updated")
	}
	existing.SenderName = req.SenderName
	existing.SenderPhone = req.SenderPhone
	existing.SenderEmail = req.SenderEmail
	existing.SenderDNI = req.SenderDNI
	existing.Origin = req.Origin
	existing.RecipientName = req.RecipientName
	existing.RecipientPhone = req.RecipientPhone
	existing.RecipientEmail = req.RecipientEmail
	existing.RecipientDNI = req.RecipientDNI
	existing.Destination = req.Destination
	existing.WeightKg = req.WeightKg
	existing.PackageType = req.PackageType
	existing.SpecialInstructions = req.SpecialInstructions
	existing.ReceivingBranchID = req.ReceivingBranchID
	if req.Origin.City != "" {
		existing.CurrentLocation = req.Origin.City
	}
	return s.repo.UpdateDraft(existing)
}

func (s *ShipmentService) ConfirmDraft(draftID string, changedBy string) (model.Shipment, error) {
	draft, err := s.repo.GetByTrackingID(draftID)
	if err != nil {
		return model.Shipment{}, err
	}
	if draft.Status != model.StatusPending {
		return model.Shipment{}, fmt.Errorf("only draft shipments can be confirmed")
	}
	// Validate required fields
	missing := []string{}
	if strings.TrimSpace(draft.SenderName) == "" {
		missing = append(missing, "sender name")
	}
	if strings.TrimSpace(draft.SenderPhone) == "" {
		missing = append(missing, "sender phone")
	}
	if strings.TrimSpace(draft.Origin.City) == "" || strings.TrimSpace(draft.Origin.Province) == "" {
		missing = append(missing, "origin city/province")
	}
	if strings.TrimSpace(draft.RecipientName) == "" {
		missing = append(missing, "recipient name")
	}
	if strings.TrimSpace(draft.RecipientPhone) == "" {
		missing = append(missing, "recipient phone")
	}
	if strings.TrimSpace(draft.Destination.City) == "" || strings.TrimSpace(draft.Destination.Province) == "" {
		missing = append(missing, "destination city/province")
	}
	if draft.WeightKg <= 0 {
		missing = append(missing, "weight")
	}
	if strings.TrimSpace(string(draft.PackageType)) == "" {
		missing = append(missing, "package type")
	}
	if strings.TrimSpace(draft.SenderDNI) == "" {
		missing = append(missing, "sender DNI")
	}
	if strings.TrimSpace(draft.RecipientDNI) == "" {
		missing = append(missing, "recipient DNI")
	}
	if len(missing) > 0 {
		return model.Shipment{}, fmt.Errorf("missing required fields: %s", strings.Join(missing, ", "))
	}
	trackingID := generateTrackingID()
	confirmed, err := s.repo.ConfirmShipment(draftID, trackingID, model.StatusInProgress)
	if err != nil {
		return model.Shipment{}, err
	}
	now := time.Now().UTC()
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: trackingID,
		FromStatus: model.StatusPending,
		ToStatus:   model.StatusInProgress,
		ChangedBy:  changedBy,
		Notes:      "Shipment confirmed",
		Timestamp:  now,
	}
	_ = s.repo.AddEvent(event)
	s.upsertParties(confirmed)
	return confirmed, nil
}

func (s *ShipmentService) UpdateStatus(trackingID string, req model.UpdateStatusRequest) (model.Shipment, error) {
	if req.Status == model.StatusDeliveryFailed && strings.TrimSpace(req.Notes) == "" {
		return model.Shipment{}, fmt.Errorf("notes are required for delivery_failed")
	}
	if req.Status == model.StatusDelivering && strings.TrimSpace(req.DriverID) == "" {
		return model.Shipment{}, fmt.Errorf("driver_id is required when moving to delivering")
	}
	current, err := s.repo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Shipment{}, err
	}
	if !isValidTransition(current.Status, req.Status) {
		return model.Shipment{}, fmt.Errorf("invalid transition: %s → %s", current.Status, req.Status)
	}
	// Validate returned: sender DNI must match (corrections take precedence)
	if req.Status == model.StatusReturned {
		if strings.TrimSpace(req.SenderDNI) == "" {
			return model.Shipment{}, fmt.Errorf("sender_dni is required for returned")
		}
		expectedSenderDNI := current.SenderDNI
		if corrected, ok := current.Corrections["sender_dni"]; ok {
			expectedSenderDNI = corrected
		}
		if expectedSenderDNI != req.SenderDNI {
			return model.Shipment{}, fmt.Errorf("El DNI no coincide con el del remitente esperado")
		}
	}
	// Validate ready_for_return: only allowed when shipment is back at its origin branch
	if req.Status == model.StatusReadyForReturn {
		if b, ok := s.branchRepo.GetByID(current.ReceivingBranchID); ok {
			if current.CurrentLocation != b.City {
				return model.Shipment{}, fmt.Errorf("el envío no está en la sucursal de origen (%s) — retiro por remitente no aplica en esta sucursal", b.City)
			}
		}
	}
	// Validate DNI before touching the repository (corrections take precedence)
	if req.Status == model.StatusDelivered {
		if strings.TrimSpace(req.RecipientDNI) == "" {
			return model.Shipment{}, fmt.Errorf("recipient_dni is required for delivery")
		}
		expectedRecipientDNI := current.RecipientDNI
		if corrected, ok := current.Corrections["recipient_dni"]; ok {
			expectedRecipientDNI = corrected
		}
		if expectedRecipientDNI != req.RecipientDNI {
			return model.Shipment{}, fmt.Errorf("El DNI no coincide con el del destinatario esperado")
		}
	}
	updated, err := s.repo.UpdateStatus(trackingID, req.Status)
	if err != nil {
		return model.Shipment{}, err
	}
	now := time.Now().UTC()
	// When arriving at_branch from in_transit, auto-derive the location from the last in_transit event
	if req.Status == model.StatusAtBranch && current.Status == model.StatusInTransit {
		events, _ := s.repo.GetEvents(trackingID)
		for i := len(events) - 1; i >= 0; i-- {
			if events[i].ToStatus == model.StatusInTransit {
				req.Location = events[i].Location
				break
			}
		}
	}
	// When returning at_branch from delivery_failed, auto-derive the location from the last at_branch event
	if req.Status == model.StatusAtBranch && current.Status == model.StatusDeliveryFailed {
		events, _ := s.repo.GetEvents(trackingID)
		for i := len(events) - 1; i >= 0; i-- {
			if events[i].ToStatus == model.StatusAtBranch {
				req.Location = events[i].Location
				break
			}
		}
	}
	if req.Status != model.StatusDelivered && req.Location != "" {
		_ = s.repo.UpdateLocation(trackingID, req.Location)
		updated.CurrentLocation = req.Location
	}
	if req.Status == model.StatusDelivered {
		if err := s.repo.SetDeliveredAt(trackingID, now); err != nil {
			return model.Shipment{}, err
		}
		updated.DeliveredAt = &now
	}
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: trackingID,
		FromStatus: current.Status,
		ToStatus:   req.Status,
		ChangedBy:  req.ChangedBy,
		Location:   req.Location,
		Notes:      req.Notes,
		Timestamp:  now,
	}
	_ = s.repo.AddEvent(event)
	return updated, nil
}

// correctableFields maps a correction key to its human-readable label used in auto-comments.
var correctableFields = map[string]string{
	"sender_name":             "Nombre remitente",
	"sender_phone":            "Teléfono remitente",
	"sender_email":            "Email remitente",
	"sender_dni":              "DNI remitente",
	"origin_street":           "Dirección origen (calle)",
	"origin_city":             "Ciudad origen",
	"origin_province":         "Provincia origen",
	"origin_postal_code":      "Código postal origen",
	"recipient_name":          "Nombre destinatario",
	"recipient_phone":         "Teléfono destinatario",
	"recipient_email":         "Email destinatario",
	"recipient_dni":           "DNI destinatario",
	"destination_street":      "Dirección destino (calle)",
	"destination_city":        "Ciudad destino",
	"destination_province":    "Provincia destino",
	"destination_postal_code": "Código postal destino",
	"weight_kg":               "Peso (kg)",
	"package_type":            "Tipo de paquete",
	"special_instructions":    "Instrucciones especiales",
}

// CorrectShipment stores field corrections without modifying original data.
// Returns the updated shipment and a slice of comment bodies (one per corrected field)
// that the caller should persist via the comment service.
func (s *ShipmentService) CorrectShipment(trackingID, username string, req model.CorrectShipmentRequest) (model.Shipment, []string, error) {
	if len(req.Corrections) == 0 {
		return model.Shipment{}, nil, fmt.Errorf("no corrections provided")
	}
	shipment, err := s.repo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Shipment{}, nil, err
	}
	if shipment.Status == model.StatusPending {
		return model.Shipment{}, nil, fmt.Errorf("los borradores se editan directamente")
	}
	if shipment.Status == model.StatusDelivered || shipment.Status == model.StatusReturned {
		return model.Shipment{}, nil, fmt.Errorf("no se pueden corregir envíos finalizados")
	}
	for k := range req.Corrections {
		if _, ok := correctableFields[k]; !ok {
			return model.Shipment{}, nil, fmt.Errorf("campo no permitido: %s", k)
		}
	}
	updated, err := s.repo.ApplyCorrections(trackingID, req.Corrections)
	if err != nil {
		return model.Shipment{}, nil, err
	}
	now := time.Now().UTC()
	event := model.ShipmentEvent{
		ID:         uuid.NewString(),
		TrackingID: trackingID,
		EventType:  "edited",
		FromStatus: shipment.Status,
		ToStatus:   shipment.Status,
		ChangedBy:  username,
		Notes:      fmt.Sprintf("Corrección de datos: %d campo(s) modificado(s)", len(req.Corrections)),
		Timestamp:  now,
	}
	_ = s.repo.AddEvent(event)
	commentBodies := make([]string, 0, len(req.Corrections))
	for k, v := range req.Corrections {
		label := correctableFields[k]
		commentBodies = append(commentBodies, fmt.Sprintf("[Corrección] %s. Nuevo valor: %s", label, v))
	}
	return updated, commentBodies, nil
}

func (s *ShipmentService) GetByTrackingID(trackingID string) (model.Shipment, error) {
	return s.repo.GetByTrackingID(trackingID)
}

func (s *ShipmentService) List(filter model.ShipmentFilter) ([]model.Shipment, error) {
	return s.repo.List(filter)
}

func (s *ShipmentService) Search(query string) ([]model.Shipment, error) {
	if strings.TrimSpace(query) == "" {
		return s.repo.List(model.ShipmentFilter{})
	}
	return s.repo.Search(query)
}

func (s *ShipmentService) GetEvents(trackingID string) ([]model.ShipmentEvent, error) {
	return s.repo.GetEvents(trackingID)
}

func (s *ShipmentService) Stats() (model.Stats, error) {
	return s.repo.Stats()
}

func generateTrackingID() string {
	id := uuid.New().String()
	return fmt.Sprintf("LT-%s", strings.ToUpper(id[:8]))
}

func generateDraftID() string {
	id := uuid.New().String()
	return fmt.Sprintf("DRAFT-%s", strings.ToUpper(id[:8]))
}

func isValidTransition(from, to model.Status) bool {
	allowed := map[model.Status][]model.Status{
		model.StatusPending:        {},                      // drafts transition via ConfirmDraft, not UpdateStatus
		model.StatusInProgress:     {model.StatusInTransit}, // confirmed → start transit
		model.StatusInTransit:      {model.StatusAtBranch},
		model.StatusAtBranch:       {model.StatusInTransit, model.StatusDelivering, model.StatusReadyForPickup, model.StatusReadyForReturn},
		model.StatusDelivering:     {model.StatusDelivered, model.StatusDeliveryFailed},
		model.StatusDeliveryFailed: {model.StatusDelivering, model.StatusAtBranch},
		model.StatusDelivered:      {},
		model.StatusReadyForPickup: {model.StatusDelivered, model.StatusInTransit},
		model.StatusReadyForReturn: {model.StatusReturned},
		model.StatusReturned:       {},
	}
	for _, s := range allowed[from] {
		if s == to {
			return true
		}
	}
	return false
}
