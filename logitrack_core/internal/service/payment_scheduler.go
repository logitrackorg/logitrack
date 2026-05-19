package service

import (
	"log"
	"time"
)

// PaymentScheduler runs the payment expiry job every 15 minutes.
type PaymentScheduler struct {
	svc  *PaymentService
	stop chan struct{}
}

func NewPaymentScheduler(svc *PaymentService) *PaymentScheduler {
	return &PaymentScheduler{svc: svc, stop: make(chan struct{})}
}

func (s *PaymentScheduler) Start() {
	go s.loop()
}

func (s *PaymentScheduler) Stop() {
	close(s.stop)
}

func (s *PaymentScheduler) loop() {
	s.runJob()
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.runJob()
		case <-s.stop:
			log.Println("[payment-scheduler] stopped")
			return
		}
	}
}

func (s *PaymentScheduler) runJob() {
	cutoff := time.Now().UTC().Add(-24 * time.Hour)
	s.svc.ExpirePending(cutoff)
}
