package service

import (
	"log"
	"time"
)

// ClaimEscalationScheduler corre ClaimEscalationService.Run() cada 15 minutos
// en una goroutine. Sigue el mismo patrón liviano que DraftScheduler:
// ticker puro, sin dependencia externa de cron.
type ClaimEscalationScheduler struct {
	svc      *ClaimEscalationService
	interval time.Duration
	stop     chan struct{}
}

func NewClaimEscalationScheduler(svc *ClaimEscalationService) *ClaimEscalationScheduler {
	return &ClaimEscalationScheduler{
		svc:      svc,
		interval: 15 * time.Minute,
		stop:     make(chan struct{}),
	}
}

// Start lanza el scheduler en background. Corre una primera vez al arrancar
// para barrer reclamos acumulados mientras el server estuvo caído, y luego
// cada `interval`.
func (s *ClaimEscalationScheduler) Start() {
	go s.loop()
}

// Stop señala a la goroutine que termine.
func (s *ClaimEscalationScheduler) Stop() {
	close(s.stop)
}

func (s *ClaimEscalationScheduler) loop() {
	s.runOnce()
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.runOnce()
		case <-s.stop:
			log.Println("[claim-escalation-scheduler] detenido")
			return
		}
	}
}

func (s *ClaimEscalationScheduler) runOnce() {
	n, err := s.svc.Run()
	if err != nil {
		log.Printf("[claim-escalation-scheduler] error: %v", err)
		return
	}
	if n > 0 {
		log.Printf("[claim-escalation-scheduler] %d reclamo(s) escalado(s)", n)
	}
}
