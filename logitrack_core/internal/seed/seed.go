package seed

import (
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/projection"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
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
	deliveryMethod     model.DeliveryMethod
	receivingBranchID  string
	finalBranchID      string // si vacío, default = receivingBranchID
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
func Load(store repository.EventStore, proj projection.Projector, customerRepo repository.CustomerRepository, routeRepo repository.RouteRepository, branchRepo repository.BranchRepository, pricingSvc *service.PricingService) {
	existing, _ := store.LoadAll()
	if len(existing) > 0 {
		proj.Rebuild(existing)
		return
	}
	now := time.Now().UTC()

	// Datos sintéticos diseñados para que el operador de CABA, al ejecutar /routing,
	// vea un plan rico que cubre todas las reglas:
	//   • Última milla: 6 envíos en at_hub @ caba con final=caba (1 frágil, 1 express,
	//     varias prioridades) → bin-pack en el chofer disponible.
	//   • Inter-sucursal Córdoba (consolidación): 5 envíos at_origin_hub @ caba sumando
	//     400 kg → consolida (≥ 40 % de la van de 800 kg).
	//   • Inter-sucursal Mendoza (espera + piggyback): 2 envíos at_origin_hub @ caba
	//     sumando 20 kg → no llega a fill_rate, pero piggybackean en el despacho a
	//     Córdoba (Córdoba está más cerca de Mendoza que CABA).
	//   • Excluido del ruteo: 1 retiro_sucursal at_hub @ caba.
	// Más algunos envíos completados / cancelados / fuera de CABA para dashboard.
	seeds := []shipmentSeed{
		// ─────────────────────────────────────────────────────────────────────
		// 1) Última milla en CABA — at_hub @ caba, final = caba
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-LM00001",
			sender:             model.Customer{DNI: "27845123", Name: "Carlos Mendez", Phone: "543514455667", Email: "carlos.mendez@email.com", Address: model.Address{Street: "Av. Colón 123", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			recipient:          model.Customer{DNI: "31204567", Name: "Laura Gómez", Phone: "541166778899", Address: model.Address{Street: "Av. Corrientes 1500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1042", Latitude: fPtr(-34.6045), Longitude: fPtr(-58.3878)}},
			weightKg:           2.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "alta",
			priorityScore:      0.71,
			priorityConfidence: 0.80,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 30},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en EF456GH", hoursAgo: 28},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "En camino a CABA", hoursAgo: 26},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-LM00002",
			sender:             model.Customer{DNI: "29110456", Name: "María Acuña", Phone: "543514778899", Address: model.Address{Street: "9 de Julio 800", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			recipient:          model.Customer{DNI: "32556677", Name: "Federico Salas", Phone: "541199887700", Email: "fede.salas@gmail.com", Address: model.Address{Street: "Av. Cabildo 2400", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1428", Latitude: fPtr(-34.5605), Longitude: fPtr(-58.4585)}},
			weightKg:           7.8,
			packageType:        model.PackageBox,
			isFragile:          true,
			specialInstr:       "Frágil — vajilla de cerámica",
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.48,
			priorityConfidence: 0.74,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 30},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en EF456GH", hoursAgo: 28},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "En camino a CABA", hoursAgo: 26},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-LM00003",
			sender:             model.Customer{DNI: "30887766", Name: "Estudio Jurídico Pereyra", Phone: "543514112233", Email: "info@pereyra-legal.com", Address: model.Address{Street: "27 de Abril 250", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			recipient:          model.Customer{DNI: "28123456", Name: "Juliana Costa", Phone: "541133221144", Address: model.Address{Street: "Av. Santa Fe 3200", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1425", Latitude: fPtr(-34.5894), Longitude: fPtr(-58.4106)}},
			weightKg:           0.4,
			packageType:        model.PackageEnvelope,
			specialInstr:       "Documentos legales urgentes",
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			priority:           "alta",
			priorityScore:      0.73,
			priorityConfidence: 0.82,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 18},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en EF456GH", hoursAgo: 17},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "En camino a CABA", hoursAgo: 15},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 4},
			},
		},
		{
			trackingID:         "LT-LM00004",
			sender:             model.Customer{DNI: "26554433", Name: "Bodega del Plata", Phone: "542614556677", Address: model.Address{Street: "Av. San Martín 2100", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			recipient:          model.Customer{DNI: "33445566", Name: "Pablo Acosta", Phone: "541188776655", Address: model.Address{Street: "Av. Rivadavia 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1424", Latitude: fPtr(-34.6109), Longitude: fPtr(-58.4356)}},
			weightKg:           3.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "caba",
			priority:           "baja",
			priorityScore:      0.22,
			priorityConfidence: 0.79,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Envío registrado en Mendoza", hoursAgo: 48},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_mendoza", location: "mendoza", notes: "Cargado en vehículo", hoursAgo: 46},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_mendoza", location: "caba", notes: "Vehículo en camino a CABA", hoursAgo: 44},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 5},
			},
		},
		{
			trackingID:         "LT-LM00005",
			sender:             model.Customer{DNI: "21998877", Name: "Olivos Andinos SRL", Phone: "542614223344", Email: "ventas@olivosandinos.com", Address: model.Address{Street: "Av. España 800", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			recipient:          model.Customer{DNI: "30776655", Name: "Lucía Vera", Phone: "541177665544", Address: model.Address{Street: "Honduras 5400", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1414", Latitude: fPtr(-34.5856), Longitude: fPtr(-58.4338)}},
			weightKg:           11.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.45,
			priorityConfidence: 0.76,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Envío registrado en Mendoza", hoursAgo: 50},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_mendoza", location: "mendoza", notes: "Cargado en vehículo", hoursAgo: 48},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_mendoza", location: "caba", notes: "Vehículo en camino a CABA", hoursAgo: 46},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 5},
			},
		},
		{
			trackingID:         "LT-LM00006",
			sender:             model.Customer{DNI: "32443322", Name: "Pampa Distribuidora", Phone: "543514998877", Address: model.Address{Street: "Av. Vélez Sársfield 1300", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			recipient:          model.Customer{DNI: "29554433", Name: "Tomás Iglesias", Phone: "541144556699", Address: model.Address{Street: "Av. Las Heras 2900", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1425", Latitude: fPtr(-34.5862), Longitude: fPtr(-58.4015)}},
			weightKg:           5.6,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.42,
			priorityConfidence: 0.71,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 30},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en EF456GH", hoursAgo: 28},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "En camino a CABA", hoursAgo: 26},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 6},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// 2) Inter-sucursal CABA → Córdoba (consolidación, sum ≈ 400 kg)
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-CB00001",
			sender:             model.Customer{DNI: "30221100", Name: "Importadora Plaza", Phone: "541149998877", Email: "logistica@importadoraplaza.com", Address: model.Address{Street: "Av. Belgrano 1100", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1093", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "29445566", Name: "Distribuidora del Centro", Phone: "543514001100", Email: "contacto@distcentro.com", Address: model.Address{Street: "Bv. Illia 600", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           80,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			finalBranchID:      "cordoba",
			priority:           "alta",
			priorityScore:      0.66,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 8},
			},
		},
		{
			trackingID:         "LT-CB00002",
			sender:             model.Customer{DNI: "31998877", Name: "Repuestos del Sur", Phone: "541133445566", Address: model.Address{Street: "Av. La Plata 1800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1235", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "32445566", Name: "Taller Mecánico Córdoba", Phone: "543514778800", Address: model.Address{Street: "Av. Patria 990", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           100,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			finalBranchID:      "cordoba",
			priority:           "media",
			priorityScore:      0.50,
			priorityConfidence: 0.74,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 7},
			},
		},
		{
			trackingID:         "LT-CB00003",
			sender:             model.Customer{DNI: "27889900", Name: "Editorial Andina", Phone: "541166778899", Email: "envios@editorialandina.com", Address: model.Address{Street: "Hipólito Yrigoyen 1500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1089", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "28765432", Name: "Librería Universitaria", Phone: "543514112299", Email: "compras@libreriauni.com", Address: model.Address{Street: "Obispo Trejo 220", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           70,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			finalBranchID:      "cordoba",
			priority:           "media",
			priorityScore:      0.45,
			priorityConfidence: 0.72,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-CB00004",
			sender:             model.Customer{DNI: "26443322", Name: "Textil Norte", Phone: "541155997788", Address: model.Address{Street: "Av. Warnes 2300", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1416", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "30667788", Name: "Multitienda Córdoba", Phone: "543514889977", Address: model.Address{Street: "Independencia 700", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           90,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			finalBranchID:      "cordoba",
			priority:           "baja",
			priorityScore:      0.25,
			priorityConfidence: 0.81,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 5},
			},
		},
		{
			trackingID:         "LT-CB00005",
			sender:             model.Customer{DNI: "33667788", Name: "Farmacia Central", Phone: "541199887766", Email: "logistica@farmaciacentral.com", Address: model.Address{Street: "Av. Pueyrredón 1200", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1118", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "31334455", Name: "Hospital Privado Córdoba", Phone: "543514443322", Email: "compras@hpc.com.ar", Address: model.Address{Street: "Naciones Unidas 346", City: "Córdoba", Province: "Córdoba", PostalCode: "X5016", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           60,
			packageType:        model.PackageBox,
			specialInstr:       "Insumos médicos — refrigerado preferente",
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "caba",
			finalBranchID:      "cordoba",
			priority:           "alta",
			priorityScore:      0.69,
			priorityConfidence: 0.83,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 4},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// 3) Inter-sucursal CABA → Mendoza (espera + piggyback en Córdoba)
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-MZ00001",
			sender:             model.Customer{DNI: "29776655", Name: "Boutique Plaza", Phone: "541144998811", Address: model.Address{Street: "Av. Santa Fe 1800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1123", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "31889977", Name: "Eugenia Méndez", Phone: "542614332211", Address: model.Address{Street: "Las Heras 980", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           8,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			finalBranchID:      "mendoza",
			priority:           "baja",
			priorityScore:      0.20,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-MZ00002",
			sender:             model.Customer{DNI: "28443322", Name: "Tech Sur", Phone: "541133997788", Email: "envios@techsur.com.ar", Address: model.Address{Street: "Av. Córdoba 2500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1187", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "30221199", Name: "Andrés Bianchi", Phone: "542614887766", Email: "andres.bianchi@gmail.com", Address: model.Address{Street: "Belgrano 540", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           12,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "caba",
			finalBranchID:      "mendoza",
			priority:           "media",
			priorityScore:      0.41,
			priorityConfidence: 0.74,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 5},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// 4) Retiro en sucursal CABA — excluido del ruteo
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-PICKUP01",
			sender:             model.Customer{DNI: "27554433", Name: "MercadoLocal", Phone: "541177665533", Address: model.Address{Street: "Talcahuano 600", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1013", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "33112233", Name: "Sebastián Moyano", Phone: "541188554477", Address: model.Address{Street: "Mitre 890", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1036", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           2.4,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			deliveryMethod:     model.DeliveryMethodBranchPickup,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.40,
			priorityConfidence: 0.70,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 28},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo AB123CD", hoursAgo: 26},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "Vehículo en circuito interno", hoursAgo: 24},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Listo para retiro en mostrador", hoursAgo: 4},
				{from: model.StatusAtHub, to: model.StatusReadyForPickup, changedBy: "op_caba", location: "caba", notes: "Aviso al destinatario enviado", hoursAgo: 2},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// 5) Estado operativo en otras sucursales (variedad para dashboard)
		// ─────────────────────────────────────────────────────────────────────
		// Out for delivery — chofer_caba (ID 5) tiene este envío en su ruta de hoy
		{
			trackingID:         "LT-DELIVER01",
			sender:             model.Customer{DNI: "20111222", Name: "Tech Store SA", Phone: "543329550012", Address: model.Address{Street: "Av. San Martín 150", City: "San Pedro", Province: "Buenos Aires", PostalCode: "B2930", Latitude: fPtr(-33.6785), Longitude: fPtr(-59.6667)}},
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
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en AB123CD", hoursAgo: 22},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "Vehículo en circuito interno", hoursAgo: 20},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 8},
				{from: model.StatusAtHub, to: model.StatusOutForDelivery, changedBy: "sup_caba", location: "", notes: "Asignado a chofer para reparto", hoursAgo: 1, driverID: "5"},
			},
		},
		// Delivered en CABA (history para dashboard)
		{
			trackingID:         "LT-DEL00001",
			sender:             model.Customer{DNI: "20567412", Name: "Roberto Silva", Phone: "543513334455", Email: "rsilva@distribuidora.com", Address: model.Address{Street: "Colón 1010", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			recipient:          model.Customer{DNI: "34128956", Name: "Camila Rodríguez", Phone: "541166778899", Email: "camila.r@gmail.com", Address: model.Address{Street: "Av. Cabildo 3456", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1429", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			weightKg:           4.0,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			priority:           "media",
			priorityScore:      0.40,
			priorityConfidence: 0.71,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado", hoursAgo: 96},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_cordoba", location: "cordoba", notes: "Cargado en EF456GH", hoursAgo: 94},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_cordoba", location: "caba", notes: "Vehículo partió hacia CABA", hoursAgo: 90},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 48},
				{from: model.StatusAtHub, to: model.StatusOutForDelivery, changedBy: "sup_caba", location: "", notes: "Asignado a chofer", hoursAgo: 30, driverID: "5"},
				{from: model.StatusOutForDelivery, to: model.StatusDelivered, changedBy: "chofer_caba", location: "", notes: "Entregado al destinatario", hoursAgo: 24, driverID: "5"},
			},
		},
		// At_hub en Córdoba — pendiente de reparto, para que op_cordoba vea algo
		{
			trackingID:         "LT-CDB00001",
			sender:             model.Customer{DNI: "29667788", Name: "Estudio Multimedia", Phone: "541166554477", Address: model.Address{Street: "Av. Corrientes 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1195", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "30443322", Name: "Productora del Centro", Phone: "543514778800", Email: "operaciones@prodcentro.com", Address: model.Address{Street: "27 de Abril 800", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)}},
			weightKg:           3.0,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "cordoba",
			priority:           "media",
			priorityScore:      0.42,
			priorityConfidence: 0.72,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 28},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en AB123CD", hoursAgo: 26},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "cordoba", notes: "Vehículo partió hacia Córdoba", hoursAgo: 24},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_cordoba", location: "cordoba", notes: "Llegó a Córdoba", hoursAgo: 4},
			},
		},
		// At_hub en Mendoza — pendiente de reparto
		{
			trackingID:         "LT-MZH00001",
			sender:             model.Customer{DNI: "27887766", Name: "Editorial Andina", Phone: "541166778899", Address: model.Address{Street: "Hipólito Yrigoyen 1500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1089", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "28991122", Name: "Universidad Nacional de Cuyo", Phone: "542614001100", Email: "logistica@uncu.edu.ar", Address: model.Address{Street: "Centro Universitario", City: "Mendoza", Province: "Mendoza", PostalCode: "M5502", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           6.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "mendoza",
			priority:           "media",
			priorityScore:      0.46,
			priorityConfidence: 0.73,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 50},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en vehículo", hoursAgo: 48},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "mendoza", notes: "Vehículo partió hacia Mendoza", hoursAgo: 46},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_mendoza", location: "mendoza", notes: "Llegó a Mendoza", hoursAgo: 3},
			},
		},
	}

	for _, s := range seeds {
		createdAt := now.Add(-time.Duration(s.events[0].hoursAgo) * time.Hour)
		finalID := s.finalBranchID
		if finalID == "" {
			finalID = s.receivingBranchID
		}
		estimated := estimateDeliverySeed(createdAt, s.events[0].location, finalID, string(s.shipmentType), branchRepo)

		deliveryMethod := s.deliveryMethod
		if deliveryMethod == "" {
			deliveryMethod = model.DeliveryMethodLastMile
		}

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
			DeliveryMethod:      deliveryMethod,
			ReceivingBranchID:   s.receivingBranchID,
			OriginBranchID:      s.events[0].location,
			FinalBranchID:       finalID,
			Priority:            s.priority,
			PriorityScore:       s.priorityScore,
			PriorityConfidence:  s.priorityConfidence,
			Status:              model.StatusAtOriginHub,
			CurrentLocation:     s.events[0].location,
			CreatedAt:           createdAt,
			UpdatedAt:           createdAt,
			EstimatedDeliveryAt: estimated,
			PriceCurrency:       model.CurrencyARS,
		}
		if pricingSvc != nil {
			price, breakdown := pricingSvc.CalculateForShipment(initialShipment)
			initialShipment.Price = &price
			bd := breakdown
			initialShipment.PriceBreakdown = &bd
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

func estimateDeliverySeed(from time.Time, originBranchID, finalBranchID, shipmentType string, repo repository.BranchRepository) *time.Time {
	var distKm float64
	origin, okO := repo.GetByID(originBranchID)
	dest, okD := repo.GetByID(finalBranchID)
	if okO && okD && origin.Latitude != nil && origin.Longitude != nil && dest.Latitude != nil && dest.Longitude != nil {
		distKm = ml.HaversineKm(*origin.Latitude, *origin.Longitude, *dest.Latitude, *dest.Longitude)
	} else {
		originProv, destProv := "", ""
		if okO {
			originProv = origin.Province
		}
		if okD {
			destProv = dest.Province
		}
		distKm = ml.ComputeDistance(originProv, destProv)
	}
	days := ml.EstimateDeliveryDaysFromDistance(distKm, shipmentType)
	t := from.AddDate(0, 0, days)
	return &t
}
