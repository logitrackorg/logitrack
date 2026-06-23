package service

import (
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

var ErrClaimForbidden = errors.New("reclamo fuera de sucursal")

type ClaimEvidenceUpload struct {
	FileName string
	MimeType string
	Data     []byte
}

type ClaimService struct {
	claimRepo      repository.ClaimRepository
	claimEventRepo repository.ClaimEventRepository
	shipmentRepo   repository.ShipmentRepository
	eventStore     repository.EventStore
	claimEmailSvc  ClaimEmailSender
	claimWASvc     ClaimWASender
	notifRepo      repository.NotificationRepository
	branchGraphSvc *BranchGraphService
	branchRepo     repository.BranchRepository
	tripRepo       repository.InterBranchTripRepository
	sysConfigSvc   *SystemConfigService
}

// ClaimEmailSender sends customer-facing claim notifications by email.
type ClaimEmailSender interface {
	SendClaimCreatedNotification(claim model.Claim, shipment model.Shipment)
	SendClaimInfoRequestedNotification(claim model.Claim, shipment model.Shipment, supervisorNotes string)
	SendClaimResolvedNotification(claim model.Claim, shipment model.Shipment, resolutionNotes string)
}

// ClaimWASender sends customer-facing claim notifications via WhatsApp
// (with email as fallback when WhatsApp is unavailable).
type ClaimWASender interface {
	SendClaimCreatedWhatsApp(claim model.Claim, shipment model.Shipment)
	SendClaimInfoRequestedWhatsApp(claim model.Claim, shipment model.Shipment, supervisorNotes string)
	SendClaimResolvedWhatsApp(claim model.Claim, shipment model.Shipment, resolutionNotes string)
}

func NewClaimService(
	claimRepo repository.ClaimRepository,
	claimEventRepo repository.ClaimEventRepository,
	shipmentRepo repository.ShipmentRepository,
	eventStore repository.EventStore,
) *ClaimService {
	return &ClaimService{
		claimRepo:      claimRepo,
		claimEventRepo: claimEventRepo,
		shipmentRepo:   shipmentRepo,
		eventStore:     eventStore,
	}
}

// SetClaimEmailService wires the customer-facing claim email sender.
func (s *ClaimService) SetClaimEmailService(svc ClaimEmailSender) {
	s.claimEmailSvc = svc
}

// SetClaimWAService wires the WhatsApp (+ email fallback) sender for claim notifications.
func (s *ClaimService) SetClaimWAService(svc ClaimWASender) {
	s.claimWASvc = svc
}

// SetNotificationRepository wires the notification repository for supervisor in-app notifications.
func (s *ClaimService) SetNotificationRepository(repo repository.NotificationRepository) {
	s.notifRepo = repo
}

// SetSystemConfigService wires the system config service. Required for the
// claim priority engine (umbrales ML + tope de urgentes). Si no se setea, los
// reclamos se crean con prioridad "baja" por defecto.
func (s *ClaimService) SetSystemConfigService(svc *SystemConfigService) {
	s.sysConfigSvc = svc
}

// SetRouteServices wires the branch graph, the branch repository and the
// inter-branch trip repository, used to restrict claim transfer targets to the
// branches that belong to the shipment's route (origin, intermediate hubs and
// destination).
func (s *ClaimService) SetRouteServices(branchGraphSvc *BranchGraphService, branchRepo repository.BranchRepository, tripRepo repository.InterBranchTripRepository) {
	s.branchGraphSvc = branchGraphSvc
	s.branchRepo = branchRepo
	s.tripRepo = tripRepo
}

// addTripRouteBranches añade al set las sucursales del viaje inter-sucursal que
// transporta el envío: la sucursal de origen del viaje más cada parada hasta
// (incluida) aquella donde el envío se descarga. Esto captura las paradas
// intermedias reales del plan, que el camino más corto del grafo estático puede
// omitir (p. ej. caba→mendoza directo, cuando el viaje real pasa por cordoba).
func (s *ClaimService) addTripRouteBranches(trackingID string, route map[string]bool) {
	if s.tripRepo == nil {
		return
	}
	for _, trip := range s.tripRepo.ListAllActive() {
		// El último índice de parada que referencia al envío (descarga o pickup).
		dropIdx := -1
		for i, stop := range trip.Stops {
			if containsStr(stop.ShipmentIDs, trackingID) || containsStr(stop.PickupShipmentIDs, trackingID) {
				dropIdx = i
			}
		}
		if dropIdx < 0 {
			continue
		}
		if trip.OriginBranchID != "" {
			route[trip.OriginBranchID] = true
		}
		for i := 0; i <= dropIdx && i < len(trip.Stops); i++ {
			if b := trip.Stops[i].BranchID; b != "" {
				route[b] = true
			}
		}
	}
}

func containsStr(list []string, v string) bool {
	return slices.Contains(list, v)
}

// TransferTargetBranches returns the active branches a claim may be transferred to:
// only the branches that belong to the shipment's route (origin → intermediate
// hubs → destination), excluding the branch that currently owns the claim.
func (s *ClaimService) TransferTargetBranches(claimID, branchID string) ([]model.Branch, error) {
	claim, err := s.GetByIDForBranch(claimID, branchID)
	if err != nil {
		return nil, err
	}
	shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID)
	if err != nil {
		return nil, repository.ErrClaimNotFound
	}

	// Build the set of branches that belong to the shipment's route.
	route := map[string]bool{}
	if shipment.OriginBranchID != "" {
		route[shipment.OriginBranchID] = true
	}
	dest := shipment.FinalBranchID
	if dest == "" {
		dest = shipment.ReceivingBranchID
	}
	if dest != "" {
		route[dest] = true
	}
	if s.branchGraphSvc != nil && shipment.OriginBranchID != "" && dest != "" {
		for _, b := range s.branchGraphSvc.ShortestPath(shipment.OriginBranchID, dest) {
			route[b] = true
		}
	}
	// Añadir las paradas reales del viaje inter-sucursal que transporta el envío,
	// que el camino más corto del grafo estático puede no incluir.
	s.addTripRouteBranches(claim.TrackingID, route)
	// Exclude the branch that currently holds the claim (the caller's branch).
	delete(route, branchID)

	// Return only active branches that belong to the route.
	out := []model.Branch{}
	if s.branchRepo != nil {
		for _, b := range s.branchRepo.ListActive() {
			if route[b.ID] {
				out = append(out, b)
			}
		}
	}
	return out, nil
}

