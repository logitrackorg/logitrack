package service

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/ml"
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

// validatePackageWeight rejects the combination of envelope (sobre) with weight above
// the mid-weight threshold. Envelopes are only allowed up to WeightTierMidLowKg (5 kg).
func validatePackageWeight(pt model.PackageType, weightKg float64) error {
	if pt == model.PackageEnvelope && weightKg > model.WeightTierMidLowKg {
		return fmt.Errorf("un sobre no puede superar %.0f kg; para envíos de mayor peso usá una caja", model.WeightTierMidLowKg)
	}
	return nil
}

// resolveDeliveryMethod validates input and applies the default (ultima_milla) when empty.
func resolveDeliveryMethod(m model.DeliveryMethod) (model.DeliveryMethod, error) {
	switch m {
	case "":
		return model.DeliveryMethodLastMile, nil
	case model.DeliveryMethodLastMile, model.DeliveryMethodBranchPickup:
		return m, nil
	default:
		return "", fmt.Errorf("delivery_method inválido: %q (debe ser 'ultima_milla' o 'retiro_sucursal')", m)
	}
}

// MaxLastMileDistanceKm is the maximum distance (in km) between the recipient's address
// and the final branch for last-mile delivery to be allowed. Beyond this, the customer
// must opt for branch pickup.
const MaxLastMileDistanceKm = 50.0

// validateLastMileReachable returns an error when delivery_method is ultima_milla and
// the recipient's address sits farther than MaxLastMileDistanceKm from the final branch.
// If coordinates cannot be resolved on either side, the check is skipped (no error).
func (s *ShipmentService) validateLastMileReachable(method model.DeliveryMethod, recipient model.Customer, finalBranchID string) error {
	if method != model.DeliveryMethodLastMile {
		return nil
	}
	rLat, rLng := 0.0, 0.0
	if recipient.Address.Latitude != nil && recipient.Address.Longitude != nil {
		rLat, rLng = *recipient.Address.Latitude, *recipient.Address.Longitude
	} else {
		rLat, rLng, _ = geo.GeocodeShipmentAddress(recipient.Address.Street, recipient.Address.City, recipient.Address.Province)
	}
	if rLat == 0 && rLng == 0 {
		return nil
	}
	branch, ok := s.branchRepo.GetByID(finalBranchID)
	if !ok || branch.Latitude == nil || branch.Longitude == nil {
		return nil
	}
	distKm := ml.HaversineKm(rLat, rLng, *branch.Latitude, *branch.Longitude)
	if distKm > MaxLastMileDistanceKm {
		branchLabel := branch.Name
		if branch.Address.City != "" {
			branchLabel = fmt.Sprintf("%s — %s", branch.Name, branch.Address.City)
		}
		return fmt.Errorf(
			"la dirección del destinatario está a %.1f km de la sucursal más cercana (%s). El máximo para entrega a domicilio es %.0f km: debe seleccionar 'Retiro en sucursal'",
			distKm, branchLabel, MaxLastMileDistanceKm,
		)
	}
	return nil
}

// EmailConfirmationSender is the minimal interface this service needs to send
// shipment confirmation emails. Satisfied by *email.Service.
type EmailConfirmationSender interface {
	SendShipmentConfirmation(shipment model.Shipment)
}

// OutForDeliveryNotifier sends last-mile notifications to recipients (CA-01).
// Satisfied by *messaging.Service.
type OutForDeliveryNotifier interface {
	SendOutForDeliveryNotification(shipment model.Shipment)
}

// ReadyForPickupNotifier sends branch-pickup notifications to recipients.
// Satisfied by *email.Service.
type ReadyForPickupNotifier interface {
	SendReadyForPickupNotification(shipment model.Shipment, branch model.Branch, deadlineDate *time.Time)
}

// DeliveryConfirmedNotifier sends delivery-confirmed notifications to the sender.
// CA-01/CA-02: only the sender is notified; satisfied by *messaging.Service.
type DeliveryConfirmedNotifier interface {
	SendDeliveryConfirmedNotification(shipment model.Shipment)
}

// RejectedNotifier sends rejection notifications to the sender (LOGITRACK-429).
// CA-01/CA-02: only the sender is notified; satisfied by *messaging.Service.
type RejectedNotifier interface {
	SendRejectedNotification(shipment model.Shipment, notes string)
}

type ShipmentService struct {
	repo         repository.ShipmentRepository
	branchRepo   repository.BranchRepository
	customerRepo repository.CustomerRepository
	commentSvc   *CommentService
	mlClient     *MLService
	sysConfig    SystemConfigProvider
	pricingSvc   *PricingService
	graphSvc     *BranchGraphService // WIP: multi-hop path recording
	notifSvc     *NotificationService
	emailSvc            EmailConfirmationSender
	messagingSvc        OutForDeliveryNotifier
	pickupEmailSvc      ReadyForPickupNotifier
	deliveryNotifSvc    DeliveryConfirmedNotifier
	rejectedNotifSvc    RejectedNotifier
}

