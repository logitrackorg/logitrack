package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type CommentService struct {
	commentRepo  repository.CommentRepository
	shipmentRepo repository.ShipmentRepository
}

func NewCommentService(commentRepo repository.CommentRepository, shipmentRepo repository.ShipmentRepository) *CommentService {
	return &CommentService{commentRepo: commentRepo, shipmentRepo: shipmentRepo}
}

func (s *CommentService) AddComment(trackingID, author, body string) (model.ShipmentComment, error) {
	shipment, err := s.shipmentRepo.GetByTrackingID(trackingID)
	if err != nil {
		return model.ShipmentComment{}, fmt.Errorf("envío no encontrado")
	}
	if shipment.Status == model.StatusDelivered || shipment.Status == model.StatusReturned {
		return model.ShipmentComment{}, fmt.Errorf("no se pueden agregar comentarios a un envío finalizado")
	}
	if strings.TrimSpace(body) == "" {
		return model.ShipmentComment{}, fmt.Errorf("el comentario no puede estar vacío")
	}
	comment := model.ShipmentComment{
		ID:         uuid.NewString(),
		TrackingID: trackingID,
		Author:     author,
		Body:       body,
		CreatedAt:  time.Now().UTC(),
	}
	if err := s.commentRepo.AddComment(comment); err != nil {
		return model.ShipmentComment{}, err
	}
	return comment, nil
}

func (s *CommentService) GetComments(trackingID string) ([]model.ShipmentComment, error) {
	if _, err := s.shipmentRepo.GetByTrackingID(trackingID); err != nil {
		return nil, fmt.Errorf("envío no encontrado")
	}
	return s.commentRepo.GetComments(trackingID)
}
