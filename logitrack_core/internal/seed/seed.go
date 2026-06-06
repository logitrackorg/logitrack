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
		// ── CABA — 2 furgonetas inter-sucursal, 2 autos última milla ──────────
		{
			LicensePlate:     "AB100IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       1500,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("caba"),
			CurrentLatitude:  fPtr(-34.6037),
			CurrentLongitude: fPtr(-58.3816),
		},
		{
			LicensePlate:     "AB200IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       1500,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("caba"),
			CurrentLatitude:  fPtr(-34.6037),
			CurrentLongitude: fPtr(-58.3816),
		},
		{
			LicensePlate:     "AB100UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("caba"),
			CurrentLatitude:  fPtr(-34.6037),
			CurrentLongitude: fPtr(-58.3816),
		},
		{
			LicensePlate:     "AB200UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("caba"),
			CurrentLatitude:  fPtr(-34.6037),
			CurrentLongitude: fPtr(-58.3816),
		},
		// ── Córdoba — 2 furgonetas inter-sucursal, 2 autos última milla ───────
		{
			LicensePlate:     "CO100IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       1500,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("cordoba"),
			CurrentLatitude:  fPtr(-31.4201),
			CurrentLongitude: fPtr(-64.1888),
		},
		{
			LicensePlate:     "CO200IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       1500,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("cordoba"),
			CurrentLatitude:  fPtr(-31.4201),
			CurrentLongitude: fPtr(-64.1888),
		},
		{
			LicensePlate:     "CO100UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("cordoba"),
			CurrentLatitude:  fPtr(-31.4201),
			CurrentLongitude: fPtr(-64.1888),
		},
		{
			LicensePlate:     "CO200UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("cordoba"),
			CurrentLatitude:  fPtr(-31.4201),
			CurrentLongitude: fPtr(-64.1888),
		},
		// ── Mendoza — 2 furgonetas inter-sucursal, 2 autos última milla ───────
		{
			// ME100IS tiene capacidad reducida (900 kg) para que gane el backhaul
			// frente a los vehículos de Posadas (1500 kg): score ME100IS =
			// (700+660)/(2×900) = 75.6 % vs Posadas (660+700)/(2×1500) = 45.3 %.
			// El vehículo más pequeño se aprovecha mejor en el round-trip.
			LicensePlate:     "ME100IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       900,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("mendoza"),
			CurrentLatitude:  fPtr(-32.8908),
			CurrentLongitude: fPtr(-68.8272),
		},
		{
			LicensePlate:     "ME200IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       1500,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("mendoza"),
			CurrentLatitude:  fPtr(-32.8908),
			CurrentLongitude: fPtr(-68.8272),
		},
		{
			LicensePlate:     "ME100UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("mendoza"),
			CurrentLatitude:  fPtr(-32.8908),
			CurrentLongitude: fPtr(-68.8272),
		},
		{
			LicensePlate:     "ME200UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("mendoza"),
			CurrentLatitude:  fPtr(-32.8908),
			CurrentLongitude: fPtr(-68.8272),
		},
		// ── Posadas — 2 furgonetas inter-sucursal, 2 autos última milla ───────
		{
			LicensePlate:     "PO100IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       1500,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("posadas"),
			CurrentLatitude:  fPtr(-27.3671),
			CurrentLongitude: fPtr(-55.8965),
		},
		{
			LicensePlate:     "PO200IS",
			Type:             model.VehicleTypeVan,
			Mode:             model.VehicleModeInterBranch,
			CapacityKg:       1500,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("posadas"),
			CurrentLatitude:  fPtr(-27.3671),
			CurrentLongitude: fPtr(-55.8965),
		},
		{
			LicensePlate:     "PO100UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("posadas"),
			CurrentLatitude:  fPtr(-27.3671),
			CurrentLongitude: fPtr(-55.8965),
		},
		{
			LicensePlate:     "PO200UM",
			Type:             model.VehicleTypeCar,
			Mode:             model.VehicleModeLastMile,
			CapacityKg:       350,
			Status:           model.VehicleStatusAvailable,
			AssignedBranch:   strPtr("posadas"),
			CurrentLatitude:  fPtr(-27.3671),
			CurrentLongitude: fPtr(-55.8965),
		},
	}
	for _, v := range vehicles {
		err := repo.Add(v)
		if err != nil && err != repository.ErrDuplicateLicensePlate {
			panic("failed to seed vehicle " + v.LicensePlate + ": " + err.Error())
		}
		// Sincronizar el modo idempotentemente: aunque el vehículo ya exista en DB
		// (por arranques previos o migraciones que lo hayan tocado), garantizamos
		// que el seed deja el modo canónico configurado acá.
		if err := repo.SyncMode(v.LicensePlate, v.Mode); err != nil {
			panic("failed to sync mode for " + v.LicensePlate + ": " + err.Error())
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
	//
	// Escenario de backhauling Mendoza ↔ Posadas:
	//   • OUTBOUND (Mendoza → Posadas): 5 envíos at_origin_hub en Mendoza, aceite de oliva
	//     y vinos en conserva, 140 kg c/u = 700 kg total → consolida (700/1500 = 47% > 40%).
	//   • BACKHAUL (Posadas → Mendoza): 4 envíos at_hub en Posadas, yerba mate y productos
	//     regionales de Misiones con destino final Mendoza, 165 kg c/u = 660 kg total → también
	//     consolida (660/1500 = 44% > 40%). El motor detecta que la misma furgoneta puede
	//     volver cargada → arma el round-trip Mendoza → Posadas → Mendoza.
	//
	// Para ver el escenario: login como op_mendoza, ir a /inter-sucursal, "Generar plan".
	// El despacho a Posadas debe mostrar el badge "↩ Backhaul" y el modal indica el retorno.
	seeds := []shipmentSeed{
		// ─────────────────────────────────────────────────────────────────────
		// 1) Última milla en CABA — at_hub @ caba, final = caba
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-LM00001",
			sender:             model.Customer{DNI: "27845123", Name: "Carlos Mendez", Phone: "543514455667", Email: "carlos.mendez@email.com", Address: model.Address{Street: "Av. Colón 123", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4165), Longitude: fPtr(-64.1840)}},
			recipient:          model.Customer{DNI: "31204567", Name: "Laura Gómez", Phone: "541166778899", Address: model.Address{Street: "Av. Cabildo 3680", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1429", Latitude: fPtr(-34.5490), Longitude: fPtr(-58.4735)}},
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
			sender:             model.Customer{DNI: "29110456", Name: "María Acuña", Phone: "543514778899", Address: model.Address{Street: "9 de Julio 800", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4195), Longitude: fPtr(-64.1852)}},
			recipient:          model.Customer{DNI: "32556677", Name: "Federico Salas", Phone: "541199887700", Email: "fede.salas@gmail.com", Address: model.Address{Street: "Av. Montes de Oca 1800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1270", Latitude: fPtr(-34.6487), Longitude: fPtr(-58.3870)}},
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
			sender:             model.Customer{DNI: "30887766", Name: "Estudio Jurídico Pereyra", Phone: "543514112233", Email: "info@pereyra-legal.com", Address: model.Address{Street: "27 de Abril 250", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4148), Longitude: fPtr(-64.1862)}},
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
			sender:             model.Customer{DNI: "26554433", Name: "Bodega del Plata", Phone: "542614556677", Address: model.Address{Street: "Av. San Martín 2100", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8820), Longitude: fPtr(-68.8482)}},
			recipient:          model.Customer{DNI: "33445566", Name: "Pablo Acosta", Phone: "541188776655", Address: model.Address{Street: "Av. Rivadavia 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1424", Latitude: fPtr(-34.6109), Longitude: fPtr(-58.4356)}},
			weightKg:           3.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible, // flexible para que la demo de modo Segura funcione a cualquier hora del día
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
			sender:             model.Customer{DNI: "21998877", Name: "Olivos Andinos SRL", Phone: "542614223344", Email: "ventas@olivosandinos.com", Address: model.Address{Street: "Av. España 800", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8938), Longitude: fPtr(-68.8423)}},
			recipient:          model.Customer{DNI: "30776655", Name: "Lucía Vera", Phone: "541177665544", Address: model.Address{Street: "Av. Corrientes 4700", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1195", Latitude: fPtr(-34.6053), Longitude: fPtr(-58.4374)}},
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
			sender:             model.Customer{DNI: "32443322", Name: "Pampa Distribuidora", Phone: "543514998877", Address: model.Address{Street: "Av. Vélez Sársfield 1300", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4325), Longitude: fPtr(-64.1978)}},
			recipient:          model.Customer{DNI: "29554433", Name: "Tomás Iglesias", Phone: "541144556699", Address: model.Address{Street: "Av. San Juan 3400", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1231", Latitude: fPtr(-34.6303), Longitude: fPtr(-58.4320)}},
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

		// Última milla a destino en zona peligrosa (José L. Suárez) — recargo aplicado
		{
			trackingID:         "LT-LM00007",
			sender:             model.Customer{DNI: "27998877", Name: "Mariano Ruiz", Phone: "541144112233", Email: "mariano.ruiz@email.com", Address: model.Address{Street: "Av. Corrientes 2400", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1046", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "33445566", Name: "Sandra Pereyra", Phone: "541166778800", Address: model.Address{Street: "Av. San Martín 4500", City: "José León Suárez", Province: "Buenos Aires", PostalCode: "B1655", Latitude: fPtr(-34.535), Longitude: fPtr(-58.560)}},
			weightKg:           3.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "caba",
			finalBranchID:      "caba",
			priority:           "media",
			priorityScore:      0.55,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 18},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado para circuito interno", hoursAgo: 14},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "En tránsito", hoursAgo: 10},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA, listo para última milla", hoursAgo: 4},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// 2) Inter-sucursal CABA → Córdoba (consolidación, sum ≈ 400 kg)
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-CB00001",
			sender:             model.Customer{DNI: "30221100", Name: "Importadora Plaza", Phone: "541149998877", Email: "logistica@importadoraplaza.com", Address: model.Address{Street: "Av. Belgrano 1100", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1093", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "29445566", Name: "Distribuidora del Centro", Phone: "543514001100", Email: "contacto@distcentro.com", Address: model.Address{Street: "Bv. Illia 600", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4232), Longitude: fPtr(-64.1812)}},
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
			recipient:          model.Customer{DNI: "32445566", Name: "Taller Mecánico Córdoba", Phone: "543514778800", Address: model.Address{Street: "Av. Patria 990", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4255), Longitude: fPtr(-64.1762)}},
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
			recipient:          model.Customer{DNI: "28765432", Name: "Librería Universitaria", Phone: "543514112299", Email: "compras@libreriauni.com", Address: model.Address{Street: "Obispo Trejo 220", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4172), Longitude: fPtr(-64.1855)}},
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
			recipient:          model.Customer{DNI: "30667788", Name: "Multitienda Córdoba", Phone: "543514889977", Address: model.Address{Street: "Independencia 700", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4208), Longitude: fPtr(-64.1833)}},
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
			recipient:          model.Customer{DNI: "31334455", Name: "Hospital Privado Córdoba", Phone: "543514443322", Email: "compras@hpc.com.ar", Address: model.Address{Street: "Naciones Unidas 346", City: "Córdoba", Province: "Córdoba", PostalCode: "X5016", Latitude: fPtr(-31.4292), Longitude: fPtr(-64.1938)}},
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
		{
			trackingID:         "LT-CB00006",
			sender:             model.Customer{DNI: "31223344", Name: "Importadora del Sur", Phone: "541122887766", Email: "logistica@impsur.com", Address: model.Address{Street: "Av. del Libertador 5000", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1426", Latitude: fPtr(-34.5639), Longitude: fPtr(-58.4502)}},
			recipient:          model.Customer{DNI: "29776688", Name: "Mayorista Centro Córdoba", Phone: "543514778833", Email: "ventas@mayoristacentro.com.ar", Address: model.Address{Street: "Av. Colón 2400", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4090), Longitude: fPtr(-64.2154)}},
			weightKg:           220,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			finalBranchID:      "cordoba",
			priority:           "media",
			priorityScore:      0.55,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 3},
			},
		},
		{
			trackingID:         "LT-CB00007",
			sender:             model.Customer{DNI: "30556677", Name: "Distribuidora Norte", Phone: "541133224488", Address: model.Address{Street: "Av. General Paz 1200", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1407", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.4900)}},
			recipient:          model.Customer{DNI: "28991100", Name: "Logística Mediterránea SA", Phone: "543514665544", Email: "compras@logmed.com.ar", Address: model.Address{Street: "Av. Sabattini 3500", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4287), Longitude: fPtr(-64.1568)}},
			weightKg:           160,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "caba",
			finalBranchID:      "cordoba",
			priority:           "baja",
			priorityScore:      0.28,
			priorityConfidence: 0.72,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado en CABA", hoursAgo: 2},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// 3) Inter-sucursal CABA → Mendoza (espera + piggyback en Córdoba)
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-MZ00001",
			sender:             model.Customer{DNI: "29776655", Name: "Boutique Plaza", Phone: "541144998811", Address: model.Address{Street: "Av. Santa Fe 1800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1123", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "31889977", Name: "Eugenia Méndez", Phone: "542614332211", Address: model.Address{Street: "Las Heras 980", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8858), Longitude: fPtr(-68.8308)}},
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
			recipient:          model.Customer{DNI: "30221199", Name: "Andrés Bianchi", Phone: "542614887766", Email: "andres.bianchi@gmail.com", Address: model.Address{Street: "Belgrano 540", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8896), Longitude: fPtr(-68.8350)}},
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
		// En sucursal de destino (CABA) — listo para última milla
		{
			trackingID:         "LT-DELIVER01",
			sender:             model.Customer{DNI: "20111222", Name: "Tech Store SA", Phone: "543329550012", Address: model.Address{Street: "Av. San Martín 150", City: "San Pedro", Province: "Buenos Aires", PostalCode: "B2930", Latitude: fPtr(-33.6785), Longitude: fPtr(-59.6667)}},
			recipient:          model.Customer{DNI: "30123456", Name: "Marcela Suárez", Phone: "541144332211", Address: model.Address{Street: "Larrea 1450", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1117", Latitude: fPtr(-34.5877), Longitude: fPtr(-58.3972)}},
			weightKg:           1.2,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowAfternoon,
			receivingBranchID:  "caba",
			finalBranchID:      "caba",
			priority:           "baja",
			priorityScore:      0.18,
			priorityConfidence: 0.84,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_caba", location: "caba", notes: "Envío registrado", hoursAgo: 24},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_caba", location: "caba", notes: "Cargado en AB123CD", hoursAgo: 22},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "sup_caba", location: "caba", notes: "Vehículo en circuito interno", hoursAgo: 20},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_caba", location: "caba", notes: "Llegó a CABA", hoursAgo: 8},
			},
		},
		// At_hub en Córdoba — pendiente de reparto, para que op_cordoba vea algo
		{
			trackingID:         "LT-CDB00001",
			sender:             model.Customer{DNI: "29667788", Name: "Estudio Multimedia", Phone: "541166554477", Address: model.Address{Street: "Av. Corrientes 4500", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1195", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)}},
			recipient:          model.Customer{DNI: "30443322", Name: "Productora del Centro", Phone: "543514778800", Email: "operaciones@prodcentro.com", Address: model.Address{Street: "27 de Abril 800", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4175), Longitude: fPtr(-64.1878)}},
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
			recipient:          model.Customer{DNI: "28991122", Name: "Universidad Nacional de Cuyo", Phone: "542614001100", Email: "logistica@uncu.edu.ar", Address: model.Address{Street: "Centro Universitario", City: "Mendoza", Province: "Mendoza", PostalCode: "M5502", Latitude: fPtr(-32.8878), Longitude: fPtr(-68.8498)}},
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

		// ─────────────────────────────────────────────────────────────────────
		// 6) Sucursal Posadas — última milla y despacho inter-sucursal
		// ─────────────────────────────────────────────────────────────────────
		// at_hub en Posadas — última milla, envío express mañana (alta prioridad)
		{
			trackingID:         "LT-POS00001",
			sender:             model.Customer{DNI: "30556677", Name: "Farmacia Del Pueblo", Phone: "543764220011", Email: "ventas@farmaciapueblo.com.ar", Address: model.Address{Street: "San Martín 1200", City: "Corrientes", Province: "Corrientes", PostalCode: "W3400", Latitude: fPtr(-27.4692), Longitude: fPtr(-58.8306)}},
			recipient:          model.Customer{DNI: "32119988", Name: "Gabriela Insaurralde", Phone: "543752401234", Address: model.Address{Street: "San Lorenzo 1480", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3712), Longitude: fPtr(-55.8948)}},
			weightKg:           1.8,
			packageType:        model.PackageBox,
			specialInstr:       "Medicamentos — conservar temperatura ambiente",
			shipmentType:       model.ShipmentTypeExpress,
			timeWindow:         model.TimeWindowMorning,
			receivingBranchID:  "posadas",
			finalBranchID:      "posadas",
			priority:           "alta",
			priorityScore:      0.78,
			priorityConfidence: 0.85,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_posadas", location: "posadas", notes: "Envío registrado en Posadas", hoursAgo: 20},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_posadas", location: "posadas", notes: "Cargado en vehículo local", hoursAgo: 18},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "op_posadas", location: "posadas", notes: "Circuito interno Posadas", hoursAgo: 16},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_posadas", location: "posadas", notes: "Llegó a sucursal Posadas", hoursAgo: 5},
			},
		},
		// at_hub en Posadas — última milla, ventana flexible (prioridad media)
		{
			trackingID:         "LT-POS00002",
			sender:             model.Customer{DNI: "28443311", Name: "Mueblería Norteña", Phone: "543764338800", Address: model.Address{Street: "Av. Hipólito Yrigoyen 2300", City: "Resistencia", Province: "Chaco", PostalCode: "H3500", Latitude: fPtr(-27.4511), Longitude: fPtr(-58.9867)}},
			recipient:          model.Customer{DNI: "33667700", Name: "Ernesto Cabral", Phone: "543752558899", Email: "ernesto.cabral@gmail.com", Address: model.Address{Street: "Bolívar 870", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3698), Longitude: fPtr(-55.8960)}},
			weightKg:           14.5,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "posadas",
			finalBranchID:      "posadas",
			priority:           "media",
			priorityScore:      0.44,
			priorityConfidence: 0.72,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_posadas", location: "posadas", notes: "Envío registrado en Posadas", hoursAgo: 36},
				{from: model.StatusAtOriginHub, to: model.StatusLoaded, changedBy: "op_posadas", location: "posadas", notes: "Cargado en vehículo local", hoursAgo: 34},
				{from: model.StatusLoaded, to: model.StatusInTransit, changedBy: "op_posadas", location: "posadas", notes: "Circuito interno Posadas", hoursAgo: 32},
				{from: model.StatusInTransit, to: model.StatusAtHub, changedBy: "op_posadas", location: "posadas", notes: "Llegó a sucursal Posadas", hoursAgo: 7},
			},
		},
		// at_origin_hub en Posadas — inter-sucursal hacia CABA (esperando consolidación)
		{
			trackingID:         "LT-POS00003",
			sender:             model.Customer{DNI: "26778855", Name: "Yerbatería San Ignacio", Phone: "543752667733", Email: "exportaciones@yerbaterasanignacio.com", Address: model.Address{Street: "Av. Costanera 950", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3668), Longitude: fPtr(-55.9015)}},
			recipient:          model.Customer{DNI: "31990044", Name: "Distribuidora Litoral SA", Phone: "541155443300", Email: "compras@distribuidoralitoral.com", Address: model.Address{Street: "Av. Juan B. Justo 3800", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1416", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.4356)}},
			weightKg:           42.0,
			packageType:        model.PackageBox,
			specialInstr:       "Yerba mate a granel — mantener seco",
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "posadas",
			finalBranchID:      "caba",
			priority:           "baja",
			priorityScore:      0.28,
			priorityConfidence: 0.76,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_posadas", location: "posadas", notes: "Envío registrado en Posadas", hoursAgo: 10},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// 6) Inter-sucursal Córdoba → Mendoza (consolidación cross-branch)
		//
		// Estos envíos van en at_origin_hub en Córdoba con destino Mendoza.
		// Al correr el plan global, Córdoba intenta consolidarlos en un despacho
		// propio (760 kg total, 760/1500 = 51% > 40%) — consolida.
		// Cuando CABA arma su multi-hop CABA → Córdoba → Mendoza (porque tiene
		// LT-MZ00001/LT-MZ00002), `consolidateCrossBranchDispatches` absorbe el
		// dispatch de Córdoba dentro del camión de CABA: el operador ve 1 solo
		// vehículo haciendo el viaje en vez de 2.
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-CDB00010",
			sender:             model.Customer{DNI: "30887766", Name: "Aceitera del Centro", Phone: "543514110099", Email: "envios@aceiteradelcentro.com", Address: model.Address{Street: "Av. Vélez Sarsfield 800", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4232), Longitude: fPtr(-64.1812)}},
			recipient:          model.Customer{DNI: "27554411", Name: "Mercado Central Mendoza", Phone: "542614001188", Email: "compras@mcmza.com.ar", Address: model.Address{Street: "Av. Las Tipas 1450", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           180,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			finalBranchID:      "mendoza",
			priority:           "media",
			priorityScore:      0.48,
			priorityConfidence: 0.76,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 9},
			},
		},
		{
			trackingID:         "LT-CDB00011",
			sender:             model.Customer{DNI: "29445500", Name: "Industrias Sierras", Phone: "543514998800", Address: model.Address{Street: "Bv. Las Heras 250", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4135), Longitude: fPtr(-64.1820)}},
			recipient:          model.Customer{DNI: "28992233", Name: "Construcciones Andinas SA", Phone: "542614223377", Email: "logistica@construandinas.com", Address: model.Address{Street: "Calle San Martín 900", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8895), Longitude: fPtr(-68.8350)}},
			weightKg:           200,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			finalBranchID:      "mendoza",
			priority:           "alta",
			priorityScore:      0.62,
			priorityConfidence: 0.80,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 7},
			},
		},
		{
			trackingID:         "LT-CDB00012",
			sender:             model.Customer{DNI: "31660033", Name: "Vinos del Suquía", Phone: "543514889977", Email: "ventas@vinosdelsuquia.com", Address: model.Address{Street: "Av. Recta Martinolli 4500", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.3852), Longitude: fPtr(-64.2308)}},
			recipient:          model.Customer{DNI: "30443322", Name: "Vinoteca Cuyana", Phone: "542614778822", Email: "pedidos@vinotecacuyana.com.ar", Address: model.Address{Street: "Av. Sarmiento 600", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8420)}},
			weightKg:           220,
			packageType:        model.PackageBox,
			specialInstr:       "Manipular con cuidado — botellas",
			isFragile:          true,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			finalBranchID:      "mendoza",
			priority:           "media",
			priorityScore:      0.52,
			priorityConfidence: 0.74,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-CDB00013",
			sender:             model.Customer{DNI: "27887700", Name: "Maquinarias del Plata", Phone: "543514557799", Address: model.Address{Street: "Av. Colón 2100", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000", Latitude: fPtr(-31.4068), Longitude: fPtr(-64.2152)}},
			recipient:          model.Customer{DNI: "29110022", Name: "Maquinarias Cuyo SRL", Phone: "542614110055", Email: "compras@maqcuyo.com.ar", Address: model.Address{Street: "Av. Acceso Sur 1200", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.9168), Longitude: fPtr(-68.8312)}},
			weightKg:           160,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "cordoba",
			finalBranchID:      "mendoza",
			priority:           "baja",
			priorityScore:      0.32,
			priorityConfidence: 0.70,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_cordoba", location: "cordoba", notes: "Envío registrado en Córdoba", hoursAgo: 5},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// Escenario de backhauling Mendoza ↔ Posadas
		//
		// OUTBOUND: 5 envíos at_origin_hub en Mendoza → Posadas.
		// Aceite de oliva y vinos en conserva (productos regionales de Cuyo).
		// Peso: 140 kg cada uno = 700 kg total → consolida (47% de la van de 1500 kg).
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-MZPS0001",
			sender:             model.Customer{DNI: "27441122", Name: "Bodega Los Andes SRL", Phone: "542614881234", Email: "despachos@bodegalosandes.com", Address: model.Address{Street: "Ruta 7 Km 1095", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.9044), Longitude: fPtr(-68.8458)}},
			recipient:          model.Customer{DNI: "28991100", Name: "Distribuidora El Litoral", Phone: "543752334455", Email: "compras@ellitoral.com.ar", Address: model.Address{Street: "Av. Mitre 2200", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3718), Longitude: fPtr(-55.8963)}},
			weightKg:           140,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "mendoza",
			finalBranchID:      "posadas",
			priority:           "media",
			priorityScore:      0.51,
			priorityConfidence: 0.82,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Aceite de oliva extra virgen — carga al Litoral", hoursAgo: 18},
			},
		},
		{
			trackingID:         "LT-MZPS0002",
			sender:             model.Customer{DNI: "27441122", Name: "Bodega Los Andes SRL", Phone: "542614881234", Email: "despachos@bodegalosandes.com", Address: model.Address{Street: "Ruta 7 Km 1095", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.9044), Longitude: fPtr(-68.8458)}},
			recipient:          model.Customer{DNI: "30112233", Name: "Supermercado Norte SA", Phone: "543752556677", Address: model.Address{Street: "San Martín 980", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3632), Longitude: fPtr(-55.8812)}},
			weightKg:           140,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "mendoza",
			finalBranchID:      "posadas",
			priority:           "media",
			priorityScore:      0.49,
			priorityConfidence: 0.80,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Vino en conserva — lote primavera", hoursAgo: 20},
			},
		},
		{
			trackingID:         "LT-MZPS0003",
			sender:             model.Customer{DNI: "29556677", Name: "Aceites Cuyo SA", Phone: "542614772288", Address: model.Address{Street: "Av. España 1400", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8968), Longitude: fPtr(-68.8381)}},
			recipient:          model.Customer{DNI: "31445500", Name: "Hotel Posadas Internacional", Phone: "543752221133", Email: "cocina@hpi.com.ar", Address: model.Address{Street: "Bolívar 2100", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3589), Longitude: fPtr(-55.8794)}},
			weightKg:           140,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "mendoza",
			finalBranchID:      "posadas",
			priority:           "baja",
			priorityScore:      0.38,
			priorityConfidence: 0.77,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Aceite oliva y pasas de uva — gastronomía", hoursAgo: 22},
			},
		},
		{
			trackingID:         "LT-MZPS0004",
			sender:             model.Customer{DNI: "26334455", Name: "Conservas del Sol SRL", Phone: "542614993344", Address: model.Address{Street: "Carril Rodríguez Peña 800", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.9112), Longitude: fPtr(-68.8203)}},
			recipient:          model.Customer{DNI: "32667788", Name: "Restaurante Río Paraná", Phone: "543752887700", Address: model.Address{Street: "Av. Costanera 1500", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3648), Longitude: fPtr(-55.8990)}},
			weightKg:           140,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "mendoza",
			finalBranchID:      "posadas",
			priority:           "baja",
			priorityScore:      0.35,
			priorityConfidence: 0.75,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Conservas de tomate y pimentón — gastronomía noreste", hoursAgo: 24},
			},
		},
		{
			trackingID:         "LT-MZPS0005",
			sender:             model.Customer{DNI: "26334455", Name: "Conservas del Sol SRL", Phone: "542614993344", Address: model.Address{Street: "Carril Rodríguez Peña 800", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.9112), Longitude: fPtr(-68.8203)}},
			recipient:          model.Customer{DNI: "33112244", Name: "Club Náutico Posadas", Phone: "543752009900", Address: model.Address{Street: "Av. Roque González 900", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3792), Longitude: fPtr(-55.9044)}},
			weightKg:           140,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "mendoza",
			finalBranchID:      "posadas",
			priority:           "baja",
			priorityScore:      0.33,
			priorityConfidence: 0.74,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_mendoza", location: "mendoza", notes: "Conservas y aceitunas rellenas — provisión mensual", hoursAgo: 16},
			},
		},

		// ─────────────────────────────────────────────────────────────────────
		// BACKHAUL: 4 envíos at_hub en Posadas → Mendoza.
		// Yerba mate y productos regionales de Misiones con destino final Mendoza.
		// Peso: 165 kg cada uno = 660 kg total → consolida (44% de 1500 kg).
		// Estos ya "llegaron" a Posadas desde un origen externo y esperan despacho.
		// Al generar el plan, addBackhaulReturns los detecta como carga de retorno
		// para el vehículo que viene desde Mendoza, armando el round-trip.
		// ─────────────────────────────────────────────────────────────────────
		{
			trackingID:         "LT-PSMZ0001",
			sender:             model.Customer{DNI: "25889900", Name: "Yerbatería Las Misiones", Phone: "543752441100", Email: "ventas@yerbatasmisiones.com.ar", Address: model.Address{Street: "Av. Roque González 1800", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3792), Longitude: fPtr(-55.9044)}},
			recipient:          model.Customer{DNI: "20334455", Name: "Distribuidora Cuyo SRL", Phone: "542614556600", Email: "pedidos@distribuidoracuyo.com", Address: model.Address{Street: "Av. Las Tipas 800", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)}},
			weightKg:           165,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "posadas",
			finalBranchID:      "mendoza",
			priority:           "media",
			priorityScore:      0.52,
			priorityConfidence: 0.83,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_posadas", location: "posadas", notes: "Yerba mate a granel — lote Otoño", hoursAgo: 30},
				{from: model.StatusAtOriginHub, to: model.StatusAtHub, changedBy: "op_posadas", location: "posadas", notes: "En sucursal Posadas — esperando despacho a Mendoza", hoursAgo: 6},
			},
		},
		{
			trackingID:         "LT-PSMZ0002",
			sender:             model.Customer{DNI: "25889900", Name: "Yerbatería Las Misiones", Phone: "543752441100", Email: "ventas@yerbatasmisiones.com.ar", Address: model.Address{Street: "Av. Roque González 1800", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3792), Longitude: fPtr(-55.9044)}},
			recipient:          model.Customer{DNI: "22445566", Name: "Supermercado Andino SA", Phone: "542614112233", Address: model.Address{Street: "Av. San Martín 3400", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8968), Longitude: fPtr(-68.8381)}},
			weightKg:           165,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "posadas",
			finalBranchID:      "mendoza",
			priority:           "media",
			priorityScore:      0.48,
			priorityConfidence: 0.80,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_posadas", location: "posadas", notes: "Té taragüi y hierbas aromáticas", hoursAgo: 28},
				{from: model.StatusAtOriginHub, to: model.StatusAtHub, changedBy: "op_posadas", location: "posadas", notes: "En sucursal Posadas — aguardando retorno a Mendoza", hoursAgo: 5},
			},
		},
		{
			trackingID:         "LT-PSMZ0003",
			sender:             model.Customer{DNI: "27003344", Name: "Artesanías Guaraní SRL", Phone: "543752990055", Address: model.Address{Street: "Colón 1200", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3672), Longitude: fPtr(-55.8948)}},
			recipient:          model.Customer{DNI: "30776600", Name: "Tienda Regional Cuyo", Phone: "542614887722", Email: "productos@tiendaregionalcuyo.com", Address: model.Address{Street: "Belgrano 1100", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8858), Longitude: fPtr(-68.8308)}},
			weightKg:           165,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "posadas",
			finalBranchID:      "mendoza",
			priority:           "baja",
			priorityScore:      0.41,
			priorityConfidence: 0.78,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_posadas", location: "posadas", notes: "Artesanías regionales y madera tallada de Misiones", hoursAgo: 32},
				{from: model.StatusAtOriginHub, to: model.StatusAtHub, changedBy: "op_posadas", location: "posadas", notes: "En sucursal Posadas — retorno a Mendoza en próximo despacho", hoursAgo: 8},
			},
		},
		{
			trackingID:         "LT-PSMZ0004",
			sender:             model.Customer{DNI: "24558899", Name: "Productora Misionera SA", Phone: "543752771188", Email: "exporta@productoramisiones.com", Address: model.Address{Street: "Av. Uruguay 560", City: "Posadas", Province: "Misiones", PostalCode: "N3300", Latitude: fPtr(-27.3632), Longitude: fPtr(-55.8812)}},
			recipient:          model.Customer{DNI: "31667733", Name: "Importadora Regional SRL", Phone: "542614334488", Address: model.Address{Street: "Av. España 600", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500", Latitude: fPtr(-32.8938), Longitude: fPtr(-68.8423)}},
			weightKg:           165,
			packageType:        model.PackageBox,
			shipmentType:       model.ShipmentTypeNormal,
			timeWindow:         model.TimeWindowFlexible,
			receivingBranchID:  "posadas",
			finalBranchID:      "mendoza",
			priority:           "baja",
			priorityScore:      0.39,
			priorityConfidence: 0.76,
			events: []eventSeed{
				{from: "", to: model.StatusAtOriginHub, changedBy: "op_posadas", location: "posadas", notes: "Semillas y granos regionales — temporada", hoursAgo: 26},
				{from: model.StatusAtOriginHub, to: model.StatusAtHub, changedBy: "op_posadas", location: "posadas", notes: "En sucursal Posadas — listo para despacho inter-sucursal", hoursAgo: 4},
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