func (s *ClaimService) CreatePublicClaim(req model.CreatePublicClaimRequest, evidence *ClaimEvidenceUpload) (model.Claim, error) {
	trackingID := strings.TrimSpace(req.TrackingID)
	if trackingID == "" {
		return model.Claim{}, fmt.Errorf("tracking_id es requerido")
	}
	shipment, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Claim{}, fmt.Errorf("envio no encontrado")
	}

	// Normalización de claim_type — single source of truth.
	// Si el caller proveyó Category, recalculamos ClaimType desde el árbol de
	// decisión (ClassifyClaimType) y descartamos el ClaimType crudo. Sin
	// Category caemos al ClaimType del request (compat con clientes legacy).
	parsedDamageSubtypes := ParseDamageSubtypes(req.DamageSubtypes)
	if req.Category != "" {
		classification := ClaimClassificationInput{
			Category:        ClaimCategoryInput(req.Category),
			DamageSubtypes:  parsedDamageSubtypes,
			DeliverySubtype: DeliverySubtype(req.DeliverySubtype),
		}
		if normalized, ok := ClassifyClaimType(classification); ok {
			req.ClaimType = normalized
		} else {
			return model.Claim{}, fmt.Errorf("categoria de reclamo no valida")
		}
	}

	if !model.ValidClaimTypes[req.ClaimType] {
		return model.Claim{}, fmt.Errorf("tipo de reclamo no valido")
	}
	if !CanFileClaimOfType(shipment, req.ClaimType) {
		return model.Claim{}, fmt.Errorf("%s", ClaimIneligibleMessage)
	}

	// Evidencia obligatoria: producto dañado exige adjunto. Aplica a AMBOS
	// canales — antes esto vivía duplicado en parseMultipartPublicClaimRequest
	// y FileClaim del chatbot.
	if req.ClaimType == model.ClaimTypeDamage && DamageRequiresEvidence(parsedDamageSubtypes) && evidence == nil {
		return model.Claim{}, fmt.Errorf("la evidencia es obligatoria para producto dañado")
	}

	// Tipo y tamaño de archivo — set único: imágenes + pdf + txt.
	if err := validateEvidenceUpload(evidence); err != nil {
		return model.Claim{}, err
	}

	description := strings.TrimSpace(req.Description)
	if description == "" {
		return model.Claim{}, fmt.Errorf("la descripcion es requerida")
	}
	if len(description) < 10 || len(description) > 400 {
		return model.Claim{}, fmt.Errorf("la descripcion debe tener entre 10 y 400 caracteres")
	}
	createdBy := strings.TrimSpace(req.CreatedBy)
	if createdBy == "" {
		return model.Claim{}, fmt.Errorf("created_by es requerido")
	}
	claimantDNI := strings.TrimSpace(req.DNI)
	if claimantDNI == "" {
		return model.Claim{}, fmt.Errorf("dni es requerido")
	}
	if !isDigits(claimantDNI) || len(claimantDNI) < 7 || len(claimantDNI) > 8 {
		return model.Claim{}, fmt.Errorf("dni invalido")
	}
	if !s.ValidateClaimant(&shipment, createdBy, claimantDNI) {
		return model.Claim{}, fmt.Errorf("el dni y el nombre no coinciden con el remitente o destinatario del envio")
	}

	// Dedup centralizada: bloquea un segundo reclamo activo del mismo DNI sobre
	// el mismo envío. Un reclamo de otra parte (ej. remitente vs destinatario)
	// no bloquea. Antes esto vivía solo en el handler del chatbot — el form
	// público permitía duplicados.
	if existing, dupErr := s.GetLatestActiveClaimByTrackingIDAndDNI(trackingID, claimantDNI); dupErr == nil {
		return model.Claim{}, &ActiveClaimExistsError{
			ExistingClaimID: existing.ID,
			ExistingStatus:  string(existing.Status),
		}
	}


	claimID, err := s.claimRepo.NextID()
	if err != nil {
		return model.Claim{}, err
	}

	now := clock.Now().UTC()
	var evidenceFileName, evidenceFilePath, evidenceMimeType string
	var evidenceUploadDate *time.Time
	if evidence != nil && len(evidence.Data) > 0 {
		evidenceDir := filepath.Join("uploads", "claims")
		if err := os.MkdirAll(evidenceDir, 0o755); err != nil {
			return model.Claim{}, err
		}
		safeName := sanitizeEvidenceFileName(evidence.FileName)
		if ext := strings.ToLower(filepath.Ext(safeName)); ext == "" {
			safeName += evidenceFileExtension(evidence.MimeType)
		}
		evidenceFileName = safeName
		evidenceFilePath = filepath.Join(evidenceDir, fmt.Sprintf("%s_%s", claimID, safeName))
		evidenceMimeType = strings.TrimSpace(evidence.MimeType)
		if evidenceMimeType == "" {
			evidenceMimeType = mime.TypeByExtension(filepath.Ext(evidenceFileName))
			if evidenceMimeType == "" {
				evidenceMimeType = "application/octet-stream"
			}
		}
		if err := os.WriteFile(evidenceFilePath, evidence.Data, 0o644); err != nil {
			return model.Claim{}, err
		}
		evidenceUploadDate = &now
	}
	priority, priorityNote := s.computeClaimPriority(req.ClaimType, evidence != nil && len(evidence.Data) > 0, shipment, now)
	claim := model.Claim{
		ID:                 claimID,
		TrackingID:         trackingID,
		ClaimType:          req.ClaimType,
		Status:             model.ClaimStatusOpen,
		Description:        description,
		CreatedBy:          createdBy,
		ClaimantDNI:        claimantDNI,
		CreatedAt:          now,
		UpdatedAt:          now,
		AssignedCategory:   "",
		ResolutionType:     "",
		IsAutomatic:        false,
		EvidenceFileName:   evidenceFileName,
		EvidenceFilePath:   evidenceFilePath,
		EvidenceMimeType:   evidenceMimeType,
		EvidenceUploadDate: evidenceUploadDate,
		Priority:           priority,
		PriorityNote:       priorityNote,
	}
	if err := s.claimRepo.Create(claim); err != nil {
		if evidenceFilePath != "" {
			_ = os.Remove(evidenceFilePath)
		}
		return model.Claim{}, err
	}

	rollbackClaim := func() {
		_ = s.claimRepo.Delete(claim.ID)
		if evidenceFilePath != "" {
			_ = os.Remove(evidenceFilePath)
		}
	}

	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimCreated,
		Payload: model.ClaimCreatedPayload{
			ClaimID:   claim.ID,
			ClaimType: claim.ClaimType,
		},
		ChangedBy: createdBy,
		Timestamp: now,
	}); err != nil {
		rollbackClaim()
		return model.Claim{}, err
	}

	if err := s.eventStore.Append(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: trackingID,
		EventType:  model.EventClaimCreated,
		Payload: model.ShipmentClaimCreatedPayload{
			ClaimID:   claim.ID,
			ClaimType: claim.ClaimType,
		},
		ChangedBy: createdBy,
		Timestamp: now,
	}); err != nil {
		rollbackClaim()
		return model.Claim{}, err
	}
	// If the shipment's SLA is already expired, move the claim directly to InReview
	// before sending the notification so the email reflects the actual state.
	if isSLAExpired(shipment, now) {
		updatedAt := now
		if err := s.claimRepo.UpdateStatus(claim.ID, model.ClaimStatusInReview, updatedAt); err != nil {
			return model.Claim{}, err
		}
		if err := s.appendClaimEvent(model.DomainEvent{
			ID:         uuid.NewString(),
			TrackingID: claim.ID,
			EventType:  model.EventClaimInReview,
			Payload: model.ClaimInReviewPayload{
				FromStatus: model.ClaimStatusOpen,
				ToStatus:   model.ClaimStatusInReview,
			},
			ChangedBy: createdBy,
			Timestamp: updatedAt,
		}); err != nil {
			return model.Claim{}, err
		}
		claim.Status = model.ClaimStatusInReview
		claim.UpdatedAt = updatedAt
	}

	if s.claimWASvc != nil {
		go s.claimWASvc.SendClaimCreatedWhatsApp(claim, shipment)
	} else if s.claimEmailSvc != nil {
		go s.claimEmailSvc.SendClaimCreatedNotification(claim, shipment)
	}

	return claim, nil
}

