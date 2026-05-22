package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

var ErrClaimForbidden = errors.New("reclamo fuera de sucursal")

type ClaimService struct {
	claimRepo      repository.ClaimRepository
	claimEventRepo repository.ClaimEventRepository
	shipmentRepo   repository.ShipmentRepository
	eventStore     repository.EventStore
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

func (s *ClaimService) CreatePublicClaim(req model.CreatePublicClaimRequest) (model.Claim, error) {
	trackingID := strings.TrimSpace(req.TrackingID)
	if trackingID == "" {
		return model.Claim{}, fmt.Errorf("tracking_id es requerido")
	}
	if _, err := s.shipmentRepo.GetByTrackingID(trackingID); err != nil {
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

	claimID, err := s.claimRepo.NextID()
	if err != nil {
		return model.Claim{}, err
	}

	now := clock.Now().UTC()
	claim := model.Claim{
		ID:               claimID,
		TrackingID:       trackingID,
		ClaimType:        req.ClaimType,
		Status:           model.ClaimStatusOpen,
		Description:      description,
		CreatedBy:        createdBy,
		CreatedAt:        now,
		UpdatedAt:        now,
		AssignedCategory: "",
		ResolutionType:   "",
		IsAutomatic:      false,
	}
	if err := s.claimRepo.Create(claim); err != nil {
		return model.Claim{}, err
	}

	rollbackClaim := func() {
		_ = s.claimRepo.Delete(claim.ID)
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

	return claim, nil
}

func (s *ClaimService) GetByID(id string) (model.Claim, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return model.Claim{}, repository.ErrClaimNotFound
	}
	return s.claimRepo.GetByID(id)
}

func (s *ClaimService) GetByIDForBranch(id, branchID string) (model.Claim, error) {
	claim, err := s.GetByID(id)
	if err != nil {
		return model.Claim{}, err
	}
	if branchID == "" {
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
	filtered := make([]model.Claim, 0, len(claims))
	for _, claim := range claims {
		shipment, err := s.shipmentRepo.GetByTrackingID(claim.TrackingID)
		if err != nil {
			continue
		}
		if shipment.OriginBranchID == branchID {
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

func (s *ClaimService) UpdateCategory(id string, category model.ClaimCategory, changedBy, branchID string) (model.Claim, error) {
	if !model.ValidClaimCategories[category] {
		return model.Claim{}, fmt.Errorf("categoria de reclamo no valida")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
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

func (s *ClaimService) Resolve(id string, resolution model.ClaimResolutionType, changedBy, branchID string) (model.Claim, error) {
	if !model.ValidClaimResolutionTypes[resolution] {
		return model.Claim{}, fmt.Errorf("tipo de resolucion no valido")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
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
		},
		ChangedBy: changedBy,
		Timestamp: updatedAt,
	}); err != nil {
		return model.Claim{}, err
	}

	claim.ResolutionType = resolution
	claim.Status = status
	claim.UpdatedAt = updatedAt
	return claim, nil
}

func (s *ClaimService) appendClaimEvent(event model.DomainEvent) error {
	return s.claimEventRepo.Append(event)
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
		base.Notes = fmt.Sprintf("Derivado a %s", payload.AssignedCategory)
		base.AssignedCategory = payload.AssignedCategory
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	case model.EventClaimResolved:
		payload := de.Payload.(model.ClaimResolvedPayload)
		base.Notes = fmt.Sprintf("Resuelto: %s", payload.ResolutionType)
		base.ResolutionType = payload.ResolutionType
		base.FromStatus = payload.FromStatus
		base.ToStatus = payload.ToStatus
		return base, true
	default:
		return model.ClaimEvent{}, false
	}
}
