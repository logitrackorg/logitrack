package service

import (
	"strings"
	"testing"

	"github.com/logitrack/core/internal/model"
)

func TestAddComment_ShipmentNotFound(t *testing.T) {
	ts := newSetup()
	_, err := ts.commentSvc.AddComment("LT-NOTEXIST", "supervisor", "hello")
	if err == nil || !strings.Contains(err.Error(), "shipment not found") {
		t.Errorf("expected shipment-not-found error, got: %v", err)
	}
}

func TestAddComment_FinalizedShipments(t *testing.T) {
	tests := []struct {
		name  string
		setup func(ts testSetup) string
	}{
		{
			name: "delivered",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				toInTransit(t, ts, ship.TrackingID)
				toAtBranch(t, ts, ship.TrackingID)
				toDelivering(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusDelivered, ChangedBy: "driver",
					RecipientDNI: defaultRecipient().DNI,
				})
				return ship.TrackingID
			},
		},
		{
			name: "returned",
			setup: func(ts testSetup) string {
				ship := mustCreate(t, ts)
				advanceToReadyForReturn(t, ts, ship.TrackingID)
				mustStatus(t, ts, ship.TrackingID, model.UpdateStatusRequest{
					Status: model.StatusReturned, ChangedBy: "supervisor",
					SenderDNI: defaultSender().DNI,
				})
				return ship.TrackingID
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ts := newSetup()
			id := tc.setup(ts)
			_, err := ts.commentSvc.AddComment(id, "supervisor", "late comment")
			if err == nil || !strings.Contains(err.Error(), "cannot add comments to a finalized shipment") {
				t.Errorf("expected finalized-shipment error for %s, got: %v", tc.name, err)
			}
		})
	}
}

func TestAddComment_EmptyBodyRejected(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	_, err := ts.commentSvc.AddComment(ship.TrackingID, "supervisor", "   ")
	if err == nil || !strings.Contains(err.Error(), "comment body is required") {
		t.Errorf("expected empty-body error, got: %v", err)
	}
}

func TestAddComment_Success(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	comment, err := ts.commentSvc.AddComment(ship.TrackingID, "supervisor", "package looks fine")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if comment.TrackingID != ship.TrackingID {
		t.Errorf("comment.TrackingID = %q, want %q", comment.TrackingID, ship.TrackingID)
	}
	if comment.Author != "supervisor" {
		t.Errorf("author = %q, want supervisor", comment.Author)
	}
	if comment.ID == "" {
		t.Error("comment ID should not be empty")
	}
}

func TestAddComment_AllowedOnCancelledShipment(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)
	ts.svc.CancelShipment(ship.TrackingID, "supervisor", "test reason")

	// cancelled is NOT in the finalized check — comments are allowed
	_, err := ts.commentSvc.AddComment(ship.TrackingID, "supervisor", "post-cancel note")
	if err != nil {
		t.Errorf("comments on cancelled shipments should be allowed, got: %v", err)
	}
}

func TestGetComments_ShipmentNotFound(t *testing.T) {
	ts := newSetup()
	_, err := ts.commentSvc.GetComments("LT-NOTEXIST")
	if err == nil || !strings.Contains(err.Error(), "shipment not found") {
		t.Errorf("expected shipment-not-found error, got: %v", err)
	}
}

func TestGetComments_ReturnsNewestFirst(t *testing.T) {
	ts := newSetup()
	ship := mustCreate(t, ts)

	ts.commentSvc.AddComment(ship.TrackingID, "supervisor", "first comment")
	ts.commentSvc.AddComment(ship.TrackingID, "supervisor", "second comment")
	ts.commentSvc.AddComment(ship.TrackingID, "supervisor", "third comment")

	comments, err := ts.commentSvc.GetComments(ship.TrackingID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(comments) != 3 {
		t.Fatalf("expected 3 comments, got %d", len(comments))
	}
	// sorted DESC by created_at — newest first
	if !comments[0].CreatedAt.After(comments[1].CreatedAt) && !comments[0].CreatedAt.Equal(comments[1].CreatedAt) {
		t.Error("comments should be sorted newest-first")
	}
}
