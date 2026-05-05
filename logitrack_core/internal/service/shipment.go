package service

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// SystemConfigProvider is a minimal interface for reading system config in the shipment service.
type SystemConfigProvider interface {
	Get() model.SystemConfig
}

var (
	reDNI   = regexp.MustCompile(`^\d+$`)
	reEmail = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
	reName  = regexp.MustCompile(`^[a-zA-ZÀ-ÖØ-öø-ÿñÑ\s'\-]+$`)
)

func validateDNI(dni, field string) error {
	if !reDNI.MatchString(dni) {
		return fmt.Errorf("%s debe contener solo dígitos", field)
	}
	if len(dni) < 7 {
		return fmt.Errorf("%s debe tener al menos 7 dígitos", field)
	}
	return nil
}

func validateEmail(email, field string) error {
	if !reEmail.MatchString(email) {
		return fmt.Errorf("%s no es una dirección de email válida", field)
	}
	return nil
}

func validateName(name, field string) error {
	if name == "" {
		return nil
	}
	if !reName.MatchString(name) {
		return fmt.Errorf("%s no puede contener números ni caracteres especiales", field)
	}
	return nil
}

type ShipmentService struct {
	repo         repository.ShipmentRepository
	branchRepo   repository.BranchRepository
	customerRepo repository.CustomerRepository
	commentSvc   *CommentService
	mlClient     *MLService
	sysConfig    SystemConfigProvider
}

func NewShipmentService(
	repo repository.ShipmentRepository,
	branchRepo repository.BranchRepository,
	customerRepo repository.CustomerRepository,
	commentSvc *CommentService,
	mlClient *MLService,
) *ShipmentService {
	return &ShipmentService{repo: repo, branchRepo: branchRepo, customerRepo: customerRepo, commentSvc: commentSvc, mlClient: mlClient}
}

func (s *ShipmentService) SetSystemConfig(cfg SystemConfigProvider) {
	s.sysConfig = cfg
}

func (s *ShipmentService) maxDeliveryAttempts() int {
	if s.sysConfig != nil {
		return s.sysConfig.Get().MaxDeliveryAttempts
	}
	return 3
}

func (s *ShipmentService) upsertParties(shipment model.Shipment) {
	if shipment.Sender.DNI != "" {
		s.customerRepo.Upsert(shipment.Sender)
	}
	if shipment.Recipient.DNI != "" {
		s.customerRepo.Upsert(shipment.Recipient)
	}
}

// locationToBranchID converts a city string (from API requests) to a branch ID.
// Falls back to the city string itself if no branch is found.
func (s *ShipmentService) locationToBranchID(city string) string {
	if b, ok := s.branchRepo.GetByCity(city); ok {
		return b.ID
	}
	return city
}

