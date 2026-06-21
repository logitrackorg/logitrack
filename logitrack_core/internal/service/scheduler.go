package service

import (
	"log"
	"time"
)

// DraftScheduler runs the draft expiration and PII-purge jobs once per day,
// triggered shortly after midnight UTC. No external cron dependency required.
type DraftScheduler struct {
	svc  *DraftLifecycleService
	stop chan struct{}
}

func NewDraftScheduler(svc *DraftLifecycleService) *DraftScheduler {
	return &DraftScheduler{svc: svc, stop: make(chan struct{})}
}

// Start launches the scheduler in a background goroutine.
// It runs the jobs immediately on the first tick and then every 24 hours.
func (s *DraftScheduler) Start() {
	go s.loop()
}

// Stop signals the scheduler goroutine to exit.
func (s *DraftScheduler) Stop() {
	close(s.stop)
}

func (s *DraftScheduler) loop() {
	// Run once at startup (catches any jobs missed while the server was down).
	s.runJobs()

	// Then schedule the next run for tomorrow at 02:00 UTC.
	for {
		next := nextRunAt(time.Now().UTC(), 2, 0)
		delay := time.Until(next)
		log.Printf("[draft-scheduler] next run at %s (in %s)", next.Format(time.RFC3339), delay.Round(time.Second))

		select {
		case <-time.After(delay):
			s.runJobs()
		case <-s.stop:
			log.Println("[draft-scheduler] stopped")
			return
		}
	}
}

func (s *DraftScheduler) runJobs() {
	log.Println("[draft-scheduler] running expiration job")
	s.svc.RunExpirationJob()
	log.Println("[draft-scheduler] running purge job")
	s.svc.RunPurgeJob()
}

// nextRunAt returns the next occurrence of hh:mm UTC that is strictly after now.
func nextRunAt(now time.Time, hour, minute int) time.Time {
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, time.UTC)
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}

// PhotoScheduler runs the photo expiration and purge jobs once per day at 03:00 UTC.
type PhotoScheduler struct {
	svc  *PhotoLifecycleService
	stop chan struct{}
}

func NewPhotoScheduler(svc *PhotoLifecycleService) *PhotoScheduler {
	return &PhotoScheduler{svc: svc, stop: make(chan struct{})}
}

func (s *PhotoScheduler) Start() {
	go s.loop()
}

func (s *PhotoScheduler) Stop() {
	close(s.stop)
}

func (s *PhotoScheduler) loop() {
	s.runJobs()

	for {
		next := nextRunAt(time.Now().UTC(), 3, 0)
		delay := time.Until(next)
		log.Printf("[photo-scheduler] next run at %s (in %s)", next.Format(time.RFC3339), delay.Round(time.Second))

		select {
		case <-time.After(delay):
			s.runJobs()
		case <-s.stop:
			log.Println("[photo-scheduler] stopped")
			return
		}
	}
}

func (s *PhotoScheduler) runJobs() {
	log.Println("[photo-scheduler] running expiration job")
	s.svc.RunExpirationJob()
	log.Println("[photo-scheduler] running purge job")
	s.svc.RunPurgeJob()
}
