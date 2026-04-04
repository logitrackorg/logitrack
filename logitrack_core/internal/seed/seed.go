package seed

import (
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
)

type shipmentSeed struct {
	trackingID         string
	sender             model.Customer
	recipient          model.Customer
	weightKg           float64
	packageType        model.PackageType
	isFragile          bool
	specialInstr       string
	shipmentType       model.ShipmentType
	timeWindow         model.TimeWindow
	coldChain          bool
	receivingBranchID  string
	priority           string
	priorityScore      float64
	priorityConfidence float64
	events             []eventSeed
}

type eventSeed struct {
	from      model.Status // empty string = initial creation (nil in ShipmentEvent)
	to        model.Status
	changedBy string
	location  string // branch ID
	notes     string
	hoursAgo  int
	driverID  string // only for delivering events
}

func strPtr(s string) *string { return &s }

func LoadVehicles(repo repository.VehicleRepository) {
	vehicles := []model.Vehicle{
		{
			LicensePlate:   "AB123CD",
			Type:           model.VehicleTypeVan,
			CapacityKg:     800,
			Status:         model.VehicleStatusAvailable,
			AssignedBranch: strPtr("caba"),
		},
		{
			LicensePlate:   "EF456GH",
			Type:           model.VehicleTypeTruck,
			CapacityKg:     5000,
			Status:         model.VehicleStatusAvailable,
			AssignedBranch: strPtr("cordoba"),
		},
		{
			LicensePlate:   "IJ789KL",
			Type:           model.VehicleTypeMotorcycle,
			CapacityKg:     50,
			Status:         model.VehicleStatusInMaintenance,
			AssignedBranch: strPtr("caba"),
		},
	}
	for _, v := range vehicles {
		err := repo.Add(v)
		if err != nil && err != repository.ErrDuplicateLicensePlate {
			panic("failed to seed vehicle " + v.LicensePlate + ": " + err.Error())
		}
	}
}

