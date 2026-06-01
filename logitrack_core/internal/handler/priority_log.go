package handler

import (
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// PriorityLogHandler exposes the automatic SLA reprioritisation audit log to
// supervisors and managers. The base data is the append-only JSON file written
// by SLAAnomalyService (data/priority_logs.json); each entry is enriched with
// shipment context (sender, receiver, city, branch) so the frontend can filter.
type PriorityLogHandler struct {
	repo         *repository.PriorityLogRepository
	shipmentRepo repository.ShipmentRepository
	branchRepo   repository.BranchRepository
}

func NewPriorityLogHandler(
	repo *repository.PriorityLogRepository,
	shipmentRepo repository.ShipmentRepository,
	branchRepo repository.BranchRepository,
) *PriorityLogHandler {
	return &PriorityLogHandler{
		repo:         repo,
		shipmentRepo: shipmentRepo,
		branchRepo:   branchRepo,
	}
}

// enrichedPriorityLog augments a stored PriorityLog with shipment context.
// The embedded PriorityLog flattens its fields (tracking_id, timestamp, etc.)
// into the same JSON object alongside the enrichment fields.
type enrichedPriorityLog struct {
	model.PriorityLog
	SenderName      string `json:"sender_name"`
	ReceiverName    string `json:"receiver_name"`
	OriginCity      string `json:"origin_city"`
	CurrentBranch   string `json:"current_branch"`    // display name (resolved)
	CurrentBranchID string `json:"current_branch_id"` // stable id for filtering
}

// List returns all priority-escalation entries, newest first, each enriched
// with the associated shipment's sender, receiver, origin city and branch.
// If the log file does not exist yet, an empty array is returned (not an error).
func (h *PriorityLogHandler) List(c *gin.Context) {
	entries := h.repo.ListAll()
	if entries == nil {
		entries = []model.PriorityLog{}
	}

	// Newest first.
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Timestamp.After(entries[j].Timestamp)
	})

	// Per-request caches: the same tracking ID can appear in multiple escalation
	// events, and many shipments share a branch — avoid redundant lookups.
	shipmentCache := map[string]*model.Shipment{}
	branchNameCache := map[string]string{}

	resolveBranchName := func(id string) string {
		if id == "" {
			return ""
		}
		if n, ok := branchNameCache[id]; ok {
			return n
		}
		name := id // fallback to the raw id when the branch is unknown
		if b, ok := h.branchRepo.GetByID(id); ok {
			name = b.Name
		}
		branchNameCache[id] = name
		return name
	}

	out := make([]enrichedPriorityLog, 0, len(entries))
	for _, e := range entries {
		enr := enrichedPriorityLog{PriorityLog: e}

		sh, looked := shipmentCache[e.TrackingID]
		if !looked {
			if s, err := h.shipmentRepo.GetByTrackingID(e.TrackingID); err == nil {
				sh = &s
			}
			shipmentCache[e.TrackingID] = sh // may store nil (not found) on purpose
		}
		if sh != nil {
			enr.SenderName = sh.Sender.Name
			enr.ReceiverName = sh.Recipient.Name
			enr.OriginCity = sh.Sender.Address.City
			// ReceivingBranchID is the branch currently responsible for the
			// shipment; fall back to CurrentLocation when not set.
			branchID := sh.ReceivingBranchID
			if branchID == "" {
				branchID = sh.CurrentLocation
			}
			enr.CurrentBranchID = branchID
			enr.CurrentBranch = resolveBranchName(branchID)
		}
		out = append(out, enr)
	}

	c.JSON(http.StatusOK, gin.H{"logs": out, "total": len(out)})
}
