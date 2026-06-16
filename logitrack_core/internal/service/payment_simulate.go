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

// ConfirmCashPayment confirms the payment as paid in cash by the customer.
func (s *PaymentService) ConfirmCashPayment(trackingID, username string) (model.Shipment, error) {
	return s.confirmManualPayment(trackingID, username, model.PaymentMethodCash, "EFECTIVO-")
}

// ConfirmTransferPayment confirms the payment as received via bank transfer.
// La confirmación es manual por el operador tras verificar la acreditación.
func (s *PaymentService) ConfirmTransferPayment(trackingID, username string) (model.Shipment, error) {
	return s.confirmManualPayment(trackingID, username, model.PaymentMethodTransfer, "TRANSFER-")
}

func (s *PaymentService) confirmManualPayment(trackingID, username string, method model.PaymentMethod, idPrefix string) (model.Shipment, error) {
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

	fakePaymentID := idPrefix + uuid.NewString()[:8]
	newTrackingID := generateTrackingID()
	now := clock.Now().UTC()

	var prediction *model.PriorityPrediction
	if s.shipmentSvc.mlClient != nil {
		prediction = s.shipmentSvc.mlClient.PredictFromShipment(shipment)
	}

	securityKeyword := shipment.SecurityKeyword
	if securityKeyword == "" && shipment.DeliveryMethod == model.DeliveryMethodLastMile {
		securityKeyword = generateSecurityKeyword()
	}
	confirmed, err := s.shipmentSvc.repo.ConfirmPayment(repository.ConfirmPaymentCmd{
		OldTrackingID:       trackingID,
		NewTrackingID:       newTrackingID,
		PaymentID:           payment.ID,
		MPPaymentID:         fakePaymentID,
		Amount:              payment.Amount,
		Method:              method,
		ChangedBy:           username,
		Timestamp:           now,
		EstimatedDeliveryAt: s.shipmentSvc.estimatedDelivery(now, shipment.OriginBranchID, shipment.FinalBranchID, string(shipment.ShipmentType)),
		Prediction:          prediction,
		SecurityKeyword:     securityKeyword,
	})
	if err != nil {
		return model.Shipment{}, fmt.Errorf("error al confirmar pago: %w", err)
	}

	if err := s.paymentRepo.MarkApproved(payment.ID, fakePaymentID, newTrackingID, now, method); err != nil {
		log.Printf("[payment-%s] advertencia: no se pudo marcar pago como aprobado: %v", string(method), err)
	}

	s.shipmentSvc.upsertParties(confirmed)
	go s.shipmentSvc.sendConfirmationEmails(confirmed)

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

// ConfirmMockPayment confirms the payment using a simulated payment method (e.g. tarjeta simulada).
// Funciona igual que ConfirmCashPayment pero con un prefijo distinto en el ID simulado.
func (s *PaymentService) ConfirmMockPayment(trackingID, username string) (model.Shipment, error) {
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

	fakeMPPaymentID := "MOCK-" + uuid.NewString()[:8]
	newTrackingID := generateTrackingID()
	now := clock.Now().UTC()

	var prediction *model.PriorityPrediction
	if s.shipmentSvc.mlClient != nil {
		prediction = s.shipmentSvc.mlClient.PredictFromShipment(shipment)
	}

	securityKeywordMock := shipment.SecurityKeyword
	if securityKeywordMock == "" && shipment.DeliveryMethod == model.DeliveryMethodLastMile {
		securityKeywordMock = generateSecurityKeyword()
	}
	confirmed, err := s.shipmentSvc.repo.ConfirmPayment(repository.ConfirmPaymentCmd{
		OldTrackingID:       trackingID,
		NewTrackingID:       newTrackingID,
		PaymentID:           payment.ID,
		MPPaymentID:         fakeMPPaymentID,
		Amount:              payment.Amount,
		Method:              model.PaymentMethodMock,
		ChangedBy:           username,
		Timestamp:           now,
		EstimatedDeliveryAt: s.shipmentSvc.estimatedDelivery(now, shipment.OriginBranchID, shipment.FinalBranchID, string(shipment.ShipmentType)),
		Prediction:          prediction,
		SecurityKeyword:     securityKeywordMock,
	})
	if err != nil {
		return model.Shipment{}, fmt.Errorf("error al confirmar pago simulado: %w", err)
	}

	if err := s.paymentRepo.MarkApproved(payment.ID, fakeMPPaymentID, newTrackingID, now, model.PaymentMethodMock); err != nil {
		log.Printf("[payment-mock] advertencia: no se pudo marcar pago como aprobado: %v", err)
	}

	s.shipmentSvc.upsertParties(confirmed)
	go s.shipmentSvc.sendConfirmationEmails(confirmed)

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
