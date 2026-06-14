package service

import (
	"errors"
	"fmt"
	"mime"
	"os"
	"path/filepath"
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

func (s *ClaimService) CreatePublicClaim(req model.CreatePublicClaimRequest, evidence *ClaimEvidenceUpload) (model.Claim, error) {
	trackingID := strings.TrimSpace(req.TrackingID)
	if trackingID == "" {
		return model.Claim{}, fmt.Errorf("tracking_id es requerido")
	}
	shipment, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Claim{}, fmt.Errorf("envio no encontrado")
	}
	if !model.ValidClaimTypes[req.ClaimType] {
		return model.Claim{}, fmt.Errorf("tipo de reclamo no valido")
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

func (s *ClaimService) UpdateCategory(id string, category model.ClaimCategory, changedBy, branchID, notes string) (model.Claim, error) {
	if !model.ValidClaimCategories[category] {
		return model.Claim{}, fmt.Errorf("categoria de reclamo no valida")
	}
	notes = strings.TrimSpace(notes)
	if len(notes) < 15 {
		return model.Claim{}, fmt.Errorf("el comentario debe tener al menos 15 caracteres")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	// Block operations on already resolved (final) claims or while transferred.
	if isTerminalOrTransferred(claim.Status) {
		return model.Claim{}, fmt.Errorf("reclamo resuelto — operación no permitida")
	}
	fromStatus := claim.Status
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.UpdateCategory(claim.ID, category, model.ClaimStatusDerived, updatedAt); err != nil {
		return model.Claim{}, err
	}

	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimCategoryUpdated,
		Payload: model.ClaimCategoryUpdatedPayload{
			AssignedCategory: category,
			FromStatus:       fromStatus,
			ToStatus:         model.ClaimStatusDerived,
			Notes:            notes,
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}

	claim.AssignedCategory = category
	claim.Status = model.ClaimStatusDerived
	claim.UpdatedAt = updatedAt
	return claim, nil
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
	if claim.Status != model.ClaimStatusPendingCustomer {
		return model.Claim{}, fmt.Errorf("solo se puede pasar a revision desde pendiente del cliente")
	}
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.UpdateStatus(claim.ID, model.ClaimStatusInReview, updatedAt); err != nil {
		return model.Claim{}, err
	}
	if err := s.appendClaimEvent(model.DomainEvent{
		ID:         uuid.NewString(),
		TrackingID: claim.ID,
		EventType:  model.EventClaimInReview,
		Payload: model.ClaimInReviewPayload{
			FromStatus: claim.Status,
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

func (s *ClaimService) appendClaimEvent(event model.DomainEvent) error {
	return s.claimEventRepo.Append(event)
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
