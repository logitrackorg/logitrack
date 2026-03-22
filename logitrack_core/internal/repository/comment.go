package repository

import (
	"sort"
	"sync"

	"github.com/logitrack/core/internal/model"
)

type CommentRepository interface {
	AddComment(comment model.ShipmentComment) error
	GetComments(trackingID string) ([]model.ShipmentComment, error)
}

type inMemoryCommentRepository struct {
	mu       sync.RWMutex
	comments map[string][]model.ShipmentComment // keyed by trackingID
}

func NewInMemoryCommentRepository() CommentRepository {
	return &inMemoryCommentRepository{
		comments: make(map[string][]model.ShipmentComment),
	}
}

func (r *inMemoryCommentRepository) AddComment(comment model.ShipmentComment) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.comments[comment.TrackingID] = append(r.comments[comment.TrackingID], comment)
	return nil
}

func (r *inMemoryCommentRepository) GetComments(trackingID string) ([]model.ShipmentComment, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	comments := r.comments[trackingID]
	result := make([]model.ShipmentComment, len(comments))
	copy(result, comments)
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}