func (s *ShipmentService) Create(req model.CreateShipmentRequest) (model.Shipment, error) {
	if strings.TrimSpace(req.Sender.Address.City) == "" || strings.TrimSpace(req.Sender.Address.Province) == "" {
		return model.Shipment{}, fmt.Errorf("la ciudad y provincia de origen son obligatorias")
	}
	if strings.TrimSpace(req.Recipient.Address.City) == "" || strings.TrimSpace(req.Recipient.Address.Province) == "" {
		return model.Shipment{}, fmt.Errorf("la ciudad y provincia de destino son obligatorias")
	}
	if req.ReceivingBranchID != "" {
		if b, ok := s.branchRepo.GetByID(req.ReceivingBranchID); ok && b.Status == model.BranchStatusOutOfService {
			return model.Shipment{}, fmt.Errorf("la sucursal '%s' está fuera de servicio y no puede recibir envíos", b.Name)
		}
	}
	if err := validateDNI(req.Sender.DNI, "sender_dni"); err != nil {
		return model.Shipment{}, err
	}
	if err := validateDNI(req.Recipient.DNI, "recipient_dni"); err != nil {
		return model.Shipment{}, err
	}
	if err := validateName(req.Sender.Name, "El nombre del remitente"); err != nil {
		return model.Shipment{}, err
	}
	if err := validateName(req.Recipient.Name, "El nombre del destinatario"); err != nil {
		return model.Shipment{}, err
	}
	if req.Sender.Email != "" {
		if err := validateEmail(req.Sender.Email, "sender_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Recipient.Email != "" {
		if err := validateEmail(req.Recipient.Email, "recipient_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	now := time.Now().UTC()
	currentLocation := s.locationToBranchID(req.Sender.Address.City)
	if b, ok := s.branchRepo.GetByID(req.ReceivingBranchID); ok {
		currentLocation = b.ID
	}

	// Default values for optional fields
	shipmentType := req.ShipmentType
	if shipmentType == "" {
		shipmentType = model.ShipmentTypeNormal
	}
	timeWindow := req.TimeWindow
	if timeWindow == "" {
		timeWindow = model.TimeWindowFlexible
	}

	var prediction *model.PriorityPrediction
	if s.mlClient != nil {
		prediction = s.mlClient.PredictFromCreateRequest(req)
	}

	shipment := model.Shipment{
		TrackingID:          generateTrackingID(),
		Sender:              req.Sender,
		Recipient:           req.Recipient,
		WeightKg:            req.WeightKg,
		PackageType:         req.PackageType,
		IsFragile:           req.IsFragile,
		SpecialInstructions: req.SpecialInstructions,
		ShipmentType:        shipmentType,
		TimeWindow:          timeWindow,
		ColdChain:           req.ColdChain,
		ReceivingBranchID:   req.ReceivingBranchID,
		OriginBranchID:      req.ReceivingBranchID,
		Status:              model.StatusAtOriginHub,
		CurrentLocation:     currentLocation,
		CreatedAt:           now,
		UpdatedAt:           now,
		EstimatedDeliveryAt: now.AddDate(0, 0, 7),
	}
	setPriority(&shipment, prediction)
	created, err := s.repo.Create(repository.CreateShipmentCmd{
		Shipment:  shipment,
		ChangedBy: req.CreatedBy,
		Notes:     "Shipment created",
	})
	if err != nil {
		return model.Shipment{}, err
	}
	s.upsertParties(created)
	return created, nil
}

func (s *ShipmentService) SaveDraft(req model.SaveDraftRequest) (model.Shipment, error) {
	if req.Sender.DNI != "" {
		if err := validateDNI(req.Sender.DNI, "sender_dni"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Recipient.DNI != "" {
		if err := validateDNI(req.Recipient.DNI, "recipient_dni"); err != nil {
			return model.Shipment{}, err
		}
	}
	if err := validateName(req.Sender.Name, "El nombre del remitente"); err != nil {
		return model.Shipment{}, err
	}
	if err := validateName(req.Recipient.Name, "El nombre del destinatario"); err != nil {
		return model.Shipment{}, err
	}
	if req.Sender.Email != "" {
		if err := validateEmail(req.Sender.Email, "sender_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Recipient.Email != "" {
		if err := validateEmail(req.Recipient.Email, "recipient_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	now := time.Now().UTC()
	currentLocation := s.locationToBranchID(req.Sender.Address.City)
	if b, ok := s.branchRepo.GetByID(req.ReceivingBranchID); ok {
		currentLocation = b.ID
	}

	// Default values for optional fields
	shipmentType := req.ShipmentType
	if shipmentType == "" {
		shipmentType = model.ShipmentTypeNormal
	}
	timeWindow := req.TimeWindow
	if timeWindow == "" {
		timeWindow = model.TimeWindowFlexible
	}

	var weightKg float64
	if req.WeightKg != nil {
		weightKg = *req.WeightKg
	}
	shipment := model.Shipment{
		TrackingID:          generateDraftID(),
		Sender:              req.Sender,
		Recipient:           req.Recipient,
		WeightKg:            weightKg,
		PackageType:         req.PackageType,
		IsFragile:           req.IsFragile,
		SpecialInstructions: req.SpecialInstructions,
		ShipmentType:        shipmentType,
		TimeWindow:          timeWindow,
		ColdChain:           req.ColdChain,
		ReceivingBranchID:   req.ReceivingBranchID,
		OriginBranchID:      req.ReceivingBranchID,
		Status:              model.StatusDraft,
		CurrentLocation:     currentLocation,
		CreatedAt:           now,
		UpdatedAt:           now,
		EstimatedDeliveryAt: now.AddDate(0, 0, 7),
	}
	return s.repo.SaveDraft(repository.SaveDraftCmd{Shipment: shipment})
}

func (s *ShipmentService) UpdateDraft(draftID string, req model.SaveDraftRequest) (model.Shipment, error) {
	if req.Sender.DNI != "" {
		if err := validateDNI(req.Sender.DNI, "sender_dni"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Recipient.DNI != "" {
		if err := validateDNI(req.Recipient.DNI, "recipient_dni"); err != nil {
			return model.Shipment{}, err
		}
	}
	if err := validateName(req.Sender.Name, "El nombre del remitente"); err != nil {
		return model.Shipment{}, err
	}
	if err := validateName(req.Recipient.Name, "El nombre del destinatario"); err != nil {
		return model.Shipment{}, err
	}
	if req.Sender.Email != "" {
		if err := validateEmail(req.Sender.Email, "sender_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Recipient.Email != "" {
		if err := validateEmail(req.Recipient.Email, "recipient_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	existing, err := s.repo.GetByTrackingID(draftID)
	if err != nil {
		return model.Shipment{}, err
	}
	if existing.Status != model.StatusDraft {
		return model.Shipment{}, fmt.Errorf("solo se pueden actualizar envíos en borrador")
	}
	existing.Sender = req.Sender
	existing.Recipient = req.Recipient
	if req.WeightKg != nil {
		existing.WeightKg = *req.WeightKg
	} else {
		existing.WeightKg = 0
	}
	existing.PackageType = req.PackageType
	existing.IsFragile = req.IsFragile
	existing.SpecialInstructions = req.SpecialInstructions
	existing.ShipmentType = req.ShipmentType
	existing.TimeWindow = req.TimeWindow
	existing.ColdChain = req.ColdChain
	existing.ReceivingBranchID = req.ReceivingBranchID
	existing.UpdatedAt = time.Now().UTC()
	// Prefer branch ID derived from receiving branch; fall back to origin city lookup.
	if req.ReceivingBranchID != "" {
		if b, ok := s.branchRepo.GetByID(req.ReceivingBranchID); ok {
			existing.CurrentLocation = b.ID
		}
	} else if req.Sender.Address.City != "" {
		existing.CurrentLocation = s.locationToBranchID(req.Sender.Address.City)
	}
	return s.repo.UpdateDraft(repository.UpdateDraftCmd{Shipment: existing})
}

func (s *ShipmentService) ConfirmDraft(draftID string, changedBy string) (model.Shipment, error) {
	draft, err := s.repo.GetByTrackingID(draftID)
	if err != nil {
		return model.Shipment{}, err
	}
	if draft.Status != model.StatusDraft {
		return model.Shipment{}, fmt.Errorf("solo se pueden confirmar envíos en borrador")
	}
	// Validate required fields
	missing := []string{}
	if strings.TrimSpace(draft.Sender.Name) == "" {
		missing = append(missing, "sender name")
	}
	if strings.TrimSpace(draft.Sender.Phone) == "" {
		missing = append(missing, "sender phone")
	}
	if strings.TrimSpace(draft.Sender.Address.City) == "" || strings.TrimSpace(draft.Sender.Address.Province) == "" {
		missing = append(missing, "origin city/province")
	}
	if strings.TrimSpace(draft.Recipient.Name) == "" {
		missing = append(missing, "recipient name")
	}
	if strings.TrimSpace(draft.Recipient.Phone) == "" {
		missing = append(missing, "recipient phone")
	}
	if strings.TrimSpace(draft.Recipient.Address.City) == "" || strings.TrimSpace(draft.Recipient.Address.Province) == "" {
		missing = append(missing, "destination city/province")
	}
	if draft.WeightKg <= 0 {
		missing = append(missing, "weight")
	}
	if strings.TrimSpace(string(draft.PackageType)) == "" {
		missing = append(missing, "package type")
	}
	if strings.TrimSpace(draft.Sender.DNI) == "" {
		missing = append(missing, "sender DNI")
	}
	if strings.TrimSpace(draft.Recipient.DNI) == "" {
		missing = append(missing, "recipient DNI")
	}
	if len(missing) > 0 {
		return model.Shipment{}, fmt.Errorf("faltan campos obligatorios: %s", strings.Join(missing, ", "))
	}
	if err := validateDNI(draft.Sender.DNI, "sender_dni"); err != nil {
		return model.Shipment{}, err
	}
	if err := validateDNI(draft.Recipient.DNI, "recipient_dni"); err != nil {
		return model.Shipment{}, err
	}
	if draft.Sender.Email != "" {
		if err := validateEmail(draft.Sender.Email, "sender_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if draft.Recipient.Email != "" {
		if err := validateEmail(draft.Recipient.Email, "recipient_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if draft.ReceivingBranchID != "" {
		if b, ok := s.branchRepo.GetByID(draft.ReceivingBranchID); ok && b.Status == model.BranchStatusOutOfService {
			return model.Shipment{}, fmt.Errorf("la sucursal '%s' está fuera de servicio y no puede recibir envíos", b.Name)
		}
	}
	var prediction *model.PriorityPrediction
	if s.mlClient != nil {
		prediction = s.mlClient.PredictFromShipment(draft)
	}
	confirmed, err := s.repo.ConfirmDraft(repository.ConfirmDraftCmd{
		DraftID:       draftID,
		NewTrackingID: generateTrackingID(),
		ChangedBy:     changedBy,
		Notes:         "Shipment confirmed",
		Timestamp:     time.Now().UTC(),
		Prediction:    prediction,
	})
	if err != nil {
		return model.Shipment{}, err
	}
	setPriority(&confirmed, prediction)

	s.upsertParties(confirmed)
	return confirmed, nil
}

func (s *ShipmentService) UpdateStatus(trackingID string, req model.UpdateStatusRequest) (model.Shipment, error) {
	if req.Status == model.StatusDeliveryFailed && strings.TrimSpace(req.Notes) == "" {
		return model.Shipment{}, fmt.Errorf("las notas son obligatorias para fallo de entrega")
	}
	if req.Status == model.StatusOutForDelivery && strings.TrimSpace(req.DriverID) == "" {
		return model.Shipment{}, fmt.Errorf("el driver_id es obligatorio al pasar a estado de reparto")
	}
	current, err := s.repo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Shipment{}, err
	}

	// Returning shipments cannot do last-mile delivery — they complete via ready_for_return → returned.
	if current.IsReturning && (req.Status == model.StatusOutForDelivery || req.Status == model.StatusReadyForPickup) {
		return model.Shipment{}, fmt.Errorf("los envíos de retorno no pueden asignarse a ruta de última milla ni a retiro en mostrador")
	}

	// Block redelivery when max attempts reached
	if req.Status == model.StatusRedeliveryScheduled {
		if current.DeliveryAttempts >= s.maxDeliveryAttempts() {
			return model.Shipment{}, fmt.Errorf("se alcanzó el máximo de %d intentos de entrega — el envío debe ir a retiro en mostrador", s.maxDeliveryAttempts())
		}
	}

	if !isValidTransition(current.Status, req.Status) {
		return model.Shipment{}, fmt.Errorf("transición inválida: %s → %s", current.Status, req.Status)
	}

	// Validate returned: DNI check — asymmetric for counter-shipments
	if req.Status == model.StatusReturned {
		if current.ParentShipmentID != nil {
			// Counter-shipment: the person picking up is the original sender, stored as recipient
			if strings.TrimSpace(req.RecipientDNI) == "" {
				return model.Shipment{}, fmt.Errorf("el DNI del remitente original es obligatorio para la devolución")
			}
			expectedDNI := current.Recipient.DNI
			if current.Corrections != nil && current.Corrections.RecipientDNI != nil {
				expectedDNI = *current.Corrections.RecipientDNI
			}
			if expectedDNI != req.RecipientDNI {
				return model.Shipment{}, fmt.Errorf("el DNI no coincide con el del remitente original")
			}
		} else {
			if strings.TrimSpace(req.SenderDNI) == "" {
				return model.Shipment{}, fmt.Errorf("el DNI del remitente es obligatorio para la devolución")
			}
			expectedSenderDNI := current.Sender.DNI
			if current.Corrections != nil && current.Corrections.SenderDNI != nil {
				expectedSenderDNI = *current.Corrections.SenderDNI
			}
			if expectedSenderDNI != req.SenderDNI {
				return model.Shipment{}, fmt.Errorf("el DNI no coincide con el del remitente")
			}
		}
	}

	// Validate ready_for_return: only allowed when shipment is at its origin branch.
	if req.Status == model.StatusReadyForReturn {
		originID := current.OriginBranchID
		if originID == "" {
			originID = current.ReceivingBranchID
		}
		if current.CurrentLocation != originID {
			if b, ok := s.branchRepo.GetByID(originID); ok {
				return model.Shipment{}, fmt.Errorf(
					"el envío no está en su sucursal de origen (%s)", b.Address.City,
				)
			}
			return model.Shipment{}, fmt.Errorf("el envío no está en su sucursal de origen")
		}
	}

	// Validate DNI for delivered
	if req.Status == model.StatusDelivered {
		if strings.TrimSpace(req.RecipientDNI) == "" {
			return model.Shipment{}, fmt.Errorf("el DNI del destinatario es obligatorio para la entrega")
		}
		expectedRecipientDNI := current.Recipient.DNI
		if current.Corrections != nil && current.Corrections.RecipientDNI != nil {
			expectedRecipientDNI = *current.Corrections.RecipientDNI
		}
		if expectedRecipientDNI != req.RecipientDNI {
			return model.Shipment{}, fmt.Errorf("el DNI no coincide con el del destinatario")
		}
	}

	// Validate in_transit: destination must differ from current branch
	if req.Status == model.StatusInTransit {
		destID := s.locationToBranchID(req.Location)
		if destID == current.CurrentLocation {
			return model.Shipment{}, fmt.Errorf("la sucursal de destino debe ser diferente a la sucursal actual")
		}
	}

	// Auto-derive location from prior events when needed
	location := req.Location
	if req.Status == model.StatusAtHub && current.Status == model.StatusInTransit {
		events, _ := s.repo.GetEvents(trackingID)
		for i := len(events) - 1; i >= 0; i-- {
			if events[i].ToStatus == model.StatusInTransit {
				location = events[i].Location
				break
			}
		}
	}
	if req.Status == model.StatusAtHub && current.Status == model.StatusDeliveryFailed {
		events, _ := s.repo.GetEvents(trackingID)
		for i := len(events) - 1; i >= 0; i-- {
			if events[i].ToStatus == model.StatusAtHub || events[i].ToStatus == model.StatusAtOriginHub {
				location = events[i].Location
				break
			}
		}
	}

	// Resolve city string to branch ID
	resolvedLocation := ""
	if req.Status != model.StatusDelivered && location != "" {
		resolvedLocation = s.locationToBranchID(location)
	}

	// Determine actual target status: if arriving at hub and it's the origin branch, use at_origin_hub
	targetStatus := req.Status
	if req.Status == model.StatusAtHub && resolvedLocation != "" {
		originID := current.OriginBranchID
		if originID == "" {
			originID = current.ReceivingBranchID
		}
		if resolvedLocation == originID {
			targetStatus = model.StatusAtOriginHub
		}
	}

	updated, err := s.repo.UpdateStatus(repository.StatusUpdateCmd{
		TrackingID: trackingID,
		FromStatus: current.Status,
		ToStatus:   targetStatus,
		Location:   resolvedLocation,
		ChangedBy:  req.ChangedBy,
		Notes:      req.Notes,
		DriverID:   req.DriverID,
		Timestamp:  time.Now().UTC(),
	})
	if err != nil {
		return model.Shipment{}, err
	}

	// Auto-transition: returning shipment arrived at origin hub → ready_for_return
	if targetStatus == model.StatusAtOriginHub && updated.IsReturning {
		autoUpdated, autoErr := s.repo.UpdateStatus(repository.StatusUpdateCmd{
			TrackingID: trackingID,
			FromStatus: targetStatus,
			ToStatus:   model.StatusReadyForReturn,
			Location:   resolvedLocation,
			ChangedBy:  req.ChangedBy,
			Notes:      "Envío de retorno llegó a sucursal de origen — listo para devolución",
			Timestamp:  time.Now().UTC(),
		})
		if autoErr == nil {
			return autoUpdated, nil
		}
	}

	// Auto-transition: no_entregado/rechazado → at_hub (keeping the intermediate state in history)
	if targetStatus == model.StatusNoEntregado || targetStatus == model.StatusRechazado {
		// Derive hub location from the last at_hub/at_origin_hub event
		autoLocation := ""
		if evs, _ := s.repo.GetEvents(trackingID); len(evs) > 0 {
			for i := len(evs) - 1; i >= 0; i-- {
				if evs[i].ToStatus == model.StatusAtHub || evs[i].ToStatus == model.StatusAtOriginHub {
					autoLocation = evs[i].Location
					break
				}
			}
		}

		autoHub := model.StatusAtHub
		if autoLocation != "" {
			originID := updated.OriginBranchID
			if originID == "" {
				originID = updated.ReceivingBranchID
			}
			if autoLocation == originID {
				autoHub = model.StatusAtOriginHub
			}
		}

		var autoNotes string
		if targetStatus == model.StatusNoEntregado {
			autoNotes = "Plazo de retiro vencido — envío devuelto a sucursal"
		} else {
			autoNotes = "Destinatario rechazó el envío — devuelto a sucursal"
		}

		autoUpdated, autoErr := s.repo.UpdateStatus(repository.StatusUpdateCmd{
			TrackingID: trackingID,
			FromStatus: targetStatus,
			ToStatus:   autoHub,
			Location:   autoLocation,
			ChangedBy:  req.ChangedBy,
			Notes:      autoNotes,
			Timestamp:  time.Now().UTC(),
		})
		if autoErr == nil {
			// If the auto-transition landed on at_origin_hub and is_returning, also fire ready_for_return
			if autoHub == model.StatusAtOriginHub && autoUpdated.IsReturning {
				rfrUpdated, rfrErr := s.repo.UpdateStatus(repository.StatusUpdateCmd{
					TrackingID: trackingID,
					FromStatus: autoHub,
					ToStatus:   model.StatusReadyForReturn,
					Location:   autoLocation,
					ChangedBy:  req.ChangedBy,
					Notes:      "Envío de retorno llegó a sucursal de origen — listo para devolución",
					Timestamp:  time.Now().UTC(),
				})
				if rfrErr == nil {
					return rfrUpdated, nil
				}
			}
			return autoUpdated, nil
		}
	}

	return updated, nil
}

// CorrectShipment stores field corrections without modifying original data and
// auto-persists one comment per corrected field.
func (s *ShipmentService) CorrectShipment(trackingID, username string, req model.CorrectShipmentRequest) (model.Shipment, error) {
	if req.Corrections.IsEmpty() {
		return model.Shipment{}, fmt.Errorf("no se proporcionaron correcciones")
	}
	if req.Corrections.SenderDNI != nil {
		if err := validateDNI(*req.Corrections.SenderDNI, "sender_dni"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Corrections.RecipientDNI != nil {
		if err := validateDNI(*req.Corrections.RecipientDNI, "recipient_dni"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Corrections.SenderEmail != nil && *req.Corrections.SenderEmail != "" {
		if err := validateEmail(*req.Corrections.SenderEmail, "sender_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Corrections.RecipientEmail != nil && *req.Corrections.RecipientEmail != "" {
		if err := validateEmail(*req.Corrections.RecipientEmail, "recipient_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	shipment, err := s.repo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Shipment{}, err
	}
	if shipment.Status == model.StatusDraft {
		return model.Shipment{}, fmt.Errorf("los borradores deben editarse directamente")
	}
	terminalOrFrozen := map[model.Status]bool{
		model.StatusDelivered:           true,
		model.StatusReturned:            true,
		model.StatusCancelled:           true,
		model.StatusLost:                true,
		model.StatusDestroyed:           true,
		model.StatusNoEntregado:         true,
		model.StatusRechazado:           true,
		model.StatusRedeliveryScheduled: true,
	}
	if terminalOrFrozen[shipment.Status] {
		return model.Shipment{}, fmt.Errorf("no se pueden corregir envíos finalizados o en proceso de devolución")
	}
	// Recompute priority if any ML-relevant field is being corrected.
	var correctionPrediction *model.PriorityPrediction
	if s.mlClient != nil {
		c := req.Corrections
		if c.ShipmentType != nil || c.TimeWindow != nil || c.ColdChain != nil ||
			c.IsFragile != nil || c.OriginProvince != nil || c.DestinationProvince != nil {
			// Build effective shipment: start from original, apply stored corrections,
			// then layer the incoming corrections on top.
			effective := shipment
			if stored := shipment.Corrections; stored != nil {
				if stored.ShipmentType != nil {
					effective.ShipmentType = *stored.ShipmentType
				}
				if stored.TimeWindow != nil {
					effective.TimeWindow = *stored.TimeWindow
				}
				if stored.ColdChain != nil {
					effective.ColdChain = *stored.ColdChain == "true"
				}
				if stored.IsFragile != nil {
					effective.IsFragile = *stored.IsFragile == "true"
				}
				if stored.OriginProvince != nil {
					effective.Sender.Address.Province = *stored.OriginProvince
				}
				if stored.DestinationProvince != nil {
					effective.Recipient.Address.Province = *stored.DestinationProvince
				}
			}
			if c.ShipmentType != nil {
				effective.ShipmentType = *c.ShipmentType
			}
			if c.TimeWindow != nil {
				effective.TimeWindow = *c.TimeWindow
			}
			if c.ColdChain != nil {
				effective.ColdChain = *c.ColdChain == "true"
			}
			if c.IsFragile != nil {
				effective.IsFragile = *c.IsFragile == "true"
			}
			if c.OriginProvince != nil {
				effective.Sender.Address.Province = *c.OriginProvince
			}
			if c.DestinationProvince != nil {
				effective.Recipient.Address.Province = *c.DestinationProvince
			}
			correctionPrediction = s.mlClient.PredictFromShipment(effective)
		}
	}
	updated, err := s.repo.ApplyCorrections(repository.CorrectCmd{
		TrackingID:  trackingID,
		Username:    username,
		Status:      shipment.Status,
		Corrections: req.Corrections,
		Timestamp:   time.Now().UTC(),
		Prediction:  correctionPrediction,
	})
	if err != nil {
		return model.Shipment{}, err
	}
	setPriority(&updated, correctionPrediction)
	for _, f := range req.Corrections.Fields() {
		body := fmt.Sprintf("[Corrección] %s. Nuevo valor: %s", f.Label, f.Value)
		_, _ = s.commentSvc.AddComment(trackingID, username, body)
	}
	return updated, nil
}

func (s *ShipmentService) CancelShipment(trackingID, username, reason string) (model.Shipment, error) {
	if strings.TrimSpace(reason) == "" {
		return model.Shipment{}, fmt.Errorf("el motivo de cancelación es obligatorio")
	}
	shipment, err := s.repo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Shipment{}, err
	}
	cancellable := map[model.Status]bool{
		model.StatusAtOriginHub:    true,
		model.StatusAtHub:          true,
		model.StatusReadyForPickup: true,
		model.StatusReadyForReturn: true,
	}
	if !cancellable[shipment.Status] {
		return model.Shipment{}, fmt.Errorf("no se puede cancelar un envío con estado '%s'", shipment.Status)
	}
	if shipment.IsReturning && shipment.Status != model.StatusReadyForReturn {
		return model.Shipment{}, fmt.Errorf("no se puede cancelar un envío que ya está en proceso de devolución")
	}
	now := time.Now().UTC()
	updated, err := s.repo.CancelShipment(repository.CancelCmd{
		TrackingID: trackingID,
		Username:   username,
		Reason:     reason,
		FromStatus: shipment.Status,
		Timestamp:  now,
	})
	if err != nil {
		return model.Shipment{}, err
	}

	// Shipments already in ready_for_return are being returned — no counter-shipment needed.
	if shipment.Status == model.StatusReadyForReturn {
		_, _ = s.commentSvc.AddComment(trackingID, username, fmt.Sprintf("[Cancelación] %s", reason))
		return updated, nil
	}

	// Create counter-shipment
	counterID := generateTrackingID()
	counterLocation := shipment.CurrentLocation
	if counterLocation == "" {
		counterLocation = shipment.ReceivingBranchID
	}

	// Counter-shipment starts at:
	//   - at_origin_hub (with auto-transition to ready_for_return) if already at origin
	//   - at_hub otherwise
	counterStatus := model.StatusAtHub
	originID := shipment.OriginBranchID
	if originID == "" {
		originID = shipment.ReceivingBranchID
	}
	if counterLocation == originID {
		counterStatus = model.StatusAtOriginHub
	}

	parentID := trackingID
	counter := model.Shipment{
		TrackingID:          counterID,
		Sender:              model.Customer{}, // no sender for counter-shipments
		Recipient:           shipment.Sender,  // original sender becomes recipient
		WeightKg:            shipment.WeightKg,
		PackageType:         shipment.PackageType,
		IsFragile:           shipment.IsFragile,
		SpecialInstructions: shipment.SpecialInstructions,
		ShipmentType:        model.ShipmentTypeNormal,
		TimeWindow:          model.TimeWindowFlexible,
		ColdChain:           shipment.ColdChain,
		ReceivingBranchID:   counterLocation,
		OriginBranchID:      originID,
		Status:              counterStatus,
		CurrentLocation:     counterLocation,
		CreatedAt:           now,
		UpdatedAt:           now,
		EstimatedDeliveryAt: now.AddDate(0, 0, 7),
		ParentShipmentID:    &parentID,
		IsReturning:         true,
	}

	if s.mlClient != nil {
		pred := s.mlClient.PredictFromShipment(counter)
		setPriority(&counter, pred)
	}

	_, err = s.repo.Create(repository.CreateShipmentCmd{
		Shipment:  counter,
		ChangedBy: username,
		Notes:     fmt.Sprintf("[Contra-envío] Generado por cancelación de %s", trackingID),
	})
	if err != nil {
		// Log but don't fail the cancellation
		_ = err
	} else {
		// If counter-shipment is at origin, auto-transition to ready_for_return
		if counterStatus == model.StatusAtOriginHub {
			_, _ = s.repo.UpdateStatus(repository.StatusUpdateCmd{
				TrackingID: counterID,
				FromStatus: model.StatusAtOriginHub,
				ToStatus:   model.StatusReadyForReturn,
				Location:   counterLocation,
				ChangedBy:  username,
				Notes:      "Envío de retorno en sucursal de origen — listo para devolución",
				Timestamp:  now,
			})
		}
		_, _ = s.commentSvc.AddComment(counterID, username,
			fmt.Sprintf("[Contra-envío] Generado por cancelación de %s", trackingID))
	}

	body := fmt.Sprintf("[Cancelación] %s — Contra-envío generado: %s", reason, counterID)
	_, _ = s.commentSvc.AddComment(trackingID, username, body)
	return updated, nil
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

func (s *ShipmentService) Stats(filter model.ShipmentFilter) (model.Stats, error) {
	return s.repo.Stats(filter)
}

func generateTrackingID() string {
	id := uuid.New().String()
	return fmt.Sprintf("LT-%s", strings.ToUpper(id[:8]))
}

func generateDraftID() string {
	var b [4]byte
	rand.Read(b[:])
	n := binary.BigEndian.Uint32(b[:])%90000 + 10000
	return fmt.Sprintf("BORRADOR-%d", n)
}

func isValidTransition(from, to model.Status) bool {
	allowed := map[model.Status][]model.Status{
		model.StatusDraft: {}, // draft transitions only via ConfirmDraft
		model.StatusAtOriginHub: {
			model.StatusLoaded,
			model.StatusReadyForReturn,
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusLoaded: {
			model.StatusInTransit,
			model.StatusAtOriginHub, // unassign at origin
			model.StatusAtHub,       // unassign at intermediate hub
		},
		model.StatusInTransit: {
			model.StatusAtHub,
			model.StatusAtOriginHub, // when destination = origin branch (handled by service)
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusAtHub: {
			model.StatusLoaded,
			model.StatusOutForDelivery,
			model.StatusReadyForPickup,
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusOutForDelivery: {
			model.StatusDelivered,
			model.StatusDeliveryFailed,
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusDeliveryFailed: {
			model.StatusRedeliveryScheduled,
			model.StatusReadyForPickup,
			model.StatusRechazado,
		},
		model.StatusRedeliveryScheduled: {
			model.StatusOutForDelivery,
		},
		model.StatusReadyForPickup: {
			model.StatusDelivered,
			model.StatusNoEntregado,
		},
		model.StatusNoEntregado: {
			model.StatusAtHub,
		},
		model.StatusRechazado: {
			model.StatusAtHub,
		},
		model.StatusReadyForReturn: {
			model.StatusReturned,
		},
		// Terminal states — no transitions
		model.StatusDelivered: {},
		model.StatusReturned:  {},
		model.StatusCancelled: {},
		model.StatusLost:      {},
		model.StatusDestroyed: {},
	}
	for _, s := range allowed[from] {
		if s == to {
			return true
		}
	}
	return false
}
