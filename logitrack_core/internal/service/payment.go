package service

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/mercadopago"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// PaymentService orchestrates the payment lifecycle for shipments:
// request (draft → pending_payment), webhook confirmation (pending_payment → at_origin_hub),
// and revert (pending_payment → draft).
type PaymentService struct {
	paymentRepo repository.PaymentRepository
	shipmentSvc *ShipmentService
	mp          *mercadopago.Client
}

func NewPaymentService(
	paymentRepo repository.PaymentRepository,
	shipmentSvc *ShipmentService,
	mp *mercadopago.Client,
) *PaymentService {
	return &PaymentService{
		paymentRepo: paymentRepo,
		shipmentSvc: shipmentSvc,
		mp:          mp,
	}
}

// RequestPayment validates the draft, seals price + priority, creates a MP preference
// (or a mock when MP is not configured), transitions to pending_payment and returns the Payment.
// When MP is not configured, init_point is empty — the frontend shows only the simulate button.
func (s *PaymentService) RequestPayment(trackingID, username string) (model.Payment, error) {
	draft, err := s.shipmentSvc.repo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Payment{}, fmt.Errorf("envío no encontrado: %w", err)
	}
	if draft.Status != model.StatusDraft {
		return model.Payment{}, fmt.Errorf("solo se pueden iniciar pagos para envíos en borrador")
	}

	// Validate + resolve defaults (same rules as ConfirmDraft).
	if err := s.shipmentSvc.validateDraftReadyToConfirm(&draft); err != nil {
		return model.Payment{}, err
	}

	// Use the price already sealed at confirmation; only compute if missing.
	if draft.Price == nil || *draft.Price <= 0 {
		s.shipmentSvc.applyPrice(&draft)
	}
	if draft.Price == nil || *draft.Price <= 0 {
		return model.Payment{}, fmt.Errorf("no se pudo calcular el precio del envío")
	}

	// Seal ML priority.
	var prediction *model.PriorityPrediction
	if s.shipmentSvc.mlClient != nil {
		prediction = s.shipmentSvc.mlClient.PredictFromShipment(draft)
	}

	// Persist the sealed price + priority back onto the draft before transitioning.
	draft.UpdatedAt = clock.Now().UTC()
	if _, err := s.shipmentSvc.repo.UpdateDraft(repository.UpdateDraftCmd{Shipment: draft}); err != nil {
		return model.Payment{}, fmt.Errorf("error al actualizar datos del borrador: %w", err)
	}
	if prediction != nil {
		setPriority(&draft, prediction)
	}

	currency := draft.PriceCurrency
	if currency == "" {
		currency = model.CurrencyARS
	}

	var preferenceID, initPoint string

	if os.Getenv("MP_ENABLED") == "true" && s.mp != nil && s.mp.IsConfigured() {
		// Production/sandbox: create a real MP preference.
		mpResp, err := s.mp.CreatePreference(trackingID, *draft.Price, currency)
		if err != nil {
			return model.Payment{}, fmt.Errorf("error al crear preferencia de pago: %w", err)
		}
		preferenceID = mpResp.ID
		initPoint = mpResp.InitPoint
	} else {
		// Dev mode: mock preference — init_point vacío indica al frontend que use simulación.
		preferenceID = "MOCK-" + uuid.NewString()[:8]
		initPoint = ""
		log.Printf("[payment] modo mock activo — usando preferencia simulada %s", preferenceID)
	}

	now := clock.Now().UTC()
	paymentID := uuid.NewString()
	payment := model.Payment{
		ID:             paymentID,
		TrackingID:     trackingID,
		MPPreferenceID: preferenceID,
		InitPoint:      initPoint,
		Amount:         *draft.Price,
		Currency:       currency,
		Status:         model.PaymentStatusPending,
		CreatedAt:      now,
	}

	if err := s.paymentRepo.Create(payment); err != nil {
		return model.Payment{}, fmt.Errorf("error al guardar pago: %w", err)
	}

	// Transition draft → pending_payment.
	if _, err := s.shipmentSvc.repo.RequestPayment(repository.RequestPaymentCmd{
		Shipment:       draft,
		PaymentID:      paymentID,
		MPPreferenceID: preferenceID,
		InitPoint:      initPoint,
		Amount:         *draft.Price,
		Currency:       currency,
		ChangedBy:      username,
		Timestamp:      now,
	}); err != nil {
		return model.Payment{}, fmt.Errorf("error al transicionar a pending_payment: %w", err)
	}

	return payment, nil
}