func (s *ShipmentService) SetBranchGraphService(g *BranchGraphService)       { s.graphSvc = g }
func (s *ShipmentService) SetNotificationService(svc *NotificationService)    { s.notifSvc = svc }
func (s *ShipmentService) SetEmailService(svc EmailConfirmationSender)           { s.emailSvc = svc }
func (s *ShipmentService) SetMessagingService(svc OutForDeliveryNotifier)        { s.messagingSvc = svc }
func (s *ShipmentService) SetReadyForPickupEmailService(svc ReadyForPickupNotifier) { s.pickupEmailSvc = svc }
func (s *ShipmentService) SetDeliveryConfirmedService(svc DeliveryConfirmedNotifier) { s.deliveryNotifSvc = svc }
func (s *ShipmentService) SetRejectedService(svc RejectedNotifier)                  { s.rejectedNotifSvc = svc }

// ReleaseShipmentFromTrip libera la reserva cross-branch del envío.
func (s *ShipmentService) ReleaseShipmentFromTrip(trackingID string) error {
	return s.repo.ReleaseFromTrip(trackingID)
}

// sendConfirmationEmails envía emails de confirmación al destinatario y al remitente (CA-03/CA-04).
// Usa dedup atómica en DB para evitar duplicados aunque se llame más de una vez (CA-05).
// Se llama siempre como goroutine (fire-and-forget) — los errores son silenciosos (CA-02).
func (s *ShipmentService) sendConfirmationEmails(shipment model.Shipment) {
	if s.emailSvc == nil {
		return
	}
	// Dedup (CA-05): marca atómicamente la fila; si ya estaba marcada, omite el envío.
	sent, err := s.repo.SetConfirmationEmailSent(shipment.TrackingID)
	if err != nil {
		log.Printf("[email] SetConfirmationEmailSent error para %s: %v", shipment.TrackingID, err)
		return
	}
	if !sent {
		log.Printf("[email] confirmación de envío para %s ya enviada anteriormente — omitida (CA-05)", shipment.TrackingID)
		return
	}
	s.emailSvc.SendShipmentConfirmation(shipment)
}

