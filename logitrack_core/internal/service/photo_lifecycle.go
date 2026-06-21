package service

import (
	"log"
	"os"
	"time"

	"github.com/logitrack/core/internal/repository"
)

// PhotoLifecycleService manages the two-phase lifecycle of delivery evidence photos.
//
// Phase 1 — Expiry: after PhotoRetentionDays since delivery, the photo endpoint
// returns 410 Gone even if the file is still on disk.
//
// Phase 2 — Purge: after PhotoPurgeDays since expiry, the file is physically
// deleted and the path is cleared from the event payload.
type PhotoLifecycleService struct {
	repo      repository.PhotoLifecycleRepository
	configSvc *SystemConfigService
}

func NewPhotoLifecycleService(repo repository.PhotoLifecycleRepository, configSvc *SystemConfigService) *PhotoLifecycleService {
	return &PhotoLifecycleService{repo: repo, configSvc: configSvc}
}

// RunExpirationJob marks delivery photos as expired when the retention window
// since delivered_at has elapsed.
func (s *PhotoLifecycleService) RunExpirationJob() {
	cfg := s.configSvc.Get()
	cutoff := time.Now().AddDate(0, 0, -cfg.PhotoRetentionDays)
	ids, err := s.repo.ExpirePhotos(cutoff)
	if err != nil {
		log.Printf("[photo-lifecycle] expiration job error: %v", err)
		return
	}
	if len(ids) > 0 {
		log.Printf("[photo-lifecycle] expired %d delivery photo(s): %v", len(ids), ids)
	}
}

// RunPurgeJob physically deletes photo files and clears their paths for all
// shipments whose photo_expired_at is older than PhotoPurgeDays.
func (s *PhotoLifecycleService) RunPurgeJob() {
	cfg := s.configSvc.Get()
	cutoff := time.Now().AddDate(0, 0, -cfg.PhotoPurgeDays)
	records, err := s.repo.FindPhotosToPurge(cutoff)
	if err != nil {
		log.Printf("[photo-lifecycle] purge job query error: %v", err)
		return
	}

	purged := 0
	for _, rec := range records {
		if rec.PhotoPath != "" {
			if rmErr := os.Remove(rec.PhotoPath); rmErr != nil && !os.IsNotExist(rmErr) {
				log.Printf("[photo-lifecycle] could not delete %s: %v", rec.PhotoPath, rmErr)
			}
		}
		if err := s.repo.MarkPhotoPurged(rec.TrackingID); err != nil {
			log.Printf("[photo-lifecycle] could not mark %s as purged: %v", rec.TrackingID, err)
			continue
		}
		purged++
		log.Printf("[photo-lifecycle] purged photo for %s", rec.TrackingID)
	}
	if purged > 0 {
		log.Printf("[photo-lifecycle] purge job completed: %d photo(s) deleted", purged)
	}
}
