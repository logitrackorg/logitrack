// Package service — escalado automático de prioridad de reclamos por
// inactividad. Cuando un reclamo no terminal no recibe updates durante más
// horas que las configuradas en system_config, el job sube su prioridad un
// solo nivel y deja una nota explicativa. Se ejecuta periódicamente desde
// el scheduler (cada 15 min) y también puede dispararse manualmente.
package service

import (
	"fmt"
	"log"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type ClaimEscalationService struct {
	claimRepo  repository.ClaimRepository
	sysCfgRepo repository.SystemConfigRepository
}

func NewClaimEscalationService(
	claimRepo repository.ClaimRepository,
	sysCfgRepo repository.SystemConfigRepository,
) *ClaimEscalationService {
	return &ClaimEscalationService{claimRepo: claimRepo, sysCfgRepo: sysCfgRepo}
}

// Run evalúa todos los reclamos no terminales y sube un solo nivel de
// prioridad a los que superaron el umbral de horas configurado. Devuelve la
// cantidad de reclamos efectivamente escalados.
func (s *ClaimEscalationService) Run() (escalated int, err error) {
	cfg := s.sysCfgRepo.Get()
	if !cfg.ClaimEscalationEnabled {
		return 0, nil
	}

	claims, err := s.claimRepo.ListNonTerminal()
	if err != nil {
		return 0, fmt.Errorf("listando reclamos no terminales: %w", err)
	}

	now := clock.Now()
	for _, c := range claims {
		next, thresholdDays := nextEscalationStep(c.Priority, cfg)
		if next == "" {
			continue
		}
		inactiveFor := now.Sub(c.UpdatedAt)
		if inactiveFor < time.Duration(thresholdDays)*24*time.Hour {
			continue
		}
		note := fmt.Sprintf("Escalado automático: sin actividad por más de %d %s.",
			thresholdDays, pluralDay(thresholdDays))
		if err := s.claimRepo.UpdatePriority(c.ID, next, note, now); err != nil {
			log.Printf("[claim-escalation] error escalando reclamo %s: %v", c.ID, err)
			continue
		}
		escalated++
		log.Printf("[claim-escalation] reclamo %s escalado: %s → %s (inactivo %s)",
			c.ID, c.Priority, next, inactiveFor.Round(time.Minute))
	}
	return escalated, nil
}

// nextEscalationStep devuelve el siguiente nivel de prioridad y el umbral en
// días que aplica para escalar desde el nivel actual. Si no hay siguiente
// (urgente, o prioridad desconocida) devuelve "" y 0.
func nextEscalationStep(current model.ClaimPriority, cfg model.SystemConfig) (model.ClaimPriority, int) {
	switch current {
	case model.ClaimPriorityBaja:
		return model.ClaimPriorityMedia, cfg.ClaimEscalationBajaDays
	case model.ClaimPriorityMedia:
		return model.ClaimPriorityAlta, cfg.ClaimEscalationMediaDays
	case model.ClaimPriorityAlta:
		return model.ClaimPriorityUrgente, cfg.ClaimEscalationAltaDays
	default:
		return "", 0
	}
}

func pluralDay(n int) string {
	if n == 1 {
		return "día"
	}
	return "días"
}
