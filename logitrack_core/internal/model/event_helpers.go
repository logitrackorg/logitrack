package model

import "fmt"

// GetCurrentLocation determina la ubicación actual basada en el estado del envío
func GetCurrentLocation(shipment *Shipment) *EventLocation {
	if shipment == nil {
		return nil
	}

	location := &EventLocation{}

	switch shipment.Status {
	case StatusDraft, StatusAtOriginHub, StatusLoaded:
		location.Type = "ORIGIN_BRANCH"
		location.BranchCode = shipment.OriginBranchID
		location.BranchName = GetBranchName(shipment.OriginBranchID)
		location.Status = "En sucursal origen"

	case StatusInTransit:
		location.Type = "IN_TRANSIT"
		location.BranchCode = ""
		location.BranchName = "En tránsito"
		location.Status = "En camino"

	case StatusAtHub, StatusReadyForPickup:
		location.Type = "DESTINATION_BRANCH"
		location.BranchCode = shipment.ReceivingBranchID
		location.BranchName = GetBranchName(shipment.ReceivingBranchID)
		location.Status = "Disponible para retiro"

	case StatusOutForDelivery:
		location.Type = "IN_TRANSIT"
		location.BranchCode = shipment.ReceivingBranchID
		location.BranchName = "En reparto"
		location.Status = "En camino al destinatario"

	case StatusDelivered:
		location.Type = "DESTINATION_BRANCH"
		location.BranchCode = shipment.ReceivingBranchID
		location.BranchName = GetBranchName(shipment.ReceivingBranchID)
		location.Status = "Entregado"

	case StatusDeliveryFailed, StatusRedeliveryScheduled:
		location.Type = "DESTINATION_BRANCH"
		location.BranchCode = shipment.ReceivingBranchID
		location.BranchName = GetBranchName(shipment.ReceivingBranchID)
		location.Status = "Pendiente de reentrega"

	default:
		location.Type = "UNKNOWN"
		location.Status = string(shipment.Status)
	}

	return location
}

// GetBranchName retorna el nombre amigable de una sucursal
func GetBranchName(branchCode string) string {
	// Mapeo de códigos a nombres
	branchNames := map[string]string{
		"CDBA-01": "Ciudad de Buenos Aires - Centro",
		"CORD-01": "Córdoba - Centro",
		"ROSA-01": "Rosario - Centro",
		"MEND-01": "Mendoza - Centro",
		"TUCU-01": "Tucumán - Centro",
		"SALT-01": "Salta - Centro",
		"BAHI-01": "Bahía Blanca - Centro",
		"MARD-01": "Mar del Plata - Centro",
		// Agregar más sucursales según sea necesario
	}

	if name, exists := branchNames[branchCode]; exists {
		return name
	}

	// Fallback: retornar el código si no existe en el mapa
	return branchCode
}

// FormatEventDescription genera la descripción del evento según su tipo
func FormatEventDescription(event *ShipmentEvent) string {
	switch event.EventType {
	case "rescheduled":
		if event.CurrentLocation != nil && event.RescheduledDate != nil {
			return formatRescheduleDescription(event)
		}
		return "Entrega reprogramada"

	case "status_change":
		return formatStatusChangeDescription(event)

	case "edited":
		return "Envío editado"

	default:
		if event.Notes != "" {
			return event.Notes
		}
		return "Evento registrado"
	}
}

func formatRescheduleDescription(event *ShipmentEvent) string {
	// Formato deseado:
	// Línea 1: "En Sucursal Destino - Disponible para retiro"
	// Línea 2: "Entrega reprogramada para el 30/05/2026"

	locationText := ""
	switch event.CurrentLocation.Type {
	case "ORIGIN_BRANCH":
		locationText = fmt.Sprintf("En Sucursal Origen (%s)", event.CurrentLocation.BranchCode)
	case "DESTINATION_BRANCH":
		locationText = "En Sucursal Destino"
	case "IN_TRANSIT":
		locationText = "En tránsito"
	default:
		locationText = "Ubicación desconocida"
	}

	return fmt.Sprintf("%s - %s", locationText, event.CurrentLocation.Status)
}

func formatStatusChangeDescription(event *ShipmentEvent) string {
	statusDescriptions := map[Status]string{
		StatusDraft:               "Borrador creado",
		StatusAtOriginHub:         "En sucursal origen",
		StatusLoaded:              "Cargado en vehículo",
		StatusInTransit:           "En tránsito",
		StatusAtHub:               "En sucursal destino",
		StatusReadyForPickup:      "Disponible para retiro",
		StatusOutForDelivery:      "En reparto",
		StatusDelivered:           "Entregado",
		StatusDeliveryFailed:      "Intento de entrega fallido",
		StatusRedeliveryScheduled: "Reentrega programada",
		StatusReturned:            "Devuelto",
		StatusCancelled:           "Cancelado",
		StatusPendingPayment:      "Pendiente de pago",
	}

	if desc, exists := statusDescriptions[event.ToStatus]; exists {
		return desc
	}

	return string(event.ToStatus)
}

// GetEventIcon retorna el emoji/icono apropiado para cada tipo de evento
func GetEventIcon(eventType string) string {
	icons := map[string]string{
		"status_change": "📦",
		"rescheduled":   "📍",
		"edited":        "✏️",
		"comment":       "💬",
		"incident":      "⚠️",
	}

	if icon, exists := icons[eventType]; exists {
		return icon
	}

	return "📋"
}