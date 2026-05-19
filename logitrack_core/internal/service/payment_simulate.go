package service

import (
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// SimulatePaymentApproved bypasses Mercado Pago and confirms the payment directly.
// Solo para demo/testing — no llama a MP ni valida ninguna firma.
func (s *PaymentService) SimulatePaymentApproved(trackingID, username string) (model.Shipment, error) {
	shipment, err := s.shipmentSvc.repo.GetByTrackingID(trackingID)
	if err != nil {
		return model.Shipment{}, fmt.Errorf("envío no encontrado: %w", err)
	}
	if shipment.Status != model.StatusPendingPayment {
		return model.Shipment{}, fmt.Errorf("el envío no está en estado de pago pendiente")
	}

	payment, err := s.paymentRepo.GetActiveByTrackingID(trackingID)
	if err != nil {
		return model.Shipment{}, fmt.Errorf("pago activo no encontrado: %w", err)
	}

	fakeMPPaymentID := "SIMULATED-" + uuid.NewString()[:8]
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
		MPPaymentID:         fakeMPPaymentID,
		Amount:              payment.Amount,
		ChangedBy:           username,
		Timestamp:           now,
		EstimatedDeliveryAt: s.shipmentSvc.estimatedDelivery(now, shipment.OriginBranchID, shipment.FinalBranchID, string(shipment.ShipmentType)),
		Prediction:          prediction,
	})
	if err != nil {
		return model.Shipment{}, fmt.Errorf("error al confirmar pago simulado: %w", err)
	}

	if err := s.paymentRepo.MarkApproved(payment.ID, fakeMPPaymentID, newTrackingID, now); err != nil {
		log.Printf("[payment-simulate] advertencia: no se pudo marcar pago como aprobado: %v", err)
	}

	s.shipmentSvc.upsertParties(confirmed)

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
			return autoUpdated, nil
		}
	}

	return confirmed, nil
}