func evidenceFileExtension(mimeType string) string {
	switch {
	case strings.EqualFold(mimeType, "application/pdf"):
		return ".pdf"
	case strings.EqualFold(mimeType, "text/plain"):
		return ".txt"
	case strings.HasPrefix(mimeType, "image/"):
		switch mimeType {
		case "image/jpeg":
			return ".jpg"
		case "image/png":
			return ".png"
		case "image/gif":
			return ".gif"
		case "image/webp":
			return ".webp"
		case "image/bmp":
			return ".bmp"
		default:
			return ".img"
		}
	default:
		return ".bin"
	}
}

func sanitizeEvidenceFileName(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." || base == string(filepath.Separator) {
		return "evidence.txt"
	}
	var builder strings.Builder
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '.' || r == '-' || r == '_':
			builder.WriteRune(r)
		default:
			builder.WriteRune('_')
		}
	}
	cleaned := strings.Trim(builder.String(), "._")
	if cleaned == "" {
		return "evidence.txt"
	}
	return cleaned
}

func (s *ClaimService) GetByID(id string) (model.Claim, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return model.Claim{}, repository.ErrClaimNotFound
	}
	return s.claimRepo.GetByID(id)
}

func (s *ClaimService) GetLatestByTrackingID(trackingID string) (model.Claim, error) {
	trackingID = strings.TrimSpace(trackingID)
	if trackingID == "" {
		return model.Claim{}, repository.ErrClaimNotFound
	}
	return s.claimRepo.GetLatestByTrackingID(trackingID)
}