// HandleWebhook processes a Mercado Pago webhook notification.
// It is idempotent: if the mp_payment_id was already processed, it returns nil.
func (s *PaymentService) HandleWebhook(mpPaymentID string, rawPayload []byte) error {
	// Idempotency check.
	inserted, err := s.paymentRepo.RecordWebhookEvent(mpPaymentID, rawPayload)
	if err != nil {
		return fmt.Errorf("error al registrar webhook: %w", err)
	}
	if !inserted {
		log.Printf("[payment] webhook %s ya procesado — ignorando", mpPaymentID)
		return nil
	}

	// Fetch the real payment status from MP.
	mpPayment, err := s.mp.GetPayment(mpPaymentID)
	if err != nil {
		return fmt.Errorf("error al consultar pago en Mercado Pago: %w", err)
	}
	if mpPayment.Status != "approved" {
		log.Printf("[payment] payment %s status=%s — no acción", mpPaymentID, mpPayment.Status)
		return nil
	}

	trackingID := mpPayment.ExternalReference
	payment, err := s.paymentRepo.GetActiveByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("pago activo no encontrado para %s: %w", trackingID, err)
	}

	shipment, err := s.shipmentSvc.repo.GetByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("envío no encontrado para %s: %w", trackingID, err)
	}
	if shipment.Status != model.StatusPendingPayment {
		log.Printf("[payment] envío %s ya no está en pending_payment (status=%s) — ignorando", trackingID, shipment.Status)
		return nil
	}

	newTrackingID := generateTrackingID()
	now := clock.Now().UTC()

	var prediction *model.PriorityPrediction
	if s.shipmentSvc.mlClient != nil {
		prediction = s.shipmentSvc.mlClient.PredictFromShipment(shipment)
	}

	confirmed, err := s.shipmentSvc.repo.ConfirmPayment(repository.ConfirmPaymentCmd{
		OldTrackingID:       trackingID,
		NewTrackingID:       newTrackingID,
		PaymentID:           payment.ID,
		MPPaymentID:         mpPaymentID,
		Amount:              payment.Amount,
		ChangedBy:           "mercadopago",
		Timestamp:           now,
		EstimatedDeliveryAt: s.shipmentSvc.estimatedDelivery(now, shipment.OriginBranchID, shipment.FinalBranchID, string(shipment.ShipmentType)),
		Prediction:          prediction,
	})
	if err != nil {
		return fmt.Errorf("error al confirmar pago en repo: %w", err)
	}

	if err := s.paymentRepo.MarkApproved(payment.ID, mpPaymentID, newTrackingID, now); err != nil {
		log.Printf("[payment] advertencia: no se pudo marcar pago como aprobado: %v", err)
	}

	s.shipmentSvc.upsertParties(confirmed)
	go s.shipmentSvc.sendConfirmationEmails(confirmed)

	// Auto-transition: if origin == final branch, skip at_origin_hub → at_hub.
	if confirmed.OriginBranchID != "" && confirmed.OriginBranchID == confirmed.FinalBranchID {
		autoUpdated, autoErr := s.shipmentSvc.repo.UpdateStatus(repository.StatusUpdateCmd{
			TrackingID: confirmed.TrackingID,
			FromStatus: model.StatusAtOriginHub,
			ToStatus:   model.StatusAtHub,
			Location:   confirmed.OriginBranchID,
			ChangedBy:  "system",
			Notes:      "Sucursal de origen es la sucursal de destino — envío disponible para última milla",
			Timestamp:  time.Now().UTC(),
		})
		if autoErr == nil {
			log.Printf("[payment] envío %s auto-transicionado a at_hub (origen==destino)", autoUpdated.TrackingID)
		}
	}

	log.Printf("[payment] pago %s aprobado — envío %s → %s (at_origin_hub)", mpPaymentID, trackingID, newTrackingID)
	return nil
}

// BackToDraft reverts a pending_payment shipment back to draft, abandoning the MP preference.
func (s *PaymentService) BackToDraft(trackingID, username string) error {
	shipment, err := s.shipmentSvc.repo.GetByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("envío no encontrado: %w", err)
	}
	if shipment.Status != model.StatusPendingPayment {
		return fmt.Errorf("el envío no está en estado de pago pendiente")
	}

	payment, err := s.paymentRepo.GetActiveByTrackingID(trackingID)
	if err != nil {
		return fmt.Errorf("pago activo no encontrado: %w", err)
	}

	now := clock.Now().UTC()
	if err := s.paymentRepo.MarkAbandoned(payment.ID, "back_to_draft", now); err != nil {
		return fmt.Errorf("error al abandonar pago: %w", err)
	}

	if _, err := s.shipmentSvc.repo.RevertToDraft(repository.RevertToDraftCmd{
		TrackingID: trackingID,
		PaymentID:  payment.ID,
		Reason:     "Operador volvió el envío a borrador",
		ChangedBy:  username,
		Timestamp:  now,
	}); err != nil {
		return fmt.Errorf("error al revertir a borrador: %w", err)
	}
	return nil
}

// GetByTrackingID returns the most recent payment record for a shipment.
func (s *PaymentService) GetByTrackingID(trackingID string) (model.Payment, error) {
	return s.paymentRepo.GetByTrackingID(trackingID)
}

// ExpirePending reverts to draft all pending_payment shipments older than cutoff.
func (s *PaymentService) ExpirePending(cutoff time.Time) {
	payments, err := s.paymentRepo.ListExpired(cutoff)
	if err != nil {
		log.Printf("[payment-expiry] error al listar pagos expirados: %v", err)
		return
	}
	for _, p := range payments {
		shipment, err := s.shipmentSvc.repo.GetByTrackingID(p.TrackingID)
		if err != nil || shipment.Status != model.StatusPendingPayment {
			continue
		}
		now := clock.Now().UTC()
		if err := s.paymentRepo.MarkAbandoned(p.ID, "expired", now); err != nil {
			log.Printf("[payment-expiry] error al marcar pago %s como expirado: %v", p.ID, err)
			continue
		}
		if _, err := s.shipmentSvc.repo.RevertToDraft(repository.RevertToDraftCmd{
			TrackingID: p.TrackingID,
			PaymentID:  p.ID,
			Reason:     "Pago no recibido — borrador restaurado",
			ChangedBy:  "system",
			Timestamp:  now,
		}); err != nil {
			log.Printf("[payment-expiry] error al revertir %s a borrador: %v", p.TrackingID, err)
		}
	}
	if len(payments) > 0 {
		log.Printf("[payment-expiry] %d pago(s) expirado(s) revertido(s) a borrador", len(payments))
	}
}
