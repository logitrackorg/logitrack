// Package service — escalado automático de prioridad de reclamos por
// inactividad. Cuando un reclamo no terminal no recibe updates durante más
// horas que las configuradas en system_config, el job sube su prioridad un
// solo nivel y deja una nota explicativa. Se ejecuta periódicamente desde
// el scheduler (cada 15 min) y también puede dispararse manualmente.
package service

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type ClaimEscalationService struct {
	claimRepo    repository.ClaimRepository
	sysCfgRepo   repository.SystemConfigRepository
	shipmentRepo repository.ShipmentRepository
}

func NewClaimEscalationService(
	claimRepo repository.ClaimRepository,
	sysCfgRepo repository.SystemConfigRepository,
	shipmentRepo repository.ShipmentRepository,
) *ClaimEscalationService {
	return &ClaimEscalationService{
		claimRepo:    claimRepo,
		sysCfgRepo:   sysCfgRepo,
		shipmentRepo: shipmentRepo,
	}
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
		// Anti-inflación: si el próximo nivel es "urgente" y la sucursal ya
		// alcanzó el tope de urgentes abiertos, NO escalamos. Dejamos al
		// reclamo en "alta" y conservamos su UpdatedAt original — no
		// reiniciamos el reloj de inactividad para que el job vuelva a
		// evaluarlo en el próximo tick (cuando el tope ya pueda haber
		// cedido). Anexamos una nota visible una sola vez para que el
		// supervisor sepa por qué no subió.
		if next == model.ClaimPriorityUrgente {
			branchID := s.resolveClaimBranchID(c)
			if branchUrgentCapReached(s.claimRepo, cfg, branchID) {
				s.appendUrgentCapNoteOnce(c)
				log.Printf("[claim-escalation] reclamo %s no escalado a urgente: tope de urgentes alcanzado en sucursal %s",
					c.ID, branchID)
				continue
			}
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

// resolveClaimBranchID devuelve la sucursal del reclamo para el chequeo del
// tope. Preferimos origin_branch_id del envío (la sucursal que genera el
// ticket); si no podemos obtenerla, caemos a assigned_branch_id (sucursal que
// hoy gestiona el reclamo, eventualmente por derivación).
func (s *ClaimEscalationService) resolveClaimBranchID(c model.Claim) string {
	if s.shipmentRepo != nil {
		if sh, err := s.shipmentRepo.GetByTrackingID(c.TrackingID); err == nil {
			if id := strings.TrimSpace(sh.OriginBranchID); id != "" {
				return id
			}
		}
	}
	return strings.TrimSpace(c.AssignedBranchID)
}

// appendUrgentCapNoteOnce anexa la nota de tope al PriorityNote del reclamo
// si todavía no está presente. Garantiza una sola escritura por reclamo, no
// por tick: si ya está la nota, no toca nada (ni siquiera UpdatedAt).
func (s *ClaimEscalationService) appendUrgentCapNoteOnce(c model.Claim) {
	if strings.Contains(c.PriorityNote, urgentCapNote) {
		return
	}
	merged := urgentCapNote
	if strings.TrimSpace(c.PriorityNote) != "" {
		merged = c.PriorityNote + " " + urgentCapNote
	}
	// Conservamos la prioridad y el UpdatedAt original para no reiniciar el
	// reloj de inactividad.
	if err := s.claimRepo.UpdatePriority(c.ID, c.Priority, merged, c.UpdatedAt); err != nil {
		log.Printf("[claim-escalation] error anexando nota de tope al reclamo %s: %v", c.ID, err)
	}
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