// GetLatestActiveClaimByTrackingID devuelve el reclamo más reciente no resuelto para un envío.
// Retorna ErrClaimNotFound si no existe o si el único reclamo ya está resuelto.
func (s *ClaimService) GetLatestActiveClaimByTrackingID(trackingID string) (model.Claim, error) {
	claim, err := s.claimRepo.GetLatestByTrackingID(strings.TrimSpace(trackingID))
	if err != nil {
		return model.Claim{}, err
	}
	if strings.HasPrefix(string(claim.Status), "resolved_") {
		return model.Claim{}, repository.ErrClaimNotFound
	}
	return claim, nil
}

// GetLatestActiveClaimByTrackingIDAndDNI devuelve el reclamo activo más reciente
// para un envío cuyo reclamante coincide con el DNI dado.
// Retorna ErrClaimNotFound si no existe tal reclamo o ya está resuelto.
func (s *ClaimService) GetLatestActiveClaimByTrackingIDAndDNI(trackingID, dni string) (model.Claim, error) {
	claim, err := s.claimRepo.GetLatestByTrackingIDAndDNI(strings.TrimSpace(trackingID), strings.TrimSpace(dni))
	if err != nil {
		return model.Claim{}, err
	}
	if strings.HasPrefix(string(claim.Status), "resolved_") {
		return model.Claim{}, repository.ErrClaimNotFound
	}
	return claim, nil
}

func (s *ClaimService) GetByIDForBranch(id, branchID string) (model.Claim, error) {
	claim, err := s.GetByID(id)
	if err != nil {
		return model.Claim{}, err
	}
	if branchID == "" {
		return claim, nil
	}
	// Allow access if the claim is assigned to this branch (transferred).
	if claim.AssignedBranchID == branchID {
		return claim, nil
	}
	shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID)
	if err != nil {
		return model.Claim{}, repository.ErrClaimNotFound
	}
	if shipment.OriginBranchID != branchID {
		return model.Claim{}, ErrClaimForbidden
	}
	return claim, nil
}

func (s *ClaimService) ListByOriginBranch(branchID string) ([]model.Claim, error) {
	claims, err := s.claimRepo.ListAll()
	if err != nil {
		return nil, err
	}
	if branchID == "" {
		return claims, nil
	}

	// Index origin-branch claims.
	filtered := make([]model.Claim, 0, len(claims))
	seen := make(map[string]bool)
	for _, claim := range claims {
		shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID)
		if err != nil {
			continue
		}
		if shipment.OriginBranchID == branchID {
			filtered = append(filtered, claim)
			seen[claim.ID] = true
		}
	}

	// Also include claims currently assigned to this branch (transferred and not yet rejected).
	assigned, err := s.claimRepo.ListByAssignedBranch(branchID)
	if err != nil {
		return nil, err
	}
	for _, claim := range assigned {
		if !seen[claim.ID] {
			filtered = append(filtered, claim)
		}
	}
	return filtered, nil
}

func (s *ClaimService) GetEvents(claimID, branchID string) ([]model.ClaimEvent, error) {
	if _, err := s.GetByIDForBranch(claimID, branchID); err != nil {
		return nil, err
	}
	domainEvents, err := s.claimEventRepo.LoadStream(claimID)
	if err != nil {
		if err == repository.ErrClaimEventStreamNotFound {
			return []model.ClaimEvent{}, nil
		}
		return nil, err
	}
	result := make([]model.ClaimEvent, 0, len(domainEvents))
	for _, de := range domainEvents {
		ce, ok := toClaimEvent(de)
		if ok {
			result = append(result, ce)
		}
	}
	return result, nil
}

func (s *ClaimService) Resolve(id string, resolution model.ClaimResolutionType, changedBy, branchID, notes string) (model.Claim, error) {
	if !model.ValidClaimResolutionTypes[resolution] {
		return model.Claim{}, fmt.Errorf("tipo de resolucion no valido")
	}
	notes = strings.TrimSpace(notes)
	if len(notes) < 15 {
		return model.Claim{}, fmt.Errorf("el comentario debe tener al menos 15 caracteres")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	// Block resolving an already resolved (final) claim or while transferred.
	if isTerminalOrTransferred(claim.Status) {
		return model.Claim{}, fmt.Errorf("reclamo resuelto — operación no permitida")
	}
	status, err := statusForResolution(resolution)
	if err != nil {
		return model.Claim{}, err
	}
	fromStatus := claim.Status
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.Resolve(claim.ID, resolution, status, updatedAt); err != nil {
		return model.Claim{}, err
	}

	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimResolved,
		Payload: model.ClaimResolvedPayload{
			ResolutionType: resolution,
			FromStatus:     fromStatus,
			ToStatus:       status,
			Notes:          notes,
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}

	claim.ResolutionType = resolution
	claim.Status = status
	claim.UpdatedAt = updatedAt

	if s.claimWASvc != nil {
		if shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID); err == nil {
			go s.claimWASvc.SendClaimResolvedWhatsApp(claim, shipment, notes)
		}
	} else if s.claimEmailSvc != nil {
		if shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID); err == nil {
			go s.claimEmailSvc.SendClaimResolvedNotification(claim, shipment, notes)
		}
	}

	return claim, nil
}

