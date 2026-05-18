package service

import (
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// DraftLifecycleService implements the draft lifecycle management described in the
// "Gestión del ciclo de vida y tratamiento de datos personales" user story:
//
//   - CA-01: Nightly expiration job — drafts older than DraftRetentionDays → "expired"
//   - CA-02: Nightly purge job — PII anonymized after DraftPurgeDays post-expiration
//   - CA-03: Audit trail for every lifecycle event
//   - CA-04: On-demand PII suppression by DNI (ARCO right to erasure)
type DraftLifecycleService struct {
	repo      repository.DraftLifecycleRepository
	configSvc *SystemConfigService
}

func NewDraftLifecycleService(
	repo repository.DraftLifecycleRepository,
	configSvc *SystemConfigService,
) *DraftLifecycleService {
	return &DraftLifecycleService{repo: repo, configSvc: configSvc}
}

// RunExpirationJob expires all drafts older than the configured retention period.
// Intended to be called by the nightly scheduler.
func (s *DraftLifecycleService) RunExpirationJob() {
	cfg := s.configSvc.Get()
	cutoff := clock.Now().UTC().AddDate(0, 0, -cfg.DraftRetentionDays)

	ids, err := s.repo.ExpireDrafts(cutoff)
	if err != nil {
		log.Printf("[draft-lifecycle] expiration job failed: %v", err)
		return
	}
	if len(ids) == 0 {
		log.Printf("[draft-lifecycle] expiration job: no drafts to expire")
		return
	}

	log.Printf("[draft-lifecycle] expiration job: expired %d draft(s)", len(ids))
	for _, id := range ids {
		_ = s.repo.AppendAuditLog(model.DraftAuditEntry{
			ID:          uuid.NewString(),
			TrackingID:  id,
			Action:      model.DraftAuditExpired,
			PerformedBy: "system",
			Timestamp:   clock.Now().UTC(),
			Details: map[string]string{
				"retention_days": fmt.Sprintf("%d", cfg.DraftRetentionDays),
			},
		})
	}
}

// RunPurgeJob anonymizes PII in expired drafts whose expiration date is older than
// the configured purge window. Intended to be called by the nightly scheduler.
func (s *DraftLifecycleService) RunPurgeJob() {
	cfg := s.configSvc.Get()
	purgeCutoff := clock.Now().UTC().AddDate(0, 0, -cfg.DraftPurgeDays)

	ids, err := s.repo.PurgeDraftPII(purgeCutoff)
	if err != nil {
		log.Printf("[draft-lifecycle] purge job failed: %v", err)
		return
	}
	if len(ids) == 0 {
		log.Printf("[draft-lifecycle] purge job: no drafts to purge")
		return
	}

	log.Printf("[draft-lifecycle] purge job: purged PII from %d draft(s)", len(ids))
	for _, id := range ids {
		_ = s.repo.AppendAuditLog(model.DraftAuditEntry{
			ID:          uuid.NewString(),
			TrackingID:  id,
			Action:      model.DraftAuditPIIPurged,
			PerformedBy: "system",
			Timestamp:   clock.Now().UTC(),
			Details: map[string]string{
				"purge_days": fmt.Sprintf("%d", cfg.DraftPurgeDays),
			},
		})
	}
}

// SuppressByDNI locates all active/expired drafts containing the given DNI and
// immediately anonymizes their PII. This satisfies CA-04 (ARCO right to erasure).
// Returns the number of drafts suppressed.
func (s *DraftLifecycleService) SuppressByDNI(dni, performedBy string) (int, error) {
	if dni == "" {
		return 0, fmt.Errorf("DNI requerido")
	}

	drafts, err := s.repo.FindDraftsByDNI(dni)
	if err != nil {
		return 0, fmt.Errorf("error al buscar borradores: %w", err)
	}

	suppressed := 0
	for _, d := range drafts {
		if err := s.repo.SuppressPII(d.TrackingID); err != nil {
			log.Printf("[draft-lifecycle] suppress PII failed for %s: %v", d.TrackingID, err)
			continue
		}
		_ = s.repo.AppendAuditLog(model.DraftAuditEntry{
			ID:          uuid.NewString(),
			TrackingID:  d.TrackingID,
			Action:      model.DraftAuditSuppressed,
			PerformedBy: performedBy,
			Timestamp:   clock.Now().UTC(),
			Details:     map[string]string{"dni": dni},
		})
		suppressed++
	}
	return suppressed, nil
}

// FindDraftsByDNI returns all drafts (active or expired, with PII intact) that
// reference the given DNI. Used by the admin to preview before suppression.
func (s *DraftLifecycleService) FindDraftsByDNI(dni string) ([]model.Shipment, error) {
	if dni == "" {
		return nil, fmt.Errorf("DNI requerido")
	}
	return s.repo.FindDraftsByDNI(dni)
}

// GetAuditLog returns the audit trail for a specific draft (CA-03).
func (s *DraftLifecycleService) GetAuditLog(trackingID string) ([]model.DraftAuditEntry, error) {
	return s.repo.ListAuditLog(trackingID)
}

// GetAllAuditLog returns the full audit trail (admin view, CA-03 / ARCO export).
func (s *DraftLifecycleService) GetAllAuditLog() ([]model.DraftAuditEntry, error) {
	return s.repo.ListAllAuditLog()
}
