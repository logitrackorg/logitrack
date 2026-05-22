package service

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"strings"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

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

func generateClaimID() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	n := binary.BigEndian.Uint32(b[:])%90000 + 10000
	return fmt.Sprintf("REC-%d", n)
}
