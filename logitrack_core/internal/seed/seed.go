package seed

import (
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

type shipmentSeed struct {
	trackingID        string
	senderName        string
	senderPhone       string
	senderEmail       string
	senderDNI         string
	origin            model.Address
	recipientName     string
	recipientPhone    string
	recipientEmail    string
	recipientDNI      string
	destination       model.Address
	weightKg          float64
	packageType       model.PackageType
	specialInstr      string
	receivingBranchID string
	events            []eventSeed
}

type eventSeed struct {
	from      model.Status
	to        model.Status
	changedBy string
	location  string
	notes     string
	hoursAgo  int
}

func LoadBranches(repo repository.BranchRepository) {
	branches := []model.Branch{
		{ID: "caba", Name: "Buenos Aires — Ciudad de Buenos Aires", City: "Ciudad de Buenos Aires", Province: "Buenos Aires"},
		{ID: "san-pedro", Name: "Buenos Aires — San Pedro", City: "San Pedro", Province: "Buenos Aires"},
		{ID: "cordoba", Name: "Córdoba — Córdoba", City: "Córdoba", Province: "Córdoba"},
		{ID: "mendoza", Name: "Mendoza — Mendoza", City: "Mendoza", Province: "Mendoza"},
		{ID: "rio-gallegos", Name: "Santa Cruz — Río Gallegos", City: "Río Gallegos", Province: "Santa Cruz"},
		{ID: "jujuy", Name: "Jujuy — San Salvador de Jujuy", City: "San Salvador de Jujuy", Province: "Jujuy"},
		{ID: "posadas", Name: "Misiones — Posadas", City: "Posadas", Province: "Misiones"},
		{ID: "ushuaia", Name: "Tierra del Fuego — Ushuaia", City: "Ushuaia", Province: "Tierra del Fuego"},
	}
	for _, b := range branches {
		repo.Add(b)
	}
}

func Load(repo repository.ShipmentRepository, customerRepo repository.CustomerRepository) {
	now := time.Now().UTC()

	seeds := []shipmentSeed{
		{
			trackingID:        "LT-A1B2C3D4",
			senderName:        "Carlos Mendez",
			senderPhone:       "+54 9 11 4523-7890",
			senderEmail:       "carlos.mendez@email.com",
			senderDNI:         "27845123",
			origin:            model.Address{Street: "Av. Corrientes 1234", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043"},
			recipientName:     "Laura Gomez",
			recipientPhone:    "+54 9 351 678-4321",
			recipientDNI:      "31204567",
			destination:       model.Address{Street: "San Martín 456", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"},
			weightKg:          3.5,
			packageType:       model.PackageBox,
			receivingBranchID: "caba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Ciudad de Buenos Aires", notes: "Shipment created", hoursAgo: 48},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "Ciudad de Buenos Aires", notes: "Picked up from sender", hoursAgo: 44},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "Córdoba", notes: "Arrived at Córdoba branch", hoursAgo: 20},
			},
		},
		{
			trackingID:        "LT-E5F6G7H8",
			senderName:        "Martina López",
			senderPhone:       "+54 9 11 234-5678",
			senderDNI:         "29371084",
			origin:            model.Address{Street: "Av. del Libertador 500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001"},
			recipientName:     "Diego Fernández",
			recipientPhone:    "+54 9 261 987-6543",
			recipientEmail:    "dfernandez@empresa.com",
			recipientDNI:      "25618930",
			destination:       model.Address{Street: "Belgrano 321", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500"},
			weightKg:          12.0,
			packageType:       model.PackagePallet,
			receivingBranchID: "caba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Ciudad de Buenos Aires", notes: "Shipment created", hoursAgo: 72},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "Ciudad de Buenos Aires", notes: "Package dispatched", hoursAgo: 68},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator3", location: "Mendoza", notes: "Arrived at Mendoza branch", hoursAgo: 36},
				{from: model.StatusAtBranch, to: model.StatusDelivered, changedBy: "operator3", location: "Mendoza", notes: "Delivered to recipient", hoursAgo: 10},
			},
		},
		{
			trackingID:        "LT-I9J0K1L2",
			senderName:        "Santiago Ruiz",
			senderPhone:       "+54 9 11 456-7890",
			senderDNI:         "33092715",
			origin:            model.Address{Street: "Reconquista 720", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1003"},
			recipientName:     "Valentina Torres",
			recipientPhone:    "+54 9 11 9988-7766",
			recipientDNI:      "36451820",
			destination:       model.Address{Street: "Av. Santa Fe 2100", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1123"},
			weightKg:          0.3,
			packageType:       model.PackageEnvelope,
			specialInstr:      "Handle with care — legal documents",
			receivingBranchID: "caba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Ciudad de Buenos Aires", notes: "Shipment created", hoursAgo: 6},
			},
		},
		{
			trackingID:        "LT-M3N4O5P6",
			senderName:        "Ana Perez",
			senderPhone:       "+54 9 388 111-2233",
			senderDNI:         "24783601",
			origin:            model.Address{Street: "Gorriti 456", City: "San Salvador de Jujuy", Province: "Jujuy", PostalCode: "Y4600"},
			recipientName:     "Juan Castro",
			recipientPhone:    "+54 9 387 445-6677",
			recipientDNI:      "28934075",
			destination:       model.Address{Street: "Av. España 1200", City: "Posadas", Province: "Misiones", PostalCode: "N3300"},
			weightKg:          5.2,
			packageType:       model.PackageBox,
			receivingBranchID: "jujuy",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "San Salvador de Jujuy", notes: "Shipment created", hoursAgo: 30},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator2", location: "San Salvador de Jujuy", notes: "Picked up from sender", hoursAgo: 26},
			},
		},
		{
			trackingID:        "LT-Q7R8S9T0",
			senderName:        "Roberto Silva",
			senderPhone:       "+54 9 351 333-4455",
			senderEmail:       "rsilva@distribuidora.com",
			senderDNI:         "20567412",
			origin:            model.Address{Street: "Colón 1010", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"},
			recipientName:     "Camila Rodríguez",
			recipientPhone:    "+54 9 11 6677-8899",
			recipientEmail:    "camila.r@gmail.com",
			recipientDNI:      "34128956",
			destination:       model.Address{Street: "Av. Cabildo 3456", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1429"},
			weightKg:          8.0,
			packageType:       model.PackageFragile,
			specialInstr:      "Fragile — glass items",
			receivingBranchID: "cordoba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Córdoba", notes: "Shipment created", hoursAgo: 96},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "Córdoba", notes: "Package dispatched", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator4", location: "Ciudad de Buenos Aires", notes: "Arrived at CABA branch", hoursAgo: 48},
				{from: model.StatusAtBranch, to: model.StatusDelivered, changedBy: "operator4", location: "Ciudad de Buenos Aires", notes: "Delivered successfully", hoursAgo: 24},
			},
		},
		{
			trackingID:        "LT-U1V2W3X4",
			senderName:        "Florencia Díaz",
			senderPhone:       "+54 9 11 2233-4455",
			senderDNI:         "31760294",
			origin:            model.Address{Street: "Pueyrredón 678", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1032"},
			recipientName:     "Nicolás Herrera",
			recipientPhone:    "+54 9 294 556-7788",
			recipientDNI:      "26843019",
			destination:       model.Address{Street: "San Martín 200", City: "Río Gallegos", Province: "Santa Cruz", PostalCode: "Z9400"},
			weightKg:          2.1,
			packageType:       model.PackageBox,
			receivingBranchID: "caba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Ciudad de Buenos Aires", notes: "Shipment created", hoursAgo: 2},
			},
		},
		// Ready for last-mile delivery — supervisor assigns driver via UI
		{
			trackingID:        "LT-DELIVER01",
			senderName:        "Tech Store SA",
			senderPhone:       "+54 9 11 5500-1122",
			senderDNI:         "20111222",
			origin:            model.Address{Street: "Av. Rivadavia 3000", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1202"},
			recipientName:     "Marcela Suárez",
			recipientPhone:    "+54 9 11 4433-2211",
			recipientDNI:      "30123456",
			destination:       model.Address{Street: "Larrea 1450", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1117"},
			weightKg:          1.2,
			packageType:       model.PackageBox,
			receivingBranchID: "caba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Ciudad de Buenos Aires", notes: "Shipment created", hoursAgo: 24},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "Ciudad de Buenos Aires", notes: "Dispatched", hoursAgo: 20},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "Ciudad de Buenos Aires", notes: "Arrived at CABA branch — ready for delivery", hoursAgo: 8},
			},
		},
		{
			trackingID:        "LT-DELIVER02",
			senderName:        "Librería El Quijote",
			senderPhone:       "+54 9 11 7788-9900",
			senderDNI:         "20333444",
			origin:            model.Address{Street: "Florida 340", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1005"},
			recipientName:     "Tomás Villanueva",
			recipientPhone:    "+54 9 11 6655-4433",
			recipientDNI:      "28456789",
			destination:       model.Address{Street: "Av. Santa Fe 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1425"},
			weightKg:          0.8,
			packageType:       model.PackageEnvelope,
			receivingBranchID: "caba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Ciudad de Buenos Aires", notes: "Shipment created", hoursAgo: 12},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "Ciudad de Buenos Aires", notes: "Dispatched", hoursAgo: 10},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "Ciudad de Buenos Aires", notes: "Arrived at CABA branch — ready for delivery", hoursAgo: 5},
			},
		},
		// Multi-hop shipment: Ciudad de Buenos Aires → Córdoba → Mendoza → San Salvador de Jujuy → domicilio
		{
			trackingID:        "LT-MULTI001",
			senderName:        "Empresa Distribuidora SA",
			senderPhone:       "+54 9 11 5000-1234",
			senderEmail:       "despachos@distribuidora.com",
			senderDNI:         "30500112",
			origin:            model.Address{Street: "Av. del Libertador 1000", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001"},
			recipientName:     "Hospital Regional Jujuy",
			recipientPhone:    "+54 9 388 422-0000",
			recipientDNI:      "22917463",
			destination:       model.Address{Street: "Gorriti 948", City: "San Salvador de Jujuy", Province: "Jujuy", PostalCode: "Y4600"},
			weightKg:          18.5,
			packageType:       model.PackageFragile,
			specialInstr:      "Medical equipment — handle with extreme care, keep upright",
			receivingBranchID: "caba",
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "system", location: "Ciudad de Buenos Aires", notes: "Shipment created", hoursAgo: 120},
				{from: model.StatusInProgress, to: model.StatusInTransit, changedBy: "operator1", location: "Ciudad de Buenos Aires", notes: "Dispatched from origin warehouse", hoursAgo: 116},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "Córdoba", notes: "Arrived at Córdoba hub — transfer to northern route", hoursAgo: 96},
				{from: model.StatusAtBranch, to: model.StatusInTransit, changedBy: "operator2", location: "Córdoba", notes: "Departed Córdoba towards Mendoza", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator3", location: "Mendoza", notes: "Arrived at Mendoza branch — overnight hold", hoursAgo: 72},
				{from: model.StatusAtBranch, to: model.StatusInTransit, changedBy: "operator3", location: "Mendoza", notes: "Departed Mendoza towards Jujuy via Salta", hoursAgo: 48},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator4", location: "San Salvador de Jujuy", notes: "Arrived at Jujuy branch — awaiting recipient confirmation", hoursAgo: 8},
			},
		},
	}

	for _, s := range seeds {
		lastEvent := s.events[len(s.events)-1]
		currentStatus := lastEvent.to
		createdAt := now.Add(-time.Duration(s.events[0].hoursAgo) * time.Hour)

		var deliveredAt *time.Time
		if currentStatus == model.StatusDelivered {
			t := now.Add(-time.Duration(lastEvent.hoursAgo) * time.Hour)
			deliveredAt = &t
		}

		estimated := createdAt.AddDate(0, 0, 7)

		// current location = last event's location
		currentLocation := lastEvent.location

		shipment := model.Shipment{
			TrackingID:          s.trackingID,
			SenderName:          s.senderName,
			SenderPhone:         s.senderPhone,
			SenderEmail:         s.senderEmail,
			SenderDNI:           s.senderDNI,
			Origin:              s.origin,
			RecipientName:       s.recipientName,
			RecipientPhone:      s.recipientPhone,
			RecipientEmail:      s.recipientEmail,
			RecipientDNI:        s.recipientDNI,
			Destination:         s.destination,
			WeightKg:            s.weightKg,
			PackageType:         s.packageType,
			SpecialInstructions: s.specialInstr,
			ReceivingBranchID:   s.receivingBranchID,
			Status:              currentStatus,
			CurrentLocation:     currentLocation,
			CreatedAt:           createdAt,
			EstimatedDeliveryAt: estimated,
			DeliveredAt:         deliveredAt,
		}

		if _, err := repo.Create(shipment); err != nil {
			continue
		}

		customerRepo.Upsert(model.Customer{DNI: s.senderDNI, Name: s.senderName, Phone: s.senderPhone, Email: s.senderEmail, Address: s.origin})
		customerRepo.Upsert(model.Customer{DNI: s.recipientDNI, Name: s.recipientName, Phone: s.recipientPhone, Email: s.recipientEmail, Address: s.destination})

		for _, ev := range s.events {
			event := model.ShipmentEvent{
				ID:         uuid.NewString(),
				TrackingID: s.trackingID,
				FromStatus: ev.from,
				ToStatus:   ev.to,
				ChangedBy:  ev.changedBy,
				Location:   ev.location,
				Notes:      ev.notes,
				Timestamp:  now.Add(-time.Duration(ev.hoursAgo) * time.Hour),
			}
			_ = repo.AddEvent(event)
		}
	}
}