// Load populates the event store with seed domain events, then rebuilds the projection.
// Idempotent: if events already exist in the store, only rebuilds the projection and returns.
func Load(store repository.EventStore, proj projection.Projector, customerRepo repository.CustomerRepository, routeRepo repository.RouteRepository) {
	existing, _ := store.LoadAll()
	if len(existing) > 0 {
		proj.Rebuild(existing)
		return
	}
	now := time.Now().UTC()

	seeds := []shipmentSeed{
		{
			trackingID:         "LT-A1B2C3D4",
			sender:             model.Customer{DNI: "27845123", Name: "Carlos Mendez", Phone: "541145237890", Email: "carlos.mendez@email.com", Address: model.Address{Street: "Av. Corrientes 1234", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043"}},
			recipient:          model.Customer{DNI: "31204567", Name: "Laura Gomez", Phone: "543516784321", Address: model.Address{Street: "San Martín 456", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"}},
			weightKg:           3.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.15,
			priorityConfidence: 0.82,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "caba", notes: "Shipment created", hoursAgo: 48},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "caba", notes: "Picked up from sender", hoursAgo: 44},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "cordoba", notes: "Arrived at Córdoba branch", hoursAgo: 20},
			},
		},
		{
			trackingID:         "LT-E5F6G7H8",
			sender:             model.Customer{DNI: "29371084", Name: "Martina López", Phone: "541192345678", Address: model.Address{Street: "Av. del Libertador 500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001"}},
			recipient:          model.Customer{DNI: "25618930", Name: "Diego Fernández", Phone: "542619876543", Email: "dfernandez@empresa.com", Address: model.Address{Street: "Belgrano 321", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500"}},
			weightKg:           12.0,
			packageType:        model.PackagePallet,
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "alta",
			priorityScore:      0.72,
			priorityConfidence: 0.75,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "caba", notes: "Shipment created", hoursAgo: 72},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "caba", notes: "Package dispatched", hoursAgo: 68},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator3", location: "mendoza", notes: "Arrived at Mendoza branch", hoursAgo: 36},
				{from: model.StatusAtBranch, to: model.StatusDelivered, changedBy: "operator3", location: "mendoza", notes: "Delivered to recipient", hoursAgo: 10},
			},
		},
		{
			trackingID:         "LT-I9J0K1L2",
			sender:             model.Customer{DNI: "33092715", Name: "Santiago Ruiz", Phone: "541194567890", Address: model.Address{Street: "Reconquista 720", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1003"}},
			recipient:          model.Customer{DNI: "36451820", Name: "Valentina Torres", Phone: "541199887766", Address: model.Address{Street: "Av. Santa Fe 2100", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1123"}},
			weightKg:           0.3,
			packageType:        model.PackageEnvelope,
			specialInstr:       "Handle with care — legal documents",
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.52,
			priorityConfidence: 0.68,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "caba", notes: "Shipment created", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-M3N4O5P6",
			sender:             model.Customer{DNI: "24783601", Name: "Ana Perez", Phone: "543881112233", Address: model.Address{Street: "Gorriti 456", City: "San Salvador de Jujuy", Province: "Jujuy", PostalCode: "Y4600"}},
			recipient:          model.Customer{DNI: "28934075", Name: "Juan Castro", Phone: "543874456677", Address: model.Address{Street: "Av. España 1200", City: "Posadas", Province: "Misiones", PostalCode: "N3300"}},
			weightKg:           5.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "jujuy",
			priority:           "baja",
			priorityScore:      0.22,
			priorityConfidence: 0.79,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "jujuy", notes: "Shipment created", hoursAgo: 30},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator2", location: "posadas", notes: "Picked up from sender", hoursAgo: 26},
			},
		},
		{
			trackingID:         "LT-Q7R8S9T0",
			sender:             model.Customer{DNI: "20567412", Name: "Roberto Silva", Phone: "543513334455", Email: "rsilva@distribuidora.com", Address: model.Address{Street: "Colón 1010", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"}},
			recipient:          model.Customer{DNI: "34128956", Name: "Camila Rodríguez", Phone: "541166778899", Email: "camila.r@gmail.com", Address: model.Address{Street: "Av. Cabildo 3456", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1429"}},
			weightKg:           8.0,
			packageType:        model.PackageBox,
			isFragile:          true,
			specialInstr:       "Fragile — glass items",
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			priority:           "media",
			priorityScore:      0.40,
			priorityConfidence: 0.71,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "cordoba", notes: "Shipment created", hoursAgo: 96},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "cordoba", notes: "Package dispatched", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator4", location: "caba", notes: "Arrived at CABA branch", hoursAgo: 48},
				{from: model.StatusAtBranch, to: model.StatusDelivered, changedBy: "operator4", location: "caba", notes: "Delivered successfully", hoursAgo: 24},
			},
		},
		{
			trackingID:         "LT-U1V2W3X4",
			sender:             model.Customer{DNI: "31760294", Name: "Florencia Díaz", Phone: "541122334455", Address: model.Address{Street: "Pueyrredón 678", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1032"}},
			recipient:          model.Customer{DNI: "26843019", Name: "Nicolás Herrera", Phone: "542945567788", Address: model.Address{Street: "San Martín 200", City: "Río Gallegos", Province: "Santa Cruz", PostalCode: "Z9400"}},
			weightKg:           2.1,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.36,
			priorityConfidence: 0.73,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "caba", notes: "Shipment created", hoursAgo: 2},
			},
		},
		// Out for delivery — assigned to driver chofer (ID: 5)
		{
			trackingID:         "LT-DELIVER01",
			sender:             model.Customer{DNI: "20111222", Name: "Tech Store SA", Phone: "5433295500112", Address: model.Address{Street: "Av. San Martín 150", City: "San Pedro", Province: "Buenos Aires", PostalCode: "B2930"}},
			recipient:          model.Customer{DNI: "30123456", Name: "Marcela Suárez", Phone: "541144332211", Address: model.Address{Street: "Larrea 1450", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1117"}},
			weightKg:           1.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "san-pedro",
			priority:           "baja",
			priorityScore:      0.18,
			priorityConfidence: 0.84,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "san-pedro", notes: "Shipment created", hoursAgo: 24},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "san-pedro", notes: "Dispatched towards Buenos Aires", hoursAgo: 20},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "caba", notes: "Arrived at CABA branch", hoursAgo: 8},
				{from: model.StatusAtBranch, to: model.StatusDelivering, changedBy: "supervisor1", location: "", notes: "Assigned to driver for last-mile delivery", hoursAgo: 1, driverID: "5"},
			},
		},
		{
			trackingID:         "LT-DELIVER02",
			sender:             model.Customer{DNI: "20333444", Name: "Librería El Quijote", Phone: "543517788990", Address: model.Address{Street: "Obispo Trejo 145", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"}},
			recipient:          model.Customer{DNI: "28456789", Name: "Tomás Villanueva", Phone: "541166554433", Address: model.Address{Street: "Av. Santa Fe 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1425"}},
			weightKg:           0.8,
			packageType:        model.PackageEnvelope,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			priority:           "baja",
			priorityScore:      0.11,
			priorityConfidence: 0.88,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "cordoba", notes: "Shipment created", hoursAgo: 12},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "cordoba", notes: "Dispatched towards Buenos Aires", hoursAgo: 10},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "caba", notes: "Arrived at CABA branch — ready for delivery", hoursAgo: 5},
			},
		},
		// Multi-hop shipment: Ciudad de Buenos Aires → Córdoba → Mendoza → San Salvador de Jujuy → domicilio
		{
			trackingID:         "LT-MULTI001",
			sender:             model.Customer{DNI: "30500112", Name: "Empresa Distribuidora SA", Phone: "541150001234", Email: "despachos@distribuidora.com", Address: model.Address{Street: "Av. del Libertador 1000", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001"}},
			recipient:          model.Customer{DNI: "22917463", Name: "Hospital Regional Jujuy", Phone: "543884220000", Address: model.Address{Street: "Gorriti 948", City: "San Salvador de Jujuy", Province: "Jujuy", PostalCode: "Y4600"}},
			weightKg:           18.5,
			packageType:        model.PackageBox,
			isFragile:          true,
			specialInstr:       "Medical equipment — handle with extreme care, keep upright",
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "alta",
			priorityScore:      0.78,
			priorityConfidence: 0.81,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "operator1", location: "caba", notes: "Shipment created", hoursAgo: 120},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "caba", notes: "Dispatched from origin warehouse", hoursAgo: 116},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "cordoba", notes: "Arrived at Córdoba hub — transfer to northern route", hoursAgo: 96},
				{from: model.StatusAtBranch, to: model.StatusInTransit, changedBy: "operator2", location: "mendoza", notes: "Departed Córdoba towards Mendoza", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator3", location: "mendoza", notes: "Arrived at Mendoza branch — overnight hold", hoursAgo: 72},
				{from: model.StatusAtBranch, to: model.StatusInTransit, changedBy: "operator3", location: "jujuy", notes: "Departed Mendoza towards Jujuy via Salta", hoursAgo: 48},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator4", location: "jujuy", notes: "Arrived at Jujuy branch — awaiting recipient confirmation", hoursAgo: 8},
			},
		},
	}

	for _, s := range seeds {
		createdAt := now.Add(-time.Duration(s.events[0].hoursAgo) * time.Hour)
		estimated := createdAt.AddDate(0, 0, 7)

		// Build the initial shipment snapshot for the shipment_created event
		initialShipment := model.Shipment{
			TrackingID:          s.trackingID,
			Sender:              s.sender,
			Recipient:           s.recipient,
			WeightKg:            s.weightKg,
			PackageType:         s.packageType,
			IsFragile:           s.isFragile,
			SpecialInstructions: s.specialInstr,
			ShipmentType:        s.shipmentType,
			TimeWindow:          s.timeWindow,
			ColdChain:           s.coldChain,
			ReceivingBranchID:   s.receivingBranchID,
			Priority:            s.priority,
			PriorityScore:       s.priorityScore,
			PriorityConfidence:  s.priorityConfidence,
			Status:              model.StatusInProgress,
			CurrentLocation:     s.events[0].location,
			CreatedAt:           createdAt,
			UpdatedAt:           createdAt,
			EstimatedDeliveryAt: estimated,
		}

		// Emit shipment_created event
		createEvent := model.DomainEvent{
			ID:         uuid.NewString(),
			TrackingID: s.trackingID,
			EventType:  model.EventShipmentCreated,
			Payload:    model.ShipmentCreatedPayload{Shipment: initialShipment, Notes: s.events[0].notes},
			ChangedBy:  s.events[0].changedBy,
			Timestamp:  createdAt,
		}
		_ = store.Append(createEvent)

		// Emit status_changed events for all subsequent event seeds
		for _, ev := range s.events[1:] {
			statusEvent := model.DomainEvent{
				ID:         uuid.NewString(),
				TrackingID: s.trackingID,
				EventType:  model.EventStatusChanged,
				Payload: model.StatusChangedPayload{
					FromStatus: ev.from,
					ToStatus:   ev.to,
					Location:   ev.location,
					Notes:      ev.notes,
					DriverID:   ev.driverID,
				},
				ChangedBy: ev.changedBy,
				Timestamp: now.Add(-time.Duration(ev.hoursAgo) * time.Hour),
			}
			_ = store.Append(statusEvent)
		}

		// Upsert customers from this seed entry
		customerRepo.Upsert(s.sender)
		customerRepo.Upsert(s.recipient)
	}

	// Rebuild projection from all appended events
	allEvents, _ := store.LoadAll()
	proj.Rebuild(allEvents)

	// Seed driver route for today — chofer (ID: 5) has LT-DELIVER01 out for delivery
	_, _ = routeRepo.Create(model.Route{
		ID:          "ROUTE-SEED0001",
		Date:        model.NewDateOnly(now),
		DriverID:    "5",
		ShipmentIDs: []string{"LT-DELIVER01"},
		CreatedBy:   "supervisor1",
		CreatedAt:   now.Add(-1 * time.Hour),
	})
}
