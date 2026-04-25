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
			sender:             model.Customer{DNI: "27845123", Name: "Carlos Mendez", Phone: "541145237890", Email: "carlos.mendez@email.com", Address: model.Address{Street: "Av. Corrientes 1234", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043", Lat: -34.604462, Lng: -58.395836, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "31204567", Name: "Laura Gomez", Phone: "543516784321", Address: model.Address{Street: "San Martín 456", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Lat: -31.410771, Lng: -64.181685, GeoConfidence: "street"}},
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
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "operator1", location: "caba", notes: "Loaded onto vehicle AB123CD", hoursAgo: 46},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "operator1", location: "cordoba", notes: "Vehicle departed", hoursAgo: 44},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator2", location: "cordoba", notes: "Arrived at Córdoba branch", hoursAgo: 20},
			},
		},
		{
			trackingID:         "LT-E5F6G7H8",
			sender:             model.Customer{DNI: "29371084", Name: "Martina López", Phone: "541192345678", Address: model.Address{Street: "Av. del Libertador 500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001", Lat: -34.589496, Lng: -58.380844, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "25618930", Name: "Diego Fernández", Phone: "542619876543", Email: "dfernandez@empresa.com", Address: model.Address{Street: "Belgrano 321", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Lat: -33.082166, Lng: -68.467064, GeoConfidence: "street"}},
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
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "operator1", location: "caba", notes: "Loaded onto vehicle EF456GH", hoursAgo: 70},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "operator1", location: "mendoza", notes: "Vehicle departed", hoursAgo: 68},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "operator3", location: "mendoza", notes: "Arrived at Mendoza branch", hoursAgo: 36},
				{from: model.StatusAtBranch, to: model.StatusDelivered, changedBy: "operator3", location: "mendoza", notes: "Delivered to recipient", hoursAgo: 10},
			},
		},
		{
			trackingID:         "LT-I9J0K1L2",
			sender:             model.Customer{DNI: "33092715", Name: "Santiago Ruiz", Phone: "541194567890", Address: model.Address{Street: "Reconquista 720", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1003", Lat: -34.599411, Lng: -58.372786, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "36451820", Name: "Valentina Torres", Phone: "541199887766", Address: model.Address{Street: "Av. Santa Fe 2100", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1123", Lat: -34.595686, Lng: -58.397273, GeoConfidence: "street"}},
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
			sender:             model.Customer{DNI: "24783601", Name: "Ana Perez", Phone: "543881112233", Address: model.Address{Street: "Av. Colón 320", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Lat: -31.412274, Lng: -64.187459, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "28934075", Name: "Juan Castro", Phone: "542614334455", Address: model.Address{Street: "Belgrano 980", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Lat: -32.889930, Lng: -68.850251, GeoConfidence: "street"}},
			weightKg:           5.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "cordoba",
			priority:           "baja",
			priorityScore:      0.22,
			priorityConfidence: 0.79,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_cordoba", location: "cordoba", notes: "Shipment created", hoursAgo: 30},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_cordoba", location: "cordoba", notes: "Loaded onto vehicle EF456GH", hoursAgo: 28},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "mendoza", notes: "Vehicle departed towards Mendoza", hoursAgo: 26},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_mendoza", location: "mendoza", notes: "Arrived at Mendoza branch", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-Q7R8S9T0",
			sender:             model.Customer{DNI: "20567412", Name: "Roberto Silva", Phone: "543513334455", Email: "rsilva@distribuidora.com", Address: model.Address{Street: "Colón 1010", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Lat: -31.420100, Lng: -64.188800, GeoConfidence: "city"}},
			recipient:          model.Customer{DNI: "34128956", Name: "Camila Rodríguez", Phone: "541166778899", Email: "camila.r@gmail.com", Address: model.Address{Street: "Av. Cabildo 3456", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1429", Lat: -34.551300, Lng: -58.466557, GeoConfidence: "street"}},
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
				{from: "", to: model.StatusInProgress, changedBy: "op_cordoba", location: "cordoba", notes: "Shipment created", hoursAgo: 96},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_cordoba", location: "cordoba", notes: "Loaded onto vehicle EF456GH", hoursAgo: 94},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "Vehicle departed towards Buenos Aires", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_caba", location: "caba", notes: "Arrived at CABA branch", hoursAgo: 48},
				{from: model.StatusAtBranch, to: model.StatusDelivered, changedBy: "op_caba", location: "caba", notes: "Delivered successfully", hoursAgo: 24},
			},
		},
		{
			trackingID:         "LT-U1V2W3X4",
			sender:             model.Customer{DNI: "31760294", Name: "Florencia Díaz", Phone: "541122334455", Address: model.Address{Street: "Pueyrredón 678", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1032", Lat: -34.612242, Lng: -58.442177, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "26843019", Name: "Nicolás Herrera", Phone: "542945567788", Address: model.Address{Street: "San Martín 200", City: "Río Gallegos", Province: "Santa Cruz", PostalCode: "Z9400", Lat: -51.641931, Lng: -69.225573, GeoConfidence: "street"}},
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
			sender:             model.Customer{DNI: "20111222", Name: "Tech Store SA", Phone: "5433295500112", Address: model.Address{Street: "Av. San Martín 150", City: "San Pedro", Province: "Buenos Aires", PostalCode: "B2930", Lat: -33.658631, Lng: -59.868299, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "30123456", Name: "Marcela Suárez", Phone: "541144332211", Address: model.Address{Street: "Larrea 1450", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1117", Lat: -34.590378, Lng: -58.399011, GeoConfidence: "street"}},
			weightKg:           1.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.18,
			priorityConfidence: 0.84,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_caba", location: "caba", notes: "Shipment created", hoursAgo: 24},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_caba", location: "caba", notes: "Loaded onto vehicle AB123CD", hoursAgo: 22},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "Vehicle departed", hoursAgo: 20},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_caba", location: "caba", notes: "Arrived at CABA branch", hoursAgo: 8},
				{from: model.StatusAtBranch, to: model.StatusDelivering, changedBy: "sup_caba", location: "", notes: "Assigned to driver for last-mile delivery", hoursAgo: 1, driverID: "5"},
			},
		},
		{
			trackingID:         "LT-DELIVER02",
			sender:             model.Customer{DNI: "20333444", Name: "Librería El Quijote", Phone: "543517788990", Address: model.Address{Street: "Obispo Trejo 145", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Lat: -31.417272, Lng: -64.185968, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "28456789", Name: "Tomás Villanueva", Phone: "541166554433", Address: model.Address{Street: "Av. Santa Fe 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1425", Lat: -34.579494, Lng: -58.424418, GeoConfidence: "street"}},
			weightKg:           0.8,
			packageType:        model.PackageEnvelope,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			priority:           "baja",
			priorityScore:      0.11,
			priorityConfidence: 0.88,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_cordoba", location: "cordoba", notes: "Shipment created", hoursAgo: 12},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_cordoba", location: "cordoba", notes: "Loaded onto vehicle EF456GH", hoursAgo: 11},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "Vehicle departed towards Buenos Aires", hoursAgo: 10},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_caba", location: "caba", notes: "Arrived at CABA branch — ready for delivery", hoursAgo: 5},
			},
		},
		// CABA branch shipments
		{
			trackingID:         "LT-CABA0001",
			sender:             model.Customer{DNI: "32111222", Name: "Agustina Peralta", Phone: "541155667788", Address: model.Address{Street: "Thames 1200", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1414", Lat: -34.590511, Lng: -58.434823, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "29887766", Name: "Ricardo Montes", Phone: "543513221100", Address: model.Address{Street: "Bv. San Juan 750", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Lat: -31.419674, Lng: -64.191046, GeoConfidence: "street"}},
			weightKg:           4.0,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.20,
			priorityConfidence: 0.80,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_caba", location: "caba", notes: "Shipment registered at CABA branch", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-CABA0002",
			sender:             model.Customer{DNI: "27334455", Name: "Luciana Benítez", Phone: "541133445566", Address: model.Address{Street: "Av. Rivadavia 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1424", Lat: -34.614846, Lng: -58.428388, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "31667788", Name: "Pablo Acosta", Phone: "543513221199", Address: model.Address{Street: "Bv. San Juan 400", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Lat: -31.419674, Lng: -64.191046, GeoConfidence: "street"}},
			weightKg:           1.5,
			packageType:        model.PackageEnvelope,
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "alta",
			priorityScore:      0.70,
			priorityConfidence: 0.77,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_caba", location: "caba", notes: "Shipment registered at CABA branch", hoursAgo: 30},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_caba", location: "caba", notes: "Loaded onto vehicle AB123CD", hoursAgo: 28},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Vehicle departed towards Córdoba", hoursAgo: 26},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_cordoba", location: "cordoba", notes: "Arrived at Córdoba branch", hoursAgo: 4},
			},
		},
		{
			trackingID:         "LT-CABA0003",
			sender:             model.Customer{DNI: "25990011", Name: "Fernando Ibáñez", Phone: "541177889900", Address: model.Address{Street: "Corrientes 3400", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1193", Lat: -34.604262, Lng: -58.413098, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "33445566", Name: "Natalia Ponce", Phone: "541188990011", Address: model.Address{Street: "Mitre 890", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1036", Lat: -34.631430, Lng: -58.441663, GeoConfidence: "street"}},
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
				{from: "", to: model.StatusInProgress, changedBy: "op_caba", location: "caba", notes: "Shipment registered at CABA branch", hoursAgo: 18},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_caba", location: "caba", notes: "Loaded onto vehicle AB123CD", hoursAgo: 16},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "Vehicle departed", hoursAgo: 14},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_caba", location: "caba", notes: "Arrived at destination branch — ready for last-mile", hoursAgo: 3},
			},
		},
		// Mendoza branch shipments
		{
			trackingID:         "LT-MEND0001",
			sender:             model.Customer{DNI: "28223344", Name: "Daniela Vargas", Phone: "542614443322", Address: model.Address{Street: "Av. San Martín 980", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Lat: -32.914625, Lng: -68.845815, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "30556677", Name: "Sebastián Ortiz", Phone: "541199001122", Address: model.Address{Street: "Av. Callao 1200", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1023", Lat: -34.606810, Lng: -58.392123, GeoConfidence: "street"}},
			weightKg:           7.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "mendoza",
			priority:           "baja",
			priorityScore:      0.25,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_mendoza", location: "mendoza", notes: "Shipment registered at Mendoza branch", hoursAgo: 4},
			},
		},
		{
			trackingID:         "LT-MEND0002",
			sender:             model.Customer{DNI: "26778899", Name: "Cecilia Romero", Phone: "542614556677", Address: model.Address{Street: "Belgrano 450", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Lat: -33.082540, Lng: -68.465230, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "34112233", Name: "Gustavo Medina", Phone: "541155443322", Address: model.Address{Street: "Av. Corrientes 800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043", Lat: -34.603817, Lng: -58.377745, GeoConfidence: "street"}},
			weightKg:           11.0,
			packageType:        model.PackagePallet,
			isFragile:          true,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "mendoza",
			priority:           "media",
			priorityScore:      0.42,
			priorityConfidence: 0.74,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_mendoza", location: "mendoza", notes: "Shipment registered at Mendoza branch", hoursAgo: 22},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_mendoza", location: "mendoza", notes: "Loaded onto vehicle EF456GH", hoursAgo: 20},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_mendoza", location: "caba", notes: "Vehicle departed towards Buenos Aires", hoursAgo: 18},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_caba", location: "caba", notes: "Arrived at CABA branch", hoursAgo: 2},
			},
		},
		{
			trackingID:         "LT-MEND0003",
			sender:             model.Customer{DNI: "21334455", Name: "Horacio Blanco", Phone: "542614112233", Address: model.Address{Street: "Las Heras 600", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Lat: -32.885015, Lng: -68.846153, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "29001122", Name: "Inés Carrizo", Phone: "542646334455", Address: model.Address{Street: "Av. Libertador 300", City: "San Juan", Province: "San Juan", PostalCode: "J5400", Lat: -31.533535, Lng: -68.516437, GeoConfidence: "street"}},
			weightKg:           3.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "mendoza",
			priority:           "alta",
			priorityScore:      0.68,
			priorityConfidence: 0.76,
			events: []eventSeed{
				{from: "", to: model.StatusInProgress, changedBy: "op_mendoza", location: "mendoza", notes: "Shipment registered at Mendoza branch", hoursAgo: 60},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_mendoza", location: "mendoza", notes: "Loaded onto vehicle EF456GH", hoursAgo: 58},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_mendoza", location: "mendoza", notes: "Vehicle departed towards San Juan", hoursAgo: 56},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_mendoza", location: "mendoza", notes: "Arrived — preparing for last-mile delivery", hoursAgo: 30},
				{from: model.StatusAtBranch, to: model.StatusDelivered, changedBy: "op_mendoza", location: "mendoza", notes: "Delivered to recipient", hoursAgo: 12},
			},
		},
		// Multi-hop shipment: Ciudad de Buenos Aires → Córdoba → Mendoza
		{
			trackingID:         "LT-MULTI001",
			sender:             model.Customer{DNI: "30500112", Name: "Empresa Distribuidora SA", Phone: "541150001234", Email: "despachos@distribuidora.com", Address: model.Address{Street: "Av. del Libertador 1000", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1001", Lat: -34.543079, Lng: -58.461568, GeoConfidence: "street"}},
			recipient:          model.Customer{DNI: "22917463", Name: "Clínica Regional Cuyo", Phone: "542614220000", Address: model.Address{Street: "Av. San Martín 1500", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Lat: -33.133808, Lng: -68.890263, GeoConfidence: "street"}},
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
				{from: "", to: model.StatusInProgress, changedBy: "op_caba", location: "caba", notes: "Shipment created", hoursAgo: 120},
				{from: model.StatusInProgress, to: model.StatusPreTransit, changedBy: "op_caba", location: "caba", notes: "Loaded onto vehicle AB123CD", hoursAgo: 118},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Vehicle departed from CABA", hoursAgo: 116},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_cordoba", location: "cordoba", notes: "Arrived at Córdoba hub — transfer to western route", hoursAgo: 96},
				{from: model.StatusAtBranch, to: model.StatusPreTransit, changedBy: "op_cordoba", location: "cordoba", notes: "Loaded onto vehicle EF456GH for Mendoza leg", hoursAgo: 93},
				{from: model.StatusPreTransit, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "mendoza", notes: "Vehicle departed Córdoba towards Mendoza", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtBranch, changedBy: "op_mendoza", location: "mendoza", notes: "Arrived at Mendoza branch — awaiting recipient pickup", hoursAgo: 12},
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
			OriginBranchID:      s.receivingBranchID,
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