func (s *ClaimService) RequestCustomerInfo(id string, changedBy, branchID, notes string) (model.Claim, error) {
	notes = strings.TrimSpace(notes)
	if len(notes) < 15 {
		return model.Claim{}, fmt.Errorf("el comentario debe tener al menos 15 caracteres")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	// Block if already final/resolved or while transferred.
	if isTerminalOrTransferred(claim.Status) {
		return model.Claim{}, fmt.Errorf("reclamo resuelto — operación no permitida")
	}
	fromStatus := claim.Status
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.UpdateStatus(claim.ID, model.ClaimStatusPendingCustomer, updatedAt); err != nil {
		return model.Claim{}, err
	}

	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimPendingCustomer,
		Payload: model.ClaimPendingCustomerPayload{
			Notes:      notes,
			FromStatus: fromStatus,
			ToStatus:   model.ClaimStatusPendingCustomer,
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}

	claim.Status = model.ClaimStatusPendingCustomer
	claim.UpdatedAt = updatedAt

	if s.claimWASvc != nil {
		if shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID); err == nil {
			go s.claimWASvc.SendClaimInfoRequestedWhatsApp(claim, shipment, notes)
		}
	} else if s.claimEmailSvc != nil {
		if shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID); err == nil {
			go s.claimEmailSvc.SendClaimInfoRequestedNotification(claim, shipment, notes)
		}
	}

	return claim, nil
}

func (s *ClaimService) MarkInReview(id string, changedBy, branchID string) (model.Claim, error) {
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	// Permite "tomar" un reclamo abierto (open → in_review) o retomar uno que
	// estaba pendiente del cliente (pending_customer → in_review). Cualquier otro
	// estado (ya en revisión, derivado o resuelto) no es válido.
	if claim.Status != model.ClaimStatusOpen && claim.Status != model.ClaimStatusPendingCustomer {
		return model.Claim{}, fmt.Errorf("solo se puede tomar un reclamo abierto o pendiente del cliente")
	}
	fromStatus := claim.Status
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.UpdateStatus(claim.ID, model.ClaimStatusInReview, updatedAt); err != nil {
		return model.Claim{}, err
	}
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimInReview,
		Payload: model.ClaimInReviewPayload{
			FromStatus: fromStatus,
			ToStatus:   model.ClaimStatusInReview,
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}
	claim.Status = model.ClaimStatusInReview
	claim.UpdatedAt = updatedAt
	return claim, nil
}

// AddComment agrega una nota interna del supervisor al historial del reclamo
// sin cambiar su estado. Pensado para colaboración y seguimiento durante la
// investigación. Permitido en cualquier estado (incluso resuelto) para que la
// trazabilidad quede completa.
func (s *ClaimService) AddComment(id, changedBy, branchID, comment string) (model.Claim, error) {
	comment = strings.TrimSpace(comment)
	if len(comment) < 3 {
		return model.Claim{}, fmt.Errorf("el comentario debe tener al menos 3 caracteres")
	}
	if len(comment) > 1000 {
		return model.Claim{}, fmt.Errorf("el comentario no puede superar los 1000 caracteres")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimComment,
		Payload:    model.ClaimCommentPayload{Comment: comment},
		ChangedBy:  changedBy,
		Timestamp:  clock.Now().UTC(),
	}); err != nil {
		return model.Claim{}, err
	}
	return claim, nil
}

func (s *ClaimService) appendClaimEvent(event model.DomainEvent) error {
	return s.claimEventRepo.Append(event)
}

// computeClaimPriority calcula la prioridad del nuevo reclamo aplicando el
// motor puro y luego, si quedó "urgente", la degrada a "alta" cuando la
// sucursal ya pasó el tope configurable de urgentes abiertos.
//
// Sucursal del reclamo = origin_branch_id del envío. Es la que va a gestionar
// el ticket por defecto (puede transferirse después).
func (s *ClaimService) computeClaimPriority(claimType model.ClaimType, hasEvidence bool, shipment model.Shipment, now time.Time) (model.ClaimPriority, string) {
	cfg := model.DefaultSystemConfig()
	if s.sysConfigSvc != nil {
		cfg = s.sysConfigSvc.Get()
	}
	priority, note := CalculatePriority(
		ClaimPriorityInput{Type: claimType, HasEvidence: hasEvidence},
		ShipmentPriorityInfo{
			Status:               shipment.Status,
			PriorityScore:        shipment.PriorityScore,
			SLAExpired:           isSLAExpired(shipment, now),
			DeliveryAttemptCount: shipment.DeliveryAttempts,
		},
		cfg,
	)
	if priority != model.ClaimPriorityUrgente {
		return priority, note
	}
	// Anti-inflación: si la sucursal ya tiene una proporción de urgentes mayor o
	// igual al cap, degradamos a "alta" y dejamos nota. Si no podemos evaluar
	// (sin sucursal de origen, sin reclamos abiertos, cap <= 0 o error al
	// consultar), permitimos urgente — preferimos un falso urgente a perder
	// señal de un caso real.
	if branchUrgentCapReached(s.claimRepo, cfg, shipment.OriginBranchID) {
		return model.ClaimPriorityAlta, urgentCapNote
	}
	return priority, note
}

