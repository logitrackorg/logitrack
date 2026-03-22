package model

import "time"

type ShipmentComment struct {
	ID         string    `json:"id"`
	TrackingID string    `json:"tracking_id"`
	Author     string    `json:"author"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

type AddCommentRequest struct {
	Body string `json:"body" binding:"required"`
}
