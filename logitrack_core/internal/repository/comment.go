package repository

import "github.com/logitrack/core/internal/model"

type CommentRepository interface {
	AddComment(comment model.ShipmentComment) error
	GetComments(trackingID string) ([]model.ShipmentComment, error)
}