// urgentCapNote es la justificación que se anexa al reclamo cuando la regla
// anti-inflación de urgentes degrada un ticket que habría sido urgente. La
// misma constante se usa al crear el reclamo y desde el job de escalado
// automático para que la nota sea idempotente.
const urgentCapNote = "El ticket fue clasificado como alta por tope de urgentes en sucursal."

// branchUrgentCapReached indica si la sucursal ya alcanzó (o superó) el tope
// de urgentes abiertos definido en cfg.UrgentClaimsCapPct. Devuelve false si
// no se puede evaluar (sin sucursal, sin reclamos abiertos, cap <= 0 o error
// al consultar): en esos casos preferimos permitir el urgente para no perder
// señal de casos reales.
func branchUrgentCapReached(claimRepo repository.ClaimRepository, cfg model.SystemConfig, branchID string) bool {
	branchID = strings.TrimSpace(branchID)
	if branchID == "" {
		return false
	}
	capPct := cfg.UrgentClaimsCapPct
	if capPct <= 0 {
		return false
	}
	totalOpen, urgentOpen, err := claimRepo.CountOpenAndUrgentByBranch(branchID)
	if err != nil || totalOpen == 0 {
		return false
	}
	ratio := float64(urgentOpen) / float64(totalOpen)
	return ratio >= capPct
}

func isTerminalOrTransferred(status model.ClaimStatus) bool {
	return status == model.ClaimStatusResolvedOperativa ||
		status == model.ClaimStatusResolvedComercial ||
		status == model.ClaimStatusResolvedRRHH ||
		status == model.ClaimStatusResolvedImprocedente ||
		status == model.ClaimStatusTransferred
}

func (s *ClaimService) notifyBranchSupervisors(branchID string, notifType model.NotificationType, title, body, resourceID string) {
	if s.notifRepo == nil {
		return
	}
	users, err := s.notifRepo.GetUsersByBranchAndRoles(branchID, []model.Role{model.RoleSupervisor})
	if err != nil {
		return
	}
	now := clock.Now().UTC()
	for _, u := range users {
		_ = s.notifRepo.Create(model.Notification{
			ID:         uuid.NewString(),
			UserID:     u.ID,
			Type:       notifType,
			Title:      title,
			Body:       body,
			ResourceID: resourceID,
			CreatedAt:  now,
		})
	}
}

// TransferClaim transfiere un reclamo a otra sucursal. Solo supervisores.
func (s *ClaimService) TransferClaim(id, targetBranchID, changedBy, sourceBranchID, notes string) (model.Claim, error) {
	notes = strings.TrimSpace(notes)
	if len(notes) < 15 {
		return model.Claim{}, fmt.Errorf("el motivo debe tener al menos 15 caracteres")
	}
	targetBranchID = strings.TrimSpace(targetBranchID)
	if targetBranchID == "" {
		return model.Claim{}, fmt.Errorf("sucursal destino requerida")
	}
	if targetBranchID == sourceBranchID {
		return model.Claim{}, fmt.Errorf("no se puede derivar a la misma sucursal")
	}
	claim, err := s.GetByIDForBranch(id, sourceBranchID)
	if err != nil {
		return model.Claim{}, err
	}
	if isTerminalOrTransferred(claim.Status) {
		return model.Claim{}, fmt.Errorf("operación no permitida en el estado actual del reclamo")
	}
	fromStatus := claim.Status
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.UpdateTransferStatus(claim.ID, targetBranchID, model.ClaimStatusTransferred, updatedAt); err != nil {
		return model.Claim{}, err
	}
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimTransferred,
		Payload: model.ClaimTransferredPayload{
			OriginBranchID: sourceBranchID,
			TargetBranchID: targetBranchID,
			FromStatus:     fromStatus,
			ToStatus:       model.ClaimStatusTransferred,
			Notes:          notes,
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}
	claim.Status = model.ClaimStatusTransferred
	claim.AssignedBranchID = targetBranchID
	claim.UpdatedAt = updatedAt

	go s.notifyBranchSupervisors(
		targetBranchID,
		model.NotificationClaimTransferred,
		"Reclamo derivado a su sucursal",
		fmt.Sprintf("El reclamo %s fue derivado a su sucursal. Motivo: %s", claim.ID, notes),
		claim.ID,
	)
	return claim, nil
}

// AcceptTransfer acepta un reclamo transferido. Solo supervisores de la sucursal receptora.
func (s *ClaimService) AcceptTransfer(id, changedBy, branchID string) (model.Claim, error) {
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	if claim.Status != model.ClaimStatusTransferred {
		return model.Claim{}, fmt.Errorf("el reclamo no está en estado derivado")
	}
	if claim.AssignedBranchID != branchID {
		return model.Claim{}, ErrClaimForbidden
	}
	updatedAt := clock.Now().UTC()
	// Keep assigned_branch_id to track that this branch now owns it.
	if err := s.claimRepo.UpdateTransferStatus(claim.ID, branchID, model.ClaimStatusInReview, updatedAt); err != nil {
		return model.Claim{}, err
	}
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimTransferAccepted,
		Payload: model.ClaimTransferAcceptedPayload{
			AssignedBranchID: branchID,
			FromStatus:       model.ClaimStatusTransferred,
			ToStatus:         model.ClaimStatusInReview,
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}
	claim.Status = model.ClaimStatusInReview
	claim.UpdatedAt = updatedAt
	return claim, nil
}