// maybeRecordPath is a WIP feature: records a planned multi-hop path when a shipment moves.
func (s *ShipmentService) maybeRecordPath(sh model.Shipment, reason string) {
	if s.graphSvc == nil || s.repo == nil {
		return
	}
	if sh.FinalBranchID == "" || sh.ReceivingBranchID == sh.FinalBranchID {
		return
	}

	inPath := false
	for _, b := range sh.PlannedPath {
		if b == sh.ReceivingBranchID {
			inPath = true
			break
		}
	}

	var path []string
	var hopIdx int
	if reason == "hop_advance" && len(sh.PlannedPath) > 0 && inPath {
		path = sh.PlannedPath
		hopIdx = sh.HopIndex + 1
	} else {
		// Fresh computation from current location
		path = s.graphSvc.ShortestPath(sh.ReceivingBranchID, sh.FinalBranchID)
		hopIdx = 0
	}
	if len(path) < 2 {
		return
	}
	nextHop := ""
	if hopIdx+1 < len(path) {
		nextHop = path[hopIdx+1]
	}
	_ = s.repo.RecordPathPlanned(repository.PathPlannedCmd{
		TrackingID:      sh.TrackingID,
		PlannedPath:     path,
		NextHopBranchID: nextHop,
		HopIndex:        hopIdx,
		PathRevision:    sh.PathRevision + 1,
		Reason:          reason,
	})
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

func (s *ShipmentService) SetPricingService(p *PricingService) {
	s.pricingSvc = p
}

// applyPrice computes and stamps the price + breakdown onto a shipment in place.
// Origin is the receiving branch address (where the shipment physically departs from),
// falling back to the sender's address only if the branch cannot be resolved.
// No-op when the pricing service has not been wired (e.g. unit tests that don't care).
func (s *ShipmentService) applyPrice(shipment *model.Shipment) {
	if s.pricingSvc == nil {
		return
	}
	origin := shipment.Sender.Address
	if shipment.ReceivingBranchID != "" {
		if b, ok := s.branchRepo.GetByID(shipment.ReceivingBranchID); ok {
			origin = model.Address{
				Street:     b.Address.Street,
				City:       b.Address.City,
				Province:   b.Province,
				PostalCode: b.Address.PostalCode,
				Latitude:   b.Latitude,
				Longitude:  b.Longitude,
			}
		}
	}
	destination := shipment.Recipient.Address
	if shipment.FinalBranchID != "" {
		if b, ok := s.branchRepo.GetByID(shipment.FinalBranchID); ok {
			destination = model.Address{
				Street:     b.Address.Street,
				City:       b.Address.City,
				Province:   b.Province,
				PostalCode: b.Address.PostalCode,
				Latitude:   b.Latitude,
				Longitude:  b.Longitude,
			}
		}
	}
	price, breakdown := s.pricingSvc.Quote(PricingInput{
		WeightKg:       shipment.WeightKg,
		PackageType:    shipment.PackageType,
		ShipmentType:   shipment.ShipmentType,
		TimeWindow:     shipment.TimeWindow,
		IsFragile:      shipment.IsFragile,
		DeliveryMethod: shipment.DeliveryMethod,
		Origin:         origin,
		Destination:    destination,
	})
	shipment.Price = &price
	b := breakdown
	shipment.PriceBreakdown = &b
	if shipment.PriceCurrency == "" {
		shipment.PriceCurrency = model.CurrencyARS
	}
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
	if err := validatePackageWeight(req.PackageType, req.WeightKg); err != nil {
		return model.Shipment{}, err
	}
	now := clock.Now().UTC()
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
	deliveryMethod, err := resolveDeliveryMethod(req.DeliveryMethod)
	if err != nil {
		return model.Shipment{}, err
	}

	finalBranchID := s.resolveFinalBranch(req.Recipient)
	if err := s.validateLastMileReachable(deliveryMethod, req.Recipient, finalBranchID); err != nil {
		return model.Shipment{}, err
	}

	var prediction *model.PriorityPrediction
	if s.mlClient != nil {
		prediction = s.mlClient.PredictFromCreateRequest(req)
	}

	// Cuando origen == destino el envío ya está en su hub final al crearse.
	initialStatus := model.StatusAtOriginHub
	if finalBranchID == req.ReceivingBranchID {
		initialStatus = model.StatusAtHub
	}
	shipment := model.Shipment{
		TrackingID:          generateTrackingID(),
		Sender:              req.Sender,
		Recipient:           req.Recipient,
		FinalBranchID:       finalBranchID,
		WeightKg:            req.WeightKg,
		PackageType:         req.PackageType,
		IsFragile:           req.IsFragile,
		SpecialInstructions: req.SpecialInstructions,
		ShipmentType:        shipmentType,
		TimeWindow:          timeWindow,
		DeliveryMethod:      deliveryMethod,
		ReceivingBranchID:   req.ReceivingBranchID,
		OriginBranchID:      req.ReceivingBranchID,
		Status:              initialStatus,
		CurrentLocation:     currentLocation,
		CreatedAt:           now,
		UpdatedAt:           now,
		EstimatedDeliveryAt: s.estimatedDelivery(now, req.ReceivingBranchID, finalBranchID, string(shipmentType)),
	}
	setPriority(&shipment, prediction)
	s.applyPrice(&shipment)
	created, err := s.repo.Create(repository.CreateShipmentCmd{
		Shipment:  shipment,
		ChangedBy: req.CreatedBy,
		Notes:     "Shipment created",
	})
	if err != nil {
		return model.Shipment{}, err
	}
	s.upsertParties(created)
	go s.sendConfirmationEmails(created) // CA-01/02/03/04/05
	return created, nil
}

func (s *ShipmentService) SaveDraft(req model.SaveDraftRequest) (model.Shipment, error) {
	req.Sender.DNI = strings.TrimSpace(req.Sender.DNI)
	req.Recipient.DNI = strings.TrimSpace(req.Recipient.DNI)
	req.Sender.Name = strings.TrimSpace(req.Sender.Name)
	req.Recipient.Name = strings.TrimSpace(req.Recipient.Name)
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
		if err := validateEmail(strings.TrimSpace(req.Sender.Email), "sender_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Recipient.Email != "" {
		if err := validateEmail(strings.TrimSpace(req.Recipient.Email), "recipient_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	now := clock.Now().UTC()
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
	deliveryMethod, err := resolveDeliveryMethod(req.DeliveryMethod)
	if err != nil {
		return model.Shipment{}, err
	}

	shipment := model.Shipment{
		TrackingID:          generateDraftID(),
		Sender:              req.Sender,
		Recipient:           req.Recipient,
		WeightKg:            req.WeightKg,
		PackageType:         req.PackageType,
		IsFragile:           req.IsFragile,
		SpecialInstructions: req.SpecialInstructions,
		ShipmentType:        shipmentType,
		TimeWindow:          timeWindow,
		DeliveryMethod:      deliveryMethod,
		ReceivingBranchID:   req.ReceivingBranchID,
		OriginBranchID:  req.ReceivingBranchID,
		Status:          model.StatusDraft,
		CurrentLocation: currentLocation,
		CreatedAt:       now,
		UpdatedAt:       now,
		// EstimatedDeliveryAt is intentionally left as zero — it will be
		// calculated with definitive data at the moment of confirmation.
	}
	return s.repo.SaveDraft(repository.SaveDraftCmd{Shipment: shipment})
}

func (s *ShipmentService) UpdateDraft(draftID string, req model.SaveDraftRequest) (model.Shipment, error) {
	req.Sender.DNI = strings.TrimSpace(req.Sender.DNI)
	req.Recipient.DNI = strings.TrimSpace(req.Recipient.DNI)
	req.Sender.Name = strings.TrimSpace(req.Sender.Name)
	req.Recipient.Name = strings.TrimSpace(req.Recipient.Name)
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
		if err := validateEmail(strings.TrimSpace(req.Sender.Email), "sender_email"); err != nil {
			return model.Shipment{}, err
		}
	}
	if req.Recipient.Email != "" {
		if err := validateEmail(strings.TrimSpace(req.Recipient.Email), "recipient_email"); err != nil {
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
	deliveryMethod, err := resolveDeliveryMethod(req.DeliveryMethod)
	if err != nil {
		return model.Shipment{}, err
	}
	existing.Sender = req.Sender
	existing.Recipient = req.Recipient
	existing.WeightKg = req.WeightKg
	existing.PackageType = req.PackageType
	existing.IsFragile = req.IsFragile
	existing.SpecialInstructions = req.SpecialInstructions
	existing.ShipmentType = req.ShipmentType
	existing.TimeWindow = req.TimeWindow
	existing.DeliveryMethod = deliveryMethod
	existing.ReceivingBranchID = req.ReceivingBranchID
	existing.UpdatedAt = clock.Now().UTC()
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

// validateDraftReadyToConfirm validates that a draft has all required fields and
// resolves FinalBranchID/DeliveryMethod defaults in place. Called by both RequestPayment
// and ConfirmDraft so validation logic is not duplicated.
func (s *ShipmentService) validateDraftReadyToConfirm(draft *model.Shipment) error {
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
		return fmt.Errorf("faltan campos obligatorios: %s", strings.Join(missing, ", "))
	}
	if err := validateDNI(draft.Sender.DNI, "sender_dni"); err != nil {
		return err
	}
	if err := validateDNI(draft.Recipient.DNI, "recipient_dni"); err != nil {
		return err
	}
	if draft.Sender.Email != "" {
		if err := validateEmail(draft.Sender.Email, "sender_email"); err != nil {
			return err
		}
	}
	if draft.Recipient.Email != "" {
		if err := validateEmail(draft.Recipient.Email, "recipient_email"); err != nil {
			return err
		}
	}
	if draft.ReceivingBranchID != "" {
		if b, ok := s.branchRepo.GetByID(draft.ReceivingBranchID); ok && b.Status == model.BranchStatusOutOfService {
			return fmt.Errorf("la sucursal '%s' está fuera de servicio y no puede recibir envíos", b.Name)
		}
	}
	if draft.FinalBranchID == "" {
		draft.FinalBranchID = s.resolveFinalBranch(draft.Recipient)
		if draft.FinalBranchID != "" {
			draft.UpdatedAt = clock.Now().UTC()
			s.repo.UpdateDraft(repository.UpdateDraftCmd{Shipment: *draft}) //nolint:errcheck
		}
	}
	if draft.DeliveryMethod == "" {
		draft.DeliveryMethod = model.DeliveryMethodLastMile
	}
	if err := s.validateLastMileReachable(draft.DeliveryMethod, draft.Recipient, draft.FinalBranchID); err != nil {
		return err
	}
	if err := validatePackageWeight(draft.PackageType, draft.WeightKg); err != nil {
		return err
	}
	return nil
}

func (s *ShipmentService) ConfirmDraft(draftID string, changedBy string) (model.Shipment, error) {
	draft, err := s.repo.GetByTrackingID(draftID)
	if err != nil {
		return model.Shipment{}, err
	}
	if draft.Status != model.StatusDraft {
		return model.Shipment{}, fmt.Errorf("solo se pueden confirmar envíos en borrador")
	}
	if err := s.validateDraftReadyToConfirm(&draft); err != nil {
		return model.Shipment{}, err
	}

	var prediction *model.PriorityPrediction
	if s.mlClient != nil {
		prediction = s.mlClient.PredictFromShipment(draft)
	}
	now := clock.Now().UTC()

	s.applyPrice(&draft)

	confirmed, err := s.repo.ConfirmDraft(repository.ConfirmDraftCmd{
		DraftID:             draftID,
		NewTrackingID:       generateTrackingID(),
		ChangedBy:           changedBy,
		Notes:               "Shipment confirmed",
		Timestamp:           now,
		Prediction:          prediction,
		EstimatedDeliveryAt: s.estimatedDelivery(now, draft.OriginBranchID, draft.FinalBranchID, string(draft.ShipmentType)),
		Price:               draft.Price,
		PriceBreakdown:      draft.PriceBreakdown,
	})
	if err != nil {
		return model.Shipment{}, err
	}
	setPriority(&confirmed, prediction)
	s.upsertParties(confirmed)
	go s.sendConfirmationEmails(confirmed) // CA-01/02/03/04/05

	// Auto-transición: origen == destino → el envío ya está en su hub final.
	if confirmed.OriginBranchID != "" && confirmed.OriginBranchID == confirmed.FinalBranchID {
		autoUpdated, autoErr := s.repo.UpdateStatus(repository.StatusUpdateCmd{
			TrackingID: confirmed.TrackingID,
			FromStatus: model.StatusAtOriginHub,
			ToStatus:   model.StatusAtHub,
			Location:   confirmed.OriginBranchID,
			ChangedBy:  changedBy,
			Notes:      "Sucursal de origen es la sucursal de destino — envío disponible para última milla",
			Timestamp:  time.Now().UTC(),
		})
		if autoErr == nil {
			return autoUpdated, nil
		}
	}

	return confirmed, nil
}

func (s *ShipmentService) UpdateStatus(trackingID string, req model.UpdateStatusRequest) (model.Shipment, error) {
	if req.Status == model.StatusDeliveryFailed && strings.TrimSpace(req.Notes) == "" {
		return model.Shipment{}, fmt.Errorf("las notas son obligatorias para fallo de entrega")
	}
	if req.Status == model.StatusOutForDelivery && strings.TrimSpace(req.DriverID) == "" && !req.SystemTransition {
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

	// Restringir transición desde at_hub según delivery_method elegido al crear el pedido.
	// Excepción: ready_for_pickup desde delivery_failed sigue permitido (fallback de última milla agotada),
	// porque esta guarda sólo aplica cuando el estado actual es at_hub.
	if current.Status == model.StatusAtHub {
		method := current.DeliveryMethod
		if method == "" {
			method = model.DeliveryMethodLastMile
		}
		switch method {
		case model.DeliveryMethodLastMile:
			if req.Status == model.StatusReadyForPickup {
				return model.Shipment{}, fmt.Errorf("envío configurado para entrega a domicilio: usar 'En reparto'")
			}
		case model.DeliveryMethodBranchPickup:
			if req.Status == model.StatusOutForDelivery {
				return model.Shipment{}, fmt.Errorf("envío configurado para retiro en sucursal: usar 'Listo para retiro'")
			}
		}
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

	// Auto-derive location from prior events SOLO si el caller no proveyó uno.
	// Para viajes multi-hop, ConfirmUnload/CloseByVehicleQR pasan la sucursal del
	// operador explícitamente — no hay que pisarla con el destino final que puso Start.
	location := req.Location
	if location == "" && req.Status == model.StatusAtHub && current.Status == model.StatusInTransit {
		events, _ := s.repo.GetEvents(trackingID)
		for i := len(events) - 1; i >= 0; i-- {
			if events[i].ToStatus == model.StatusInTransit {
				location = events[i].Location
				break
			}
		}
	}
	if location == "" && req.Status == model.StatusAtHub && current.Status == model.StatusDeliveryFailed {
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
		Timestamp:  clock.Now().UTC(),
	})
	if err != nil {
		return model.Shipment{}, err
	}

	// Notification routing (non-blocking):
	//   at_hub + FinalBranchID  → destination_arrival  (LOGITRACK-402)
	//   at_hub (other)          → shipment_received     (LOGITRACK-401)
	//   at_origin_hub           → return_arrival        (LOGITRACK-403)
	// The two at_hub cases are mutually exclusive to avoid double notifications.
	if s.notifSvc != nil {
		branchID := resolvedLocation
		if branchID == "" {
			branchID = updated.CurrentLocation
		}
		isDestination := targetStatus == model.StatusAtHub &&
			resolvedLocation != "" && resolvedLocation == updated.FinalBranchID

		if isDestination {
			go s.notifSvc.NotifyDestinationArrival(updated, branchID)
		} else if targetStatus == model.StatusAtHub || targetStatus == model.StatusAtOriginHub {
			go s.notifSvc.NotifyShipmentReceived(updated, branchID, targetStatus)
		} else if targetStatus == model.StatusReadyForReturn {
			// CA-03 — transición directa a ready_for_return (operador la setea manualmente).
			// Las auto-transiciones tienen su propio hook y retornan antes de llegar acá.
			originBranchID := updated.OriginBranchID
			if originBranchID == "" {
				originBranchID = updated.ReceivingBranchID
			}
			go s.notifSvc.NotifyReturnStarted(updated, originBranchID, req.Notes)
		} else if targetStatus == model.StatusReturned {
			// CA-04 — el envío fue devuelto: notificar a la sucursal de origen.
			originBranchID := updated.OriginBranchID
			if originBranchID == "" {
				originBranchID = updated.ReceivingBranchID
			}
			go s.notifSvc.NotifyReturnCompleted(updated, originBranchID)
		}
	}

	// CA-01: envío transicionó a última milla → notificar al destinatario por WhatsApp/email.
	if targetStatus == model.StatusOutForDelivery &&
		updated.DeliveryMethod == model.DeliveryMethodLastMile &&
		s.messagingSvc != nil {
		go s.messagingSvc.SendOutForDeliveryNotification(updated)
	}

	// CA-01/CA-02: envío entregado → notificar al remitente (solo) por WhatsApp/email.
	if targetStatus == model.StatusDelivered && s.deliveryNotifSvc != nil {
		go s.deliveryNotifSvc.SendDeliveryConfirmedNotification(updated)
	}

	// LOGITRACK-429 CA-01/CA-02: envío rechazado → notificar al remitente (solo) por WhatsApp/email.
	if targetStatus == model.StatusRechazado && s.rejectedNotifSvc != nil {
		notes := req.Notes
		go s.rejectedNotifSvc.SendRejectedNotification(updated, notes)
	}

	// CA-01: envío transicionó a listo para retiro en sucursal → notificar al destinatario por WhatsApp/email.
	if targetStatus == model.StatusReadyForPickup && s.pickupEmailSvc != nil {
		branch, _ := s.branchRepo.GetByID(updated.ReceivingBranchID)
		var deadline *time.Time
		if s.sysConfig != nil {
			if days := s.sysConfig.Get().PickupDeadlineDays; days > 0 {
				d := clock.Now().UTC().AddDate(0, 0, days)
				deadline = &d
			}
		}
		go s.pickupEmailSvc.SendReadyForPickupNotification(updated, branch, deadline)
	}

	// Auto-transition: retiro_sucursal llegó a su sucursal final → listo para retiro.
	// Aplica tanto a at_hub (llegó vía inter-sucursal) como a at_origin_hub (mismo origen
	// y destino, p.ej. Córdoba → Córdoba), para que el destinatario sea notificado
	// automáticamente sin requerir acción manual del operador.
	if (targetStatus == model.StatusAtHub || targetStatus == model.StatusAtOriginHub) &&
		updated.DeliveryMethod == model.DeliveryMethodBranchPickup &&
		resolvedLocation != "" && resolvedLocation == updated.FinalBranchID {
		autoUpdated, autoErr := s.repo.UpdateStatus(repository.StatusUpdateCmd{
			TrackingID: trackingID,
			FromStatus: targetStatus,
			ToStatus:   model.StatusReadyForPickup,
			Location:   resolvedLocation,
			ChangedBy:  req.ChangedBy,
			Notes:      "Envío listo para retiro en sucursal — transición automática",
			Timestamp:  clock.Now().UTC(),
		})
		if autoErr == nil {
			if s.pickupEmailSvc != nil {
				branch, _ := s.branchRepo.GetByID(resolvedLocation)
				var deadline *time.Time
				if s.sysConfig != nil {
					if days := s.sysConfig.Get().PickupDeadlineDays; days > 0 {
						d := clock.Now().UTC().AddDate(0, 0, days)
						deadline = &d
					}
				}
				go s.pickupEmailSvc.SendReadyForPickupNotification(autoUpdated, branch, deadline)
			}
			return autoUpdated, nil
		}
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
			Timestamp:  clock.Now().UTC(),
		})
		if autoErr == nil {
			// CA-03 — notificar a la sucursal de origen que el envío está listo para devolución.
			if s.notifSvc != nil {
				originBranchID := autoUpdated.OriginBranchID
				if originBranchID == "" {
					originBranchID = autoUpdated.ReceivingBranchID
				}
				go s.notifSvc.NotifyReturnStarted(autoUpdated, originBranchID, "Envío de retorno llegó a sucursal de origen")
			}
			return autoUpdated, nil
		}
	}

	// rechazado: extiende ETA y marca is_returning, pero NO auto-transiciona a at_hub.
	// El envío queda visible en ese estado para el chofer y el operador decide el siguiente paso.
	if targetStatus == model.StatusRechazado {
		nowET := clock.Now().UTC()
		newETA := returnETA(nowET, updated.EstimatedDeliveryAt)
		if extended, etaErr := s.repo.ExtendETA(repository.ExtendETACmd{
			TrackingID: trackingID,
			OldETA:     updated.EstimatedDeliveryAt,
			NewETA:     *newETA,
			AddedDays:  model.ReturnETAExtraDays,
			Reason:     "shipment_returning_to_sender",
			ChangedBy:  req.ChangedBy,
			Timestamp:  nowET,
		}); etaErr == nil {
			updated = extended
		}
		return updated, nil
	}

	// Auto-transition: no_entregado → at_hub (el envío vuelve al depósito para reintento).
	if targetStatus == model.StatusNoEntregado {
		// El envío empieza un retorno → extender la fecha estimada de entrega 10 días.
		nowET := clock.Now().UTC()
		newETA := returnETA(nowET, updated.EstimatedDeliveryAt)
		if extended, etaErr := s.repo.ExtendETA(repository.ExtendETACmd{
			TrackingID: trackingID,
			OldETA:     updated.EstimatedDeliveryAt,
			NewETA:     *newETA,
			AddedDays:  model.ReturnETAExtraDays,
			Reason:     "shipment_returning_to_sender",
			ChangedBy:  req.ChangedBy,
			Timestamp:  nowET,
		}); etaErr == nil {
			updated = extended
		}

		// Derive hub location from the last at_hub/at_origin_hub event.
		// Falls back to the shipment's current_location for shipments seeded directly
		// as at_hub (no StatusChanged event in history).
		autoLocation := updated.CurrentLocation
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

		const autoNotes = "Plazo de retiro vencido — envío devuelto a sucursal"

		autoUpdated, autoErr := s.repo.UpdateStatus(repository.StatusUpdateCmd{
			TrackingID: trackingID,
			FromStatus: targetStatus,
			ToStatus:   autoHub,
			Location:   autoLocation,
			ChangedBy:  req.ChangedBy,
			Notes:      autoNotes,
			Timestamp:  clock.Now().UTC(),
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
					Timestamp:  clock.Now().UTC(),
				})
				if rfrErr == nil {
					// CA-03 — notificar a la sucursal de origen.
					if s.notifSvc != nil {
						originBranchID := rfrUpdated.OriginBranchID
						if originBranchID == "" {
							originBranchID = rfrUpdated.ReceivingBranchID
						}
						go s.notifSvc.NotifyReturnStarted(rfrUpdated, originBranchID, autoNotes)
					}
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
	// Validate directional constraints on price-affecting corrections.
	// Price is locked at creation, so corrections can only move to an equal-or-cheaper
	// tier — otherwise the customer would owe more than what was charged.
	if err := s.validateCorrectionDirection(shipment, req.Corrections); err != nil {
		return model.Shipment{}, err
	}

	// Recompute priority if any ML-relevant field is being corrected.
	var correctionPrediction *model.PriorityPrediction
	if s.mlClient != nil {
		c := req.Corrections
		if c.TimeWindow != nil || c.OriginProvince != nil || c.DestinationProvince != nil {
			// Build effective shipment: start from original, apply stored corrections,
			// then layer the incoming corrections on top.
			effective := shipment
			if stored := shipment.Corrections; stored != nil {
				if stored.TimeWindow != nil {
					effective.TimeWindow = *stored.TimeWindow
				}
				if stored.OriginProvince != nil {
					effective.Sender.Address.Province = *stored.OriginProvince
				}
				if stored.DestinationProvince != nil {
					effective.Recipient.Address.Province = *stored.DestinationProvince
				}
			}
			if c.TimeWindow != nil {
				effective.TimeWindow = *c.TimeWindow
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
	newFinalBranch := ""
	c := req.Corrections
	if c.DestinationStreet != nil || c.DestinationCity != nil || c.DestinationProvince != nil || c.DestinationPostalCode != nil {
		effective := shipment.Recipient
		if stored := shipment.Corrections; stored != nil {
			if stored.DestinationStreet != nil {
				effective.Address.Street = *stored.DestinationStreet
			}
			if stored.DestinationCity != nil {
				effective.Address.City = *stored.DestinationCity
			}
			if stored.DestinationProvince != nil {
				effective.Address.Province = *stored.DestinationProvince
			}
		}
		if c.DestinationStreet != nil {
			effective.Address.Street = *c.DestinationStreet
		}
		if c.DestinationCity != nil {
			effective.Address.City = *c.DestinationCity
		}
		if c.DestinationProvince != nil {
			effective.Address.Province = *c.DestinationProvince
		}
		effective.Address.Latitude = nil
		newFinalBranch = s.resolveFinalBranch(effective)
	}

	updated, err := s.repo.ApplyCorrections(repository.CorrectCmd{
		TrackingID:    trackingID,
		Username:      username,
		Status:        shipment.Status,
		Corrections:   req.Corrections,
		Timestamp:     clock.Now().UTC(),
		Prediction:    correctionPrediction,
		FinalBranchID: newFinalBranch,
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
		model.StatusDraft:          true,
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
	now := clock.Now().UTC()
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

	// Drafts and ready_for_return shipments need no counter-shipment.
	if shipment.Status == model.StatusDraft || shipment.Status == model.StatusReadyForReturn {
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
		ReceivingBranchID:   counterLocation,
		OriginBranchID:      originID,
		Status:              counterStatus,
		CurrentLocation:     counterLocation,
		CreatedAt:           now,
		UpdatedAt:           now,
		EstimatedDeliveryAt: returnETA(now, shipment.EstimatedDeliveryAt),
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
		// Notificar a la sucursal de origen apenas se cancela — sin esperar ready_for_return.
		if s.notifSvc != nil {
			if counterStatus == model.StatusAtOriginHub {
				// Cancelado EN la sucursal de origen: el paquete ya está ahí, acción inmediata.
				go s.notifSvc.NotifyReturnCompleted(counter, originID,
					fmt.Sprintf("El envío %s fue cancelado y ya se encuentra en tu sucursal.", trackingID))
			} else {
				// Cancelado en otra sucursal: el contra-envío viene en camino a origen.
				go s.notifSvc.NotifyReturnStarted(counter, originID,
					fmt.Sprintf("Envío cancelado — contra-envío %s en camino a tu sucursal", counterID))
			}
		}

		// If counter-shipment is at origin, auto-transition to ready_for_return (sin notificación extra).
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

func (s *ShipmentService) estimatedDelivery(from time.Time, originBranchID, finalBranchID, shipmentType string) *time.Time {
	var distKm float64
	origin, okO := s.branchRepo.GetByID(originBranchID)
	dest, okD := s.branchRepo.GetByID(finalBranchID)
	if okO && okD && origin.Latitude != nil && origin.Longitude != nil && dest.Latitude != nil && dest.Longitude != nil {
		distKm = ml.HaversineKm(*origin.Latitude, *origin.Longitude, *dest.Latitude, *dest.Longitude)
	} else {
		originProvince, destProvince := "", ""
		if okO {
			originProvince = origin.Province
		}
		if okD {
			destProvince = dest.Province
		}
		distKm = ml.ComputeDistance(originProvince, destProvince)
	}
	days := ml.EstimateDeliveryDaysFromDistance(distKm, shipmentType)
	t := from.AddDate(0, 0, days)
	return &t
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
		model.StatusDraft:           {}, // draft transitions only via RequestPayment/ConfirmDraft
		model.StatusPendingPayment:  {}, // transitions only via PaymentService (ConfirmPayment/RevertToDraft)
		model.StatusAtOriginHub: {
			model.StatusLoaded,
			model.StatusInTransit, // cross-branch pickup en un trip multi-hop que pasa por el origen
			model.StatusReadyForReturn,
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusLoaded: {
			model.StatusInTransit,
			model.StatusOutForDelivery, // last-mile: driver starts trip
			model.StatusAtOriginHub,    // unassign at origin
			model.StatusAtHub,          // unassign at intermediate hub
		},
		model.StatusInTransit: {
			model.StatusAtHub,
			model.StatusAtOriginHub, // when destination = origin branch (handled by service)
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusAtHub: {
			model.StatusInTransit, // cross-branch pickup en un trip multi-hop
			model.StatusLoaded,
			model.StatusOutForDelivery,
			model.StatusReadyForPickup,
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusOutForDelivery: {
			model.StatusDelivered,
			model.StatusDeliveryFailed,
			model.StatusRechazado, // destinatario rechaza activamente en el momento de la entrega
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusDeliveryFailed: {
			model.StatusRedeliveryScheduled,
			model.StatusReadyForPickup,
			model.StatusRechazado,
			model.StatusLost,
			model.StatusDestroyed,
		},
		model.StatusRedeliveryScheduled: {
			model.StatusOutForDelivery,
			model.StatusLoaded, // re-assigned to vehicle via last-mile plan
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

// geocodeCustomer resolves lat/lng for a customer's address if not already set.
// Returns true if coordinates were resolved. Never fails — silently ignores errors.
func geocodeCustomer(c *model.Customer) bool {
	if c.Address.Latitude != nil {
		return false
	}
	lat, lng, _ := geo.GeocodeShipmentAddress(c.Address.Street, c.Address.City, c.Address.Province)
	if lat == 0 && lng == 0 {
		return false
	}
	c.Address.Latitude = &lat
	c.Address.Longitude = &lng
	return true
}

// effectiveTimeWindow returns the time window currently in force on a shipment,
// preferring a stored correction over the original value.
func effectiveTimeWindow(s model.Shipment) model.TimeWindow {
	if s.Corrections != nil && s.Corrections.TimeWindow != nil {
		return *s.Corrections.TimeWindow
	}
	return s.TimeWindow
}

// validateCorrectionDirection enforces that price-affecting corrections never
// move the shipment to a more expensive tier. The price is immutable after
// creation, so upgrades would mean charging the customer less than the new
// commitment — downgrades are fine because the customer already paid more.
func (s *ShipmentService) validateCorrectionDirection(current model.Shipment, c model.ShipmentCorrections) error {
	if c.TimeWindow != nil {
		to := *c.TimeWindow
		// Use the original time_window (pre-corrections) as the reference. This allows
		// reverting a restrictive→flexible correction back to the original restrictive value,
		// while still blocking flexible→restrictive moves for shipments that started as flexible.
		if model.IsTimeWindowRestrictive(to) && !model.IsTimeWindowRestrictive(current.TimeWindow) {
			return fmt.Errorf("este envío fue creado con ventana flexible y su precio no incluye recargo por horario; no es posible asignarle una ventana restringida")
		}
	}
	return nil
}

// resolveFinalBranch returns the ID of the nearest active branch to the recipient's address.
func (s *ShipmentService) resolveFinalBranch(recipient model.Customer) string {
	lat, lng := 0.0, 0.0
	if recipient.Address.Latitude != nil {
		lat, lng = *recipient.Address.Latitude, *recipient.Address.Longitude
	} else {
		lat, lng, _ = geo.GeocodeShipmentAddress("", recipient.Address.City, recipient.Address.Province)
	}
	if lat == 0 && lng == 0 {
		return ""
	}
	branches := s.branchRepo.List()
	return geo.NearestBranch(lat, lng, branches)
}

// returnETA calcula la fecha estimada para un envío que empieza un retorno:
// max(now, currentETA) + ReturnETAExtraDays. Devuelve un puntero listo para usar.
// Si currentETA es nil, parte de now.
func returnETA(now time.Time, currentETA *time.Time) *time.Time {
	base := now
	if currentETA != nil && currentETA.After(now) {
		base = *currentETA
	}
	t := base.AddDate(0, 0, model.ReturnETAExtraDays)
	return &t
}
