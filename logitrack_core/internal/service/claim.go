package service

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

var ErrClaimForbidden = errors.New("reclamo fuera de sucursal")

type ClaimService struct {
	claimRepo    repository.ClaimRepository
	shipmentRepo repository.ShipmentRepository
}

func NewClaimService(claimRepo repository.ClaimRepository, shipmentRepo repository.ShipmentRepository) *ClaimService {
	return &ClaimService{claimRepo: claimRepo, shipmentRepo: shipmentRepo}
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

	now := clock.Now().UTC()
	claim := model.Claim{
		ID:               generateClaimID(),
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

func (s *ClaimService) UpdateCategory(id string, category model.ClaimCategory, branchID string) (model.Claim, error) {
	if !model.ValidClaimCategories[category] {
		return model.Claim{}, fmt.Errorf("categoria de reclamo no valida")
	}
	claim, err := s.GetByIDForBranch(id, branchID)
	if err != nil {
		return model.Claim{}, err
	}
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.UpdateCategory(claim.ID, category, model.ClaimStatusDerived, updatedAt); err != nil {
		return model.Claim{}, err
	}
	claim.AssignedCategory = category
	claim.Status = model.ClaimStatusDerived
	claim.UpdatedAt = updatedAt
	return claim, nil
}

func (s *ClaimService) Resolve(id string, resolution model.ClaimResolutionType, branchID string) (model.Claim, error) {
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
	updatedAt := clock.Now().UTC()
	if err := s.claimRepo.Resolve(claim.ID, resolution, status, updatedAt); err != nil {
		return model.Claim{}, err
	}
	claim.ResolutionType = resolution
	claim.Status = status
	claim.UpdatedAt = updatedAt
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

func generateClaimID() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	n := binary.BigEndian.Uint32(b[:])%90000 + 10000
	return fmt.Sprintf("REC-%d", n)
}