// RejectTransfer rechaza un reclamo transferido. Solo supervisores de la sucursal receptora.
func (s *ClaimService) RejectTransfer(id, changedBy, branchID, notes string) (model.Claim, error) {
	notes = strings.TrimSpace(notes)
	if len(notes) < 15 {
		return model.Claim{}, fmt.Errorf("el motivo debe tener al menos 15 caracteres")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	if claim.Status != model.ClaimStatusTransferred {
		return model.Claim{}, fmt.Errorf("el reclamo no está en estado derivado")
	}
	if claim.AssignedBranchID != branchID {
		return model.Claim{}, ErrClaimForbidden
	}
	originBranchID := claim.AssignedBranchID
	updatedAt := clock.Now().UTC()
	// Clear assigned_branch_id → claim returns to origin branch.
	if err := s.claimRepo.UpdateTransferStatus(claim.ID, "", model.ClaimStatusTransferRejected, updatedAt); err != nil {
		return model.Claim{}, err
	}
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimTransferRejected,
		Payload: model.ClaimTransferRejectedPayload{
			AssignedBranchID: originBranchID,
			FromStatus:       model.ClaimStatusTransferred,
			ToStatus:         model.ClaimStatusTransferRejected,
			Notes:            notes,
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}
	claim.Status = model.ClaimStatusTransferRejected
	claim.AssignedBranchID = ""
	claim.UpdatedAt = updatedAt

	// Notify origin branch supervisors about the rejection.
	shipment, sErr := s.shipmentRepo.GetByTrackingID(claim.TrackingID)
	if sErr == nil {
		go s.notifyBranchSupervisors(
			shipment.OriginBranchID,
			model.NotificationClaimTransferRejected,
			"Reclamo devuelto por la sucursal receptora",
			fmt.Sprintf("El reclamo %s fue rechazado. Nota: %s", claim.ID, notes),
			claim.ID,
		)
	}
	return claim, nil
}

func statusForResolution(resolution model.ClaimResolutionType) (model.ClaimStatus, error) {
	switch resolution {
	case model.ClaimResolutionOperativa:
		return model.ClaimStatusResolvedOperativa, nil
	case model.ClaimResolutionComercial:
		return model.ClaimStatusResolvedComercial, nil
	case model.ClaimResolutionRRHH:
		return model.ClaimStatusResolvedRRHH, nil
	case model.ClaimResolutionImprocedente:
		return model.ClaimStatusResolvedImprocedente, nil
	default:
		return "", fmt.Errorf("tipo de resolucion no valido")
	}
}

func toClaimEvent(de model.DomainEvent) (model.ClaimEvent, bool) {
	base := model.ClaimEvent{
		ID:        de.ID,
		ClaimID:   de.TrackingID,
		EventType: de.EventType,
		ChangedBy: de.ChangedBy,
		Timestamp: de.Timestamp,
	}
	switch de.EventType {
	case model.EventClaimCreated:
		payload := de.Payload.(model.ClaimCreatedPayload)
		base.Notes = fmt.Sprintf("Reclamo %s registrado", payload.ClaimID)
		base.ClaimType = payload.ClaimType
		base.ToStatus = model.ClaimStatusOpen
		return base, true
	case model.EventClaimCategoryUpdated:
		payload := de.Payload.(model.ClaimCategoryUpdatedPayload)
		if strings.TrimSpace(payload.Notes) != "" {
			base.Notes = payload.Notes
		} else {
			base.Notes = fmt.Sprintf("Derivado a %s", payload.AssignedCategory)
		}
		base.AssignedCategory = payload.AssignedCategory
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	case model.EventClaimResolved:
		payload := de.Payload.(model.ClaimResolvedPayload)
		if strings.TrimSpace(payload.Notes) != "" {
			base.Notes = payload.Notes
		} else {
			base.Notes = fmt.Sprintf("Resuelto: %s", payload.ResolutionType)
		}
		base.ResolutionType = payload.ResolutionType
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	case model.EventClaimPendingCustomer:
		payload := de.Payload.(model.ClaimPendingCustomerPayload)
		if strings.TrimSpace(payload.Notes) != "" {
			base.Notes = payload.Notes
		} else {
			base.Notes = "Solicitud de información al cliente"
		}
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	case model.EventClaimInReview:
		payload := de.Payload.(model.ClaimInReviewPayload)
		base.Notes = "Reclamo retomado en revisión"
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	case model.EventClaimCustomerResponded:
		payload := de.Payload.(model.ClaimCustomerRespondedPayload)
		base.Notes = payload.Response
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		base.EvidenceFileName = payload.EvidenceFileName
		base.EvidenceFilePath = payload.EvidenceFilePath
		return base, true
	case model.EventClaimComment:
		payload := de.Payload.(model.ClaimCommentPayload)
		base.Notes = payload.Comment
		return base, true
	case model.EventClaimTransferred:
		payload := de.Payload.(model.ClaimTransferredPayload)
		if strings.TrimSpace(payload.Notes) != "" {
			base.Notes = payload.Notes
		} else {
			base.Notes = fmt.Sprintf("Derivado a sucursal %s", payload.TargetBranchID)
		}
		base.OriginBranchID = payload.OriginBranchID
		base.TargetBranchID = payload.TargetBranchID
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	case model.EventClaimTransferAccepted:
		payload := de.Payload.(model.ClaimTransferAcceptedPayload)
		base.Notes = "Reclamo aceptado por la sucursal"
		base.TargetBranchID = payload.AssignedBranchID
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	case model.EventClaimTransferRejected:
		payload := de.Payload.(model.ClaimTransferRejectedPayload)
		if strings.TrimSpace(payload.Notes) != "" {
			base.Notes = payload.Notes
		} else {
			base.Notes = "Reclamo rechazado por la sucursal receptora"
		}
		base.OriginBranchID = payload.AssignedBranchID
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	default:
		return model.ClaimEvent{}, false
	}
}

// RespondToClaimInfoRequest procesa la respuesta del cliente a un reclamo pending_customer (US-4)
func (s *ClaimService) RespondToClaimInfoRequest(claimID, claimantDNI, responseText string, evidence *ClaimEvidenceUpload) (model.Claim, error) {
	claim, err := s.claimRepo.GetByID(claimID)
	if err != nil {
		return model.Claim{}, fmt.Errorf("reclamo no encontrado")
	}
	if claim.Status != model.ClaimStatusPendingCustomer {
		return model.Claim{}, fmt.Errorf("el reclamo no está esperando respuesta del cliente")
	}
	if strings.TrimSpace(claim.ClaimantDNI) != strings.TrimSpace(claimantDNI) {
		return model.Claim{}, fmt.Errorf("el DNI no coincide con el reclamante")
	}
	responseText = strings.TrimSpace(responseText)
	if len(responseText) < 15 || len(responseText) > 400 {
		return model.Claim{}, fmt.Errorf("la respuesta debe tener entre 15 y 400 caracteres")
	}

	now := clock.Now().UTC()
	var evidenceFileName, evidenceFilePath string
	if evidence != nil && len(evidence.Data) > 0 {
		evidenceDir := filepath.Join("uploads", "claims")
		if err := os.MkdirAll(evidenceDir, 0o755); err != nil {
			return model.Claim{}, err
		}
		safeName := sanitizeEvidenceFileName(evidence.FileName)
		if ext := strings.ToLower(filepath.Ext(safeName)); ext == "" {
			safeName += evidenceFileExtension(evidence.MimeType)
		}
		evidenceFileName = safeName
		evidenceFilePath = filepath.Join(evidenceDir, fmt.Sprintf("%s_resp_%s", claimID, safeName))
		if err := os.WriteFile(evidenceFilePath, evidence.Data, 0o644); err != nil {
			return model.Claim{}, err
		}
	}

	fromStatus := claim.Status
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimCustomerResponded,
		Payload: model.ClaimCustomerRespondedPayload{
			Response:         responseText,
			FromStatus:       fromStatus,
			ToStatus:         model.ClaimStatusInReview,
			EvidenceFileName: evidenceFileName,
			EvidenceFilePath: evidenceFilePath,
		},
		ChangedBy: "chatbot-customer:" + claimantDNI,
		Timestamp: now,
	}); err != nil {
		return model.Claim{}, err
	}

	if err := s.claimRepo.UpdateStatus(claim.ID, model.ClaimStatusInReview, now); err != nil {
		return model.Claim{}, err
	}
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimInReview,
		Payload: model.ClaimInReviewPayload{
			FromStatus: fromStatus,
			ToStatus:   model.ClaimStatusInReview,
		},
		ChangedBy: "chatbot-customer:" + claimantDNI,
		Timestamp: now,
	}); err != nil {
		return model.Claim{}, err
	}

	claim.Status = model.ClaimStatusInReview
	claim.UpdatedAt = now
	return claim, nil
}

