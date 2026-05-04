package seed

import (
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
)

func fPtr(f float64) *float64 { return &f }

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
			LicensePlate:     "AB123CD",
			Type:             model.VehicleTypeVan,
			CapacityKg:       800,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("caba"),
			CurrentLatitude:  fPtr(-34.6037),
			CurrentLongitude: fPtr(-58.3816),
		},
		{
			LicensePlate:     "EF456GH",
			Type:             model.VehicleTypeTruck,
			CapacityKg:       5000,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("cordoba"),
			CurrentLatitude:  fPtr(-31.4201),
			CurrentLongitude: fPtr(-64.1888),
		},
		{
			LicensePlate:     "IJ789KL",
			Type:             model.VehicleTypeMotorcycle,
			CapacityKg:       50,
			Status:           model.VehicleStatusInMaintenance,
			AssignedBranch:   strPtr("caba"),
			CurrentLatitude:  fPtr(-34.6037),
			CurrentLongitude: fPtr(-58.3816),
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
		// En sucursal CABA → en tránsito hacia Córdoba → llegó a Córdoba (at_hub)
		{
			trackingID:         "LT-A1B2C3D4",
			sender:             model.Customer{DNI: "27845123", Name: "Carlos Mendez", Phone: "541145237890", Email: "carlos.mendez@email.com", Address: model.Address{Street: "Av. Corrientes 1234", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "31204567", Name: "Laura Gomez", Phone: "543516784321", Address: model.Address{Street: "San Martín 456", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           3.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			priority:           "baja",
			priorityScore:      0.15,
			priorityConfidence: 0.82,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 48},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo AB123CD", hoursAgo: 46},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Vehículo en camino", hoursAgo: 44},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Llegó a sucursal Córdoba", hoursAgo: 20},
			},
		},
		// Entregado
		{
			trackingID:         "LT-E5F6G7H8",
			sender:             model.Customer{DNI: "29371084", Name: "Martina López", Phone: "541192345678", Address: model.Address{Street: "Av. del Libertador 500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "25618930", Name: "Diego Fernández", Phone: "542619876543", Email: "dfernandez@empresa.com", Address: model.Address{Street: "Belgrano 321", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           12.0,
			packageType:        model.PackagePallet,
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "mendoza",
			priority:           "alta",
			priorityScore:      0.72,
			priorityConfidence: 0.75,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 72},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo EF456GH", hoursAgo: 70},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "mendoza", notes: "Vehículo en camino", hoursAgo: 68},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_mendoza", location: "mendoza", notes: "Llegó a sucursal Mendoza", hoursAgo: 36},
				{from: model.StatusAtHub, to: model.StatusDelivered, changedBy: "op_mendoza", location: "mendoza", notes: "Entregado al destinatario", hoursAgo: 10},
			},
		},
		// En sucursal de origen (at_origin_hub)
		{
			trackingID:         "LT-I9J0K1L2",
			sender:             model.Customer{DNI: "33092715", Name: "Santiago Ruiz", Phone: "541194567890", Address: model.Address{Street: "Reconquista 720", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1003", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "36451820", Name: "Valentina Torres", Phone: "541199887766", Address: model.Address{Street: "Av. Santa Fe 2100", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1123", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           0.3,
			packageType:        model.PackageEnvelope,
			specialInstr:       "Documentos legales — manejar con cuidado",
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.52,
			priorityConfidence: 0.68,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 6},
			},
		},
		// Delivered
		{
			trackingID:         "LT-Q7R8S9T0",
			sender:             model.Customer{DNI: "20567412", Name: "Roberto Silva", Phone: "543513334455", Email: "rsilva@distribuidora.com", Address: model.Address{Street: "Colón 1010", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			recipient:          model.Customer{DNI: "34128956", Name: "Camila Rodríguez", Phone: "541166778899", Email: "camila.r@gmail.com", Address: model.Address{Street: "Av. Cabildo 3456", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1429", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           8.0,
			packageType:        model.PackageBox,
			isFragile:          true,
			specialInstr:       "Frágil — artículos de vidrio",
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.40,
			priorityConfidence: 0.71,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado", hoursAgo: 96},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en vehículo EF456GH", hoursAgo: 94},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "Vehículo partió hacia Buenos Aires", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a sucursal CABA", hoursAgo: 48},
				{from: model.StatusAtHub, to: model.StatusDelivered, changedBy: "op_caba", location: "caba", notes: "Entregado exitosamente", hoursAgo: 24},
			},
		},
		// Out for delivery — assigned to driver chofer (ID: 5)
		{
			trackingID:         "LT-DELIVER01",
			sender:             model.Customer{DNI: "20111222", Name: "Tech Store SA", Phone: "5433295500112", Address: model.Address{Street: "Av. San Martín 150", City: "San Pedro", Province: "Buenos Aires", PostalCode: "B2930", Latitude: fPtr(-33.6785), Longitude: fPtr(-59.6667)}},
			recipient:          model.Customer{DNI: "30123456", Name: "Marcela Suárez", Phone: "541144332211", Address: model.Address{Street: "Larrea 1450", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1117", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           1.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.18,
			priorityConfidence: 0.84,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 24},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo AB123CD", hoursAgo: 22},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "Vehículo en camino", hoursAgo: 20},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a sucursal CABA", hoursAgo: 8},
				{from: model.StatusAtHub, to: model.StatusOutForDelivery, changedBy: "sup_caba", location: "", notes: "Asignado a chofer para entrega de última milla", hoursAgo: 1, driverID: "5"},
			},
		},
		// at_hub (en sucursal destino, esperando asignación)
		{
			trackingID:         "LT-DELIVER02",
			sender:             model.Customer{DNI: "20333444", Name: "Librería El Quijote", Phone: "543517788990", Address: model.Address{Street: "Obispo Trejo 145", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			recipient:          model.Customer{DNI: "28456789", Name: "Tomás Villanueva", Phone: "541166554433", Address: model.Address{Street: "Av. Santa Fe 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1425", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           0.8,
			packageType:        model.PackageEnvelope,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.11,
			priorityConfidence: 0.88,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado", hoursAgo: 12},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en vehículo EF456GH", hoursAgo: 11},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "Vehículo partió hacia Buenos Aires", hoursAgo: 10},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a sucursal CABA — lista para reparto", hoursAgo: 5},
			},
		},
		// delivery_failed con 1 intento
		{
			trackingID:         "LT-CABA0001",
			sender:             model.Customer{DNI: "32111222", Name: "Agustina Peralta", Phone: "541155667788", Address: model.Address{Street: "Thames 1200", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1414", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "29887766", Name: "Ricardo Montes", Phone: "543513221100", Address: model.Address{Street: "Bv. San Juan 750", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           4.0,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			priority:           "baja",
			priorityScore:      0.20,
			priorityConfidence: 0.80,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en sucursal CABA", hoursAgo: 20},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo", hoursAgo: 18},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Viaje iniciado hacia Córdoba", hoursAgo: 16},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Llegó a sucursal Córdoba", hoursAgo: 8},
				{from: model.StatusAtHub, to: model.StatusOutForDelivery, changedBy: "sup_cordoba", location: "", notes: "Asignado a reparto", hoursAgo: 4},
				{from: model.StatusOutForDelivery, to: model.StatusDeliveryFailed, changedBy: "chofer_cordoba", location: "", notes: "Destinatario ausente", hoursAgo: 2},
			},
		},
		// redelivery_scheduled
		{
			trackingID:         "LT-CABA0002",
			sender:             model.Customer{DNI: "27334455", Name: "Luciana Benítez", Phone: "541133445566", Address: model.Address{Street: "Av. Rivadavia 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1424", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "31667788", Name: "Pablo Acosta", Phone: "543513221199", Address: model.Address{Street: "Bv. San Juan 400", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           1.5,
			packageType:        model.PackageEnvelope,
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "cordoba",
			priority:           "alta",
			priorityScore:      0.70,
			priorityConfidence: 0.77,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 48},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo AB123CD", hoursAgo: 46},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Viaje iniciado hacia Córdoba", hoursAgo: 44},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Llegó a sucursal Córdoba", hoursAgo: 12},
				{from: model.StatusAtHub, to: model.StatusOutForDelivery, changedBy: "sup_cordoba", location: "", notes: "En reparto", hoursAgo: 8},
				{from: model.StatusOutForDelivery, to: model.StatusDeliveryFailed, changedBy: "chofer_cordoba", location: "", notes: "Nadie en el domicilio", hoursAgo: 6},
				{from: model.StatusDeliveryFailed, to: model.StatusRedeliveryScheduled, changedBy: "op_cordoba", location: "", notes: "Reentrega agendada para mañana", hoursAgo: 4},
			},
		},
		// ready_for_pickup
		{
			trackingID:         "LT-CABA0003",
			sender:             model.Customer{DNI: "25990011", Name: "Fernando Ibáñez", Phone: "541177889900", Address: model.Address{Street: "Corrientes 3400", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1193", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "33445566", Name: "Natalia Ponce", Phone: "541188990011", Address: model.Address{Street: "Mitre 890", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1036", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           2.8,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			coldChain:          true,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.45,
			priorityConfidence: 0.72,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en sucursal CABA", hoursAgo: 18},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo AB123CD", hoursAgo: 16},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "Vehículo en camino", hoursAgo: 14},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a sucursal — listo para retiro", hoursAgo: 3},
				{from: model.StatusAtHub, to: model.StatusReadyForPickup, changedBy: "op_caba", location: "caba", notes: "Marcado para retiro en mostrador", hoursAgo: 1},
			},
		},
		// Mendoza: at_origin_hub
		{
			trackingID:         "LT-MEND0001",
			sender:             model.Customer{DNI: "28223344", Name: "Daniela Vargas", Phone: "542614443322", Address: model.Address{Street: "Av. San Martín 980", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			recipient:          model.Customer{DNI: "30556677", Name: "Sebastián Ortiz", Phone: "541199001122", Address: model.Address{Street: "Av. Callao 1200", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1023", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           7.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.25,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Envío registrado en sucursal Mendoza", hoursAgo: 4},
			},
		},
		// Mendoza: at_hub en CABA
		{
			trackingID:         "LT-MEND0002",
			sender:             model.Customer{DNI: "26778899", Name: "Cecilia Romero", Phone: "542614556677", Address: model.Address{Street: "Belgrano 450", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			recipient:          model.Customer{DNI: "34112233", Name: "Gustavo Medina", Phone: "541155443322", Address: model.Address{Street: "Av. Corrientes 800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           11.0,
			packageType:        model.PackagePallet,
			isFragile:          true,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.42,
			priorityConfidence: 0.74,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Envío registrado en sucursal Mendoza", hoursAgo: 22},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_mendoza", location: "mendoza", notes: "Cargado en vehículo EF456GH", hoursAgo: 20},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_mendoza", location: "caba", notes: "Vehículo partió hacia Buenos Aires", hoursAgo: 18},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a sucursal CABA", hoursAgo: 2},
			},
		},
		// Mendoza: delivered
		{
			trackingID:         "LT-MEND0003",
			sender:             model.Customer{DNI: "21334455", Name: "Horacio Blanco", Phone: "542614112233", Address: model.Address{Street: "Las Heras 600", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			recipient:          model.Customer{DNI: "29001122", Name: "Inés Carrizo", Phone: "542646334455", Address: model.Address{Street: "Av. Libertador 300", City: "San Juan", Province: "San Juan", PostalCode: "J5400", Latitude: fPtr(-31.5375), Longitude: fPtr(-68.5364)}},
			weightKg:           3.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "mendoza",
			priority:           "alta",
			priorityScore:      0.68,
			priorityConfidence: 0.76,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Envío registrado en sucursal Mendoza", hoursAgo: 60},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_mendoza", location: "mendoza", notes: "Cargado en vehículo EF456GH", hoursAgo: 58},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_mendoza", location: "mendoza", notes: "Vehículo partió hacia San Juan", hoursAgo: 56},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_mendoza", location: "mendoza", notes: "Llegó — preparando para entrega", hoursAgo: 30},
				{from: model.StatusAtHub, to: model.StatusDelivered, changedBy: "op_mendoza", location: "mendoza", notes: "Entregado al destinatario", hoursAgo: 12},
			},
		},
		// Multi-hop: CABA → Córdoba → Mendoza (at_hub en Mendoza)
		{
			trackingID:         "LT-MULTI001",
			sender:             model.Customer{DNI: "30500112", Name: "Empresa Distribuidora SA", Phone: "541150001234", Email: "despachos@distribuidora.com", Address: model.Address{Street: "Av. del Libertador 1000", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "22917463", Name: "Clínica Regional Cuyo", Phone: "542614220000", Address: model.Address{Street: "Av. San Martín 1500", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           18.5,
			packageType:        model.PackageBox,
			isFragile:          true,
			specialInstr:       "Equipamiento médico — manejar con extremo cuidado, mantener vertical",
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "mendoza",
			priority:           "alta",
			priorityScore:      0.78,
			priorityConfidence: 0.81,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 120},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo AB123CD", hoursAgo: 118},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Vehículo partió desde CABA", hoursAgo: 116},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Llegó a hub Córdoba — transferencia a ruta oeste", hoursAgo: 96},
				{from: model.StatusAtHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en vehículo EF456GH para tramo Mendoza", hoursAgo: 93},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "mendoza", notes: "Vehículo partió de Córdoba hacia Mendoza", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_mendoza", location: "mendoza", notes: "Llegó a sucursal Mendoza — aguardando retiro del destinatario", hoursAgo: 12},
			},
		},
		// ready_for_return (envío en devolución en origen)
		{
			trackingID:         "LT-RETURN01",
			sender:             model.Customer{DNI: "19876543", Name: "Electrohogar SRL", Phone: "541133221100", Address: model.Address{Street: "Av. San Martín 800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1004", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "28654321", Name: "Mónica Suárez", Phone: "543516001122", Address: model.Address{Street: "Hipólito Yrigoyen 400", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           6.0,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.18,
			priorityConfidence: 0.80,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 72},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo", hoursAgo: 70},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Viaje iniciado", hoursAgo: 68},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Llegó a Córdoba", hoursAgo: 48},
				{from: model.StatusAtHub, to: model.StatusReadyForPickup, changedBy: "op_cordoba", location: "cordoba", notes: "Listo para retiro", hoursAgo: 24},
				{from: model.StatusReadyForPickup, to: model.StatusNoEntregado, changedBy: "op_cordoba", location: "cordoba", notes: "Plazo de retiro vencido sin retirar", hoursAgo: 12},
				{from: model.StatusNoEntregado, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Devolviendo a remitente", hoursAgo: 10},
				{from: model.StatusAtHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en vehículo de regreso", hoursAgo: 8},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "En camino a sucursal de origen", hoursAgo: 6},
				{from: model.StatusInTransit, to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Llegó a sucursal de origen", hoursAgo: 2},
				{from: model.StatusAtOriginHub, to: model.StatusReadyForReturn, changedBy: "sistema", location: "caba", notes: "Envío de retorno llegó a sucursal de origen — listo para devolución", hoursAgo: 2},
			},
		},
		// Cancelled con contra-envío
		{
			trackingID:         "LT-CANCEL01",
			sender:             model.Customer{DNI: "22334455", Name: "Distribuidora Norte SA", Phone: "541144556677", Address: model.Address{Street: "Lavalle 1500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1048", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "31998877", Name: "Gabriel Moreno", Phone: "542614778899", Address: model.Address{Street: "España 350", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           4.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "mendoza",
			priority:           "baja",
			priorityScore:      0.20,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 36},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo", hoursAgo: 34},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Viaje iniciado", hoursAgo: 32},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Llegó a Córdoba", hoursAgo: 16},
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
			OriginBranchID:      s.events[0].location,
			FinalBranchID:       s.receivingBranchID,
			Priority:            s.priority,
			PriorityScore:       s.priorityScore,
			PriorityConfidence:  s.priorityConfidence,
			Status:              model.StatusAtOriginHub,
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
		Status:      model.RouteStatusPending,
	})
}