func (s *ClaimService) ValidateClaimant(shipment *model.Shipment, fullName, dni string) bool {
	dniTrimmed := strings.TrimSpace(dni)
	// Para reclamos originados en el chatbot el usuario ya fue autenticado; validar solo por DNI.
	if strings.HasPrefix(fullName, "chatbot-sender:") || strings.HasPrefix(fullName, "chatbot-customer:") {
		if dniTrimmed == "" {
			return false
		}
		return strings.TrimSpace(shipment.Sender.DNI) == dniTrimmed ||
			strings.TrimSpace(shipment.Recipient.DNI) == dniTrimmed
	}
	normalizedName := normalizeName(fullName)
	if normalizedName == "" || dniTrimmed == "" {
		return false
	}
	return matchesCustomer(shipment.Sender, normalizedName, dniTrimmed) || matchesCustomer(shipment.Recipient, normalizedName, dniTrimmed)
}

func matchesCustomer(customer model.Customer, normalizedName, dni string) bool {
	if strings.TrimSpace(customer.DNI) == "" || strings.TrimSpace(customer.Name) == "" {
		return false
	}
	return normalizeName(customer.Name) == normalizedName && strings.TrimSpace(customer.DNI) == strings.TrimSpace(dni)
}

func normalizeName(name string) string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(name)))
	return strings.Join(fields, " ")
}

func isDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
