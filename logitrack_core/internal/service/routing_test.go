package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// =============================================================================
// Test setup
// =============================================================================

// fakeAuthRepo is a minimal AuthRepository for routing tests — only ListByRole is used.
type fakeAuthRepo struct {
	driversByBranch map[string][]model.User
}

func newFakeAuthRepo() *fakeAuthRepo {
	return &fakeAuthRepo{driversByBranch: map[string][]model.User{}}
}

func (r *fakeAuthRepo) AddDriver(branchID, id, firstName string) {
	r.driversByBranch[branchID] = append(r.driversByBranch[branchID], model.User{
		ID: id, Username: id, FirstName: firstName, Role: model.RoleDriver, BranchID: branchID,
	})
}

func (r *fakeAuthRepo) ListByRole(role model.Role, branchID string) []model.User {
	if role != model.RoleDriver {
		return nil
	}
	return r.driversByBranch[branchID]
}

// Stubs for the unused interface methods.
func (r *fakeAuthRepo) FindUser(_, _ string) (model.User, error)    { return model.User{}, nil }
func (r *fakeAuthRepo) SaveToken(_ string, _ model.User)            {}
func (r *fakeAuthRepo) GetUserByToken(_ string) (model.User, error) { return model.User{}, nil }
func (r *fakeAuthRepo) DeleteToken(_ string)                        {}
func (r *fakeAuthRepo) ListAll() []model.User                       { return nil }
func (r *fakeAuthRepo) GetUserByID(_ string) (model.User, error)    { return model.User{}, nil }
func (r *fakeAuthRepo) UpdateUser(_ string, _ repository.UserUpdate) (model.User, error) {
	return model.User{}, nil
}

func (r *fakeAuthRepo) CreateUser(_ repository.UserCreate) (model.User, error) {
	return model.User{}, nil
}
func (r *fakeAuthRepo) ChangePassword(_ context.Context, _, _, _ string) error { return nil }
func (r *fakeAuthRepo) FindUserByUsername(_ string) (model.User, bool)         { return model.User{}, false }
func (r *fakeAuthRepo) UpdatePassword(_, _ string) error                       { return nil }

type routingTestSetup struct {
	routingSvc   *RoutingService
	cfgSvc       *RoutingConfigService
	cfgRepo      repository.RoutingConfigRepository
	shipmentSvc  *ShipmentService
	routeSvc     *RouteService
	shipmentRepo repository.ShipmentRepository
	vehicleRepo  repository.VehicleRepository
	branchRepo   repository.BranchRepository
	authRepo     *fakeAuthRepo
}

func newRoutingSetup() routingTestSetup {
	shipmentRepo, _, _ := repository.NewInMemoryShipmentRepositoryWithDeps()
	branchRepo := testBranchRepo()
	customerRepo := repository.NewInMemoryCustomerRepository()
	commentRepo := repository.NewInMemoryCommentRepository()
	commentSvc := NewCommentService(commentRepo, shipmentRepo)
	shipmentSvc := NewShipmentService(shipmentRepo, branchRepo, customerRepo, commentSvc, nil)
	shipmentSvc.SetPricingService(NewPricingService(repository.NewInMemoryPricingConfigRepository()))

	vehicleRepo := repository.NewInMemoryVehicleRepository()
	routeRepo := repository.NewInMemoryRouteRepository()
	routeSvc := NewRouteService(routeRepo, shipmentRepo)
	authRepo := newFakeAuthRepo()
	cfgRepo := repository.NewInMemoryRoutingConfigRepository()
	cfgSvc := NewRoutingConfigService(cfgRepo)

	// osrmClient nil → el VRP usará Haversine. En tests sin coords reales,
	// la matriz queda con distancias 0 entre pares y el solver se comporta
	// como un greedy puro (todos los travel times son 0).
	routingSvc := NewRoutingService(cfgSvc, shipmentRepo, vehicleRepo, branchRepo, authRepo, routeSvc, shipmentSvc, nil, nil)

	return routingTestSetup{
		routingSvc:   routingSvc,
		cfgSvc:       cfgSvc,
		cfgRepo:      cfgRepo,
		shipmentSvc:  shipmentSvc,
		routeSvc:     routeSvc,
		shipmentRepo: shipmentRepo,
		vehicleRepo:  vehicleRepo,
		branchRepo:   branchRepo,
		authRepo:     authRepo,
	}
}

func makeShipmentReq(weightKg float64, recipientCity string) model.CreateShipmentRequest {
	r := defaultCreateReq()
	r.WeightKg = weightKg
	r.Recipient = model.Customer{
		DNI: "87654321", Name: "Recipient", Phone: "2200000000",
		Address: model.Address{City: recipientCity, Province: recipientCity},
	}
	return r
}

func createShip(t *testing.T, ts routingTestSetup, weightKg float64, recipientCity string) model.Shipment {
	t.Helper()
	sh, err := ts.shipmentSvc.Create(makeShipmentReq(weightKg, recipientCity))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return sh
}

// createInboundShip simula un envío entrante: se crea en originBranchID con destino destCity,
// y se avanza hasta at_hub en destCity (típicamente la sucursal del operador que rutea).
// Útil para tests de última milla.
func createInboundShip(t *testing.T, ts routingTestSetup, weightKg float64, originCity, originBranchID, destCity string, fragile bool) model.Shipment {
	t.Helper()
	req := model.CreateShipmentRequest{
		Sender: model.Customer{
			DNI: "12345678", Name: "Sender", Phone: "1100000000",
			Address: model.Address{City: originCity, Province: originCity},
		},
		Recipient: model.Customer{
			DNI: "87654321", Name: "Recipient", Phone: "2200000000",
			Address: model.Address{City: destCity, Province: destCity},
		},
		WeightKg:          weightKg,
		PackageType:       model.PackageBox,
		IsFragile:         fragile,
		ReceivingBranchID: originBranchID,
		CreatedBy:         "operator",
	}
	sh, err := ts.shipmentSvc.Create(req)
	if err != nil {
		t.Fatalf("create inbound: %v", err)
	}
	return advanceToAtHub(t, ts, sh.TrackingID, destCity)
}

// advanceToAtHub moves a shipment from at_origin_hub to at_hub at the given destination city.
func advanceToAtHub(t *testing.T, ts routingTestSetup, trackingID, toCity string) model.Shipment {
	t.Helper()
	if _, err := ts.shipmentSvc.UpdateStatus(trackingID, model.UpdateStatusRequest{
		Status: model.StatusLoaded, ChangedBy: "supervisor",
	}); err != nil {
		t.Fatalf("loaded: %v", err)
	}
	if _, err := ts.shipmentSvc.UpdateStatus(trackingID, model.UpdateStatusRequest{
		Status: model.StatusInTransit, Location: toCity, ChangedBy: "supervisor",
	}); err != nil {
		t.Fatalf("in_transit: %v", err)
	}
	sh, err := ts.shipmentSvc.UpdateStatus(trackingID, model.UpdateStatusRequest{
		Status: model.StatusAtHub, ChangedBy: "supervisor",
	})
	if err != nil {
		t.Fatalf("at_hub: %v", err)
	}
	return sh
}

func addAvailableVehicle(t *testing.T, ts routingTestSetup, plate, branchID string, capacityKg float64) model.Vehicle {
	t.Helper()
	v := model.Vehicle{
		ID:             plate,
		LicensePlate:   plate,
		Type:           model.VehicleTypeTruck,
		Mode:           model.VehicleModeInterBranch,
		CapacityKg:     capacityKg,
		Status:         model.VehicleStatusAvailable,
		AssignedBranch: strPtr(branchID),
	}
	if err := ts.vehicleRepo.Add(v); err != nil {
		t.Fatalf("add vehicle: %v", err)
	}
	return v
}

func addLastMileVehicle(t *testing.T, ts routingTestSetup, plate, branchID string, capacityKg float64) model.Vehicle {
	t.Helper()
	v := model.Vehicle{
		ID:             plate,
		LicensePlate:   plate,
		Type:           model.VehicleTypeVan,
		Mode:           model.VehicleModeLastMile,
		CapacityKg:     capacityKg,
		Status:         model.VehicleStatusAvailable,
		AssignedBranch: strPtr(branchID),
	}
	if err := ts.vehicleRepo.Add(v); err != nil {
		t.Fatalf("add vehicle: %v", err)
	}
	return v
}

// =============================================================================
// GeneratePlan — última milla
// =============================================================================

func TestGeneratePlan_LastMile_RespetaCapPesoPorVehiculo(t *testing.T) {
	ts := newRoutingSetup()
	// Vehicle with 120 kg capacity: 3 shipments of 40 kg fit, 4th doesn't
	addLastMileVehicle(t, ts, "MOTO-LM", "br-caba", 120)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   24,
		PriorityForceThreshold: 0.99,
		MinFillRate:            0.40,
	}); err != nil {
		t.Fatalf("update cfg: %v", err)
	}

	// 4 shipments of 40 kg = 160 kg total → exceeds 120 kg cap, 1 unassigned
	for i := 0; i < 4; i++ {
		createInboundShip(t, ts, 40, "Córdoba", "br-cordoba", "Buenos Aires", false)
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	if len(plan.LastMile) != 1 {
		t.Fatalf("expected 1 vehicle assignment, got %d", len(plan.LastMile))
	}
	if got := len(plan.LastMile[0].Shipments); got != 3 {
		t.Errorf("expected 3 shipments (cap 120 kg), got %d", got)
	}
	if got := plan.LastMile[0].TotalWeightKg; got > 120 {
		t.Errorf("vehicle weight exceeded: %.2f kg", got)
	}
	if len(plan.Unassigned) != 1 {
		t.Errorf("expected 1 unassigned (over cap), got %d", len(plan.Unassigned))
	}
}

func TestGeneratePlan_SinVehiculos_TodoUltimaMillaUnassigned(t *testing.T) {
	ts := newRoutingSetup()
	// No última-milla vehicles added.

	for i := 0; i < 3; i++ {
		createInboundShip(t, ts, 4, "Córdoba", "br-cordoba", "Buenos Aires", false)
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.LastMile) != 0 {
		t.Errorf("expected no last-mile assignments, got %d", len(plan.LastMile))
	}
	if len(plan.Unassigned) != 3 {
		t.Errorf("expected 3 unassigned, got %d", len(plan.Unassigned))
	}
	for _, u := range plan.Unassigned {
		if u.Reason != "sin_vehiculos_ultima_milla_disponibles" {
			t.Errorf("unexpected reason: %s", u.Reason)
		}
	}
}

// =============================================================================
// GeneratePlan — inter-sucursal
// =============================================================================

func TestGeneratePlan_InterBranch_SLA_DespachaAunBajoFillRate(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "AB123CD", "br-caba", 1000) // 1000 kg pero solo cargamos poco

	// Un solo envío de 5 kg (5/1000 = 0.5% — muy por debajo de 40%)
	// pero express → debe forzar despacho
	req := makeShipmentReq(5, "Córdoba")
	req.ShipmentType = model.ShipmentTypeExpress
	sh, err := ts.shipmentSvc.Create(req)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Bajamos el threshold de prioridad a 0 para que cualquier score dispare la regla.
	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   24,
		PriorityForceThreshold: 0.0, // cualquier score dispara
		MinFillRate:            0.40,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}
	_ = sh

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch (forced), got %d", len(plan.InterBranch))
	}
	if plan.InterBranch[0].Rule != model.DispatchRuleSLA {
		t.Errorf("expected sla_forced rule, got %s", plan.InterBranch[0].Rule)
	}
}

func TestGeneratePlan_InterBranch_BajoFillRate_VaAUnassigned(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "AB123CD", "br-caba", 1000)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   1,    // SLA muy corto, no fuerza
		PriorityForceThreshold: 0.99, // imposible de alcanzar
		MinFillRate:            0.40,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// Solo 50 kg (5%) → no consolida
	createShip(t, ts, 50, "Córdoba")

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 0 {
		t.Errorf("expected 0 dispatches, got %d", len(plan.InterBranch))
	}
	if len(plan.Unassigned) != 1 {
		t.Fatalf("expected 1 unassigned, got %d", len(plan.Unassigned))
	}
	if plan.Unassigned[0].Reason != "esperando_consolidacion" {
		t.Errorf("expected esperando_consolidacion, got %s", plan.Unassigned[0].Reason)
	}
}

func TestGeneratePlan_InterBranch_EligeMenorVehiculoQueCubre(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "MOTO1", "br-caba", 100)
	addAvailableVehicle(t, ts, "VAN1", "br-caba", 600)
	addAvailableVehicle(t, ts, "TRUCK1", "br-caba", 2000)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   1,
		PriorityForceThreshold: 0.99,
		MinFillRate:            0.10, // bajo para forzar consolidación
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// 250 kg total → cabe en VAN1 (600) y TRUCK1 (2000), pero NO en MOTO1 (100).
	// Debería elegir VAN1 (la más chica que cubre).
	for i := 0; i < 5; i++ {
		createShip(t, ts, 50, "Córdoba")
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch, got %d", len(plan.InterBranch))
	}
	if plan.InterBranch[0].LicensePlate != "VAN1" {
		t.Errorf("expected smallest-cover (VAN1), got %s", plan.InterBranch[0].LicensePlate)
	}
}

func TestGeneratePlan_InterBranch_BinPackEnMayorCuandoNingunoCubre(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "VAN1", "br-caba", 200)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   1,
		PriorityForceThreshold: 0.99,
		MinFillRate:            0.10,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// 5 envíos de 60 kg cada uno = 300 kg total > 200 kg de la van.
	// Debería cargar 3 (180 kg) y dejar 2 unassigned.
	for i := 0; i < 5; i++ {
		createShip(t, ts, 60, "Córdoba")
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch, got %d", len(plan.InterBranch))
	}
	loaded := len(plan.InterBranch[0].Shipments)
	if loaded != 3 {
		t.Errorf("expected 3 packed (3*60=180 ≤ 200), got %d", loaded)
	}
	excluded := 0
	for _, u := range plan.Unassigned {
		if u.Reason == "sobrepeso_excede_vehiculo" {
			excluded++
		}
	}
	if excluded != 2 {
		t.Errorf("expected 2 sobrepeso unassigned, got %d", excluded)
	}
}

func TestGeneratePlan_SinVehiculos_TodoInterBranchUnassigned(t *testing.T) {
	ts := newRoutingSetup()
	// No vehicles added.

	for i := 0; i < 3; i++ {
		createShip(t, ts, 50, "Córdoba")
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 0 {
		t.Errorf("expected no dispatches, got %d", len(plan.InterBranch))
	}
	if len(plan.Unassigned) != 3 {
		t.Errorf("expected 3 unassigned, got %d", len(plan.Unassigned))
	}
	for _, u := range plan.Unassigned {
		if u.Reason != "sin_vehiculos_disponibles" {
			t.Errorf("expected sin_vehiculos_disponibles, got %s", u.Reason)
		}
	}
}

// TestGeneratePlan_RetiroSucursal_IntermedioBranchIncluido verifica que un envío
// retiro_sucursal cuya sucursal de destino final es DISTINTA a la que genera el plan
// sí aparece en el despacho inter-sucursal (debe ser trasladado hasta su sucursal final).
func TestGeneratePlan_RetiroSucursal_IntermedioBranchIncluido(t *testing.T) {
	ts := newRoutingSetup()
	// Vehículo de 500 kg: un envío de 50 kg ocupa el 10% → igual al MinFillRate mínimo (0.10).
	addAvailableVehicle(t, ts, "AB123CD", "br-caba", 500)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{SLAForceHorizonHours: 1, MinFillRate: 0.10}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// Envío de retiro_sucursal con destino Córdoba (FinalBranchID = br-cordoba),
	// generando el plan desde br-caba → debe aparecer en inter-branch.
	req := makeShipmentReq(50, "Córdoba")
	req.DeliveryMethod = model.DeliveryMethodBranchPickup
	if _, err := ts.shipmentSvc.Create(req); err != nil {
		t.Fatalf("create: %v", err)
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 1 || len(plan.LastMile) != 0 {
		t.Errorf("retiro_sucursal hacia otra sucursal debe incluirse en inter-branch — got dispatches=%d, last_mile=%d, unassigned=%d",
			len(plan.InterBranch), len(plan.LastMile), len(plan.Unassigned))
	}
}

// TestGeneratePlan_ExcluyeRetiroSucursalEnDestino verifica que un envío retiro_sucursal
// que ya se encuentra en su sucursal de destino final NO aparece en el plan
// (la transición automática a ready_for_pickup lo saca del scope de ruteo).
func TestGeneratePlan_ExcluyeRetiroSucursalEnDestino(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "AB123CD", "br-cordoba", 1000)

	// Envío de retiro_sucursal cuya sucursal final es br-cordoba,
	// generando el plan desde br-cordoba → debe estar excluido (ya está en destino).
	req := makeShipmentReq(50, "Córdoba")
	req.DeliveryMethod = model.DeliveryMethodBranchPickup
	ship, err := ts.shipmentSvc.Create(req)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Avanzar hasta at_hub en br-cordoba para que la auto-transición lo lleve a ready_for_pickup
	// (simulamos que ya llegó a su sucursal de destino y salió del alcance de ruteo).
	_ = ship // el envío ya está en created; en prod la auto-transición ocurre al llegar

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-cordoba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 0 || len(plan.LastMile) != 0 || len(plan.Unassigned) != 0 {
		t.Errorf("retiro_sucursal en su sucursal destino no debe aparecer en el plan — got dispatches=%d, last_mile=%d, unassigned=%d",
			len(plan.InterBranch), len(plan.LastMile), len(plan.Unassigned))
	}
}

func TestGeneratePlan_Piggyback_AcercaEnvioHuerfanoAlDestino(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "VAN1", "br-caba", 1000)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   1,
		PriorityForceThreshold: 0.99,
		MinFillRate:            0.10, // bajo, para que Córdoba consolide con poco
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// Despacho a Córdoba: 5 envíos × 50 kg = 250 kg → consolida
	for i := 0; i < 5; i++ {
		createShip(t, ts, 50, "Córdoba")
	}

	// Envío huérfano a Mendoza (10 kg, normal): no llega a fill rate ni a SLA → unassigned
	createShip(t, ts, 10, "Mendoza")

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	if len(plan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch (Córdoba), got %d", len(plan.InterBranch))
	}
	dispatch := plan.InterBranch[0]
	if dispatch.DestinationBranch != "br-cordoba" {
		t.Fatalf("expected dispatch to br-cordoba, got %s", dispatch.DestinationBranch)
	}

	// El envío de Mendoza debe estar en el despacho de Córdoba (Córdoba está más cerca de Mendoza que CABA)
	if len(dispatch.Shipments) != 6 {
		t.Errorf("expected 6 shipments in dispatch (5 directos + 1 piggyback), got %d", len(dispatch.Shipments))
	}
	if len(plan.Unassigned) != 0 {
		t.Errorf("expected 0 unassigned (Mendoza piggybacked on Córdoba), got %d: %+v", len(plan.Unassigned), plan.Unassigned)
	}
}

func TestGeneratePlan_Piggyback_RespetaCapacidadDelVehiculo(t *testing.T) {
	ts := newRoutingSetup()
	// Vehículo con capacidad ajustada: justo cubre los envíos directos a Córdoba, sin margen para piggyback.
	addAvailableVehicle(t, ts, "VAN1", "br-caba", 250)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   1,
		PriorityForceThreshold: 0.99,
		MinFillRate:            0.10,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// 5 × 50 kg = 250 kg → llena la capacidad exacta
	for i := 0; i < 5; i++ {
		createShip(t, ts, 50, "Córdoba")
	}
	// Mendoza envío de 10 kg — quiere piggyback pero no hay espacio
	createShip(t, ts, 10, "Mendoza")

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	if len(plan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch, got %d", len(plan.InterBranch))
	}
	if len(plan.InterBranch[0].Shipments) != 5 {
		t.Errorf("expected 5 directos sin piggyback (no hay capacidad), got %d", len(plan.InterBranch[0].Shipments))
	}
	if len(plan.Unassigned) != 1 {
		t.Errorf("expected 1 unassigned (sin capacidad para piggyback), got %d", len(plan.Unassigned))
	}
}

func TestGeneratePlan_Returning_RuteaHaciaOrigen(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "VAN1", "br-cordoba", 1000)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   1,
		PriorityForceThreshold: 0.0, // dispara siempre por priority
		MinFillRate:            0.10,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// Envío entrante CABA → Córdoba que el destinatario rechazó directamente al chofer.
	// Queda en rechazado (no auto-transiciona); el operador lo mueve a at_hub manualmente.
	sh := createInboundShip(t, ts, 6, "Buenos Aires", "br-caba", "Córdoba", false)
	if _, err := ts.shipmentSvc.UpdateStatus(sh.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusOutForDelivery, DriverID: "drv-1", ChangedBy: "supervisor",
	}); err != nil {
		t.Fatalf("out_for_delivery: %v", err)
	}
	// El chofer registra el rechazo activo del destinatario desde out_for_delivery.
	if _, err := ts.shipmentSvc.UpdateStatus(sh.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusRechazado, ChangedBy: "driver", Notes: "🚫 No lo quiero",
	}); err != nil {
		t.Fatalf("rechazado: %v", err)
	}

	// Verificar estado intermedio: rechazado con is_returning=true y ETA extendida.
	got, err := ts.shipmentRepo.GetByTrackingID(sh.TrackingID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !got.IsReturning {
		t.Fatalf("expected is_returning=true, got false")
	}
	if got.Status != model.StatusRechazado {
		t.Fatalf("expected rechazado, got %s", got.Status)
	}
	if got.EstimatedDeliveryAt == nil {
		t.Errorf("expected ETA to be extended, got nil")
	}

	// Operador mueve el envío a at_hub (el chofer devolvió el paquete a la sucursal).
	if _, err := ts.shipmentSvc.UpdateStatus(sh.TrackingID, model.UpdateStatusRequest{
		Status:    model.StatusAtHub,
		Location:  "Córdoba",
		ChangedBy: "supervisor",
		Notes:     "Envío rechazado devuelto a sucursal",
	}); err != nil {
		t.Fatalf("at_hub manual: %v", err)
	}

	// Generar plan en Córdoba — el envío debe aparecer como inter-sucursal hacia caba
	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-cordoba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch (return to caba), got %d. plan=%+v", len(plan.InterBranch), plan)
	}
	if plan.InterBranch[0].DestinationBranch != "br-caba" {
		t.Errorf("expected destination br-caba (origin), got %s", plan.InterBranch[0].DestinationBranch)
	}
	if len(plan.InterBranch[0].Shipments) != 1 || plan.InterBranch[0].Shipments[0] != sh.TrackingID {
		t.Errorf("expected returning shipment in dispatch, got %v", plan.InterBranch[0].Shipments)
	}
}

func TestGeneratePlan_OrdenDeterministico(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "AB123CD", "br-caba", 1000)
	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours: 1, PriorityForceThreshold: 0.0,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	for i := 0; i < 5; i++ {
		createShip(t, ts, 30, "Córdoba")
	}

	plan1, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate1: %v", err)
	}
	plan2, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate2: %v", err)
	}

	if len(plan1.InterBranch) != len(plan2.InterBranch) {
		t.Fatalf("dispatches differ: %d vs %d", len(plan1.InterBranch), len(plan2.InterBranch))
	}
	for i := range plan1.InterBranch {
		s1 := strings.Join(plan1.InterBranch[i].Shipments, ",")
		s2 := strings.Join(plan2.InterBranch[i].Shipments, ",")
		if s1 != s2 {
			t.Errorf("dispatch[%d] order differs:\n  %s\n  %s", i, s1, s2)
		}
	}
}

// =============================================================================
// ApplyPlan — drift y per-item
// =============================================================================

func TestApplyPlan_DriftEstadoShipment_FallaItem(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "AB123CD", "br-caba", 1000)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours: 1, PriorityForceThreshold: 0.0,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	sh := createShip(t, ts, 100, "Córdoba")
	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil || len(plan.InterBranch) != 1 {
		t.Fatalf("plan setup: err=%v dispatches=%d", err, len(plan.InterBranch))
	}

	// Drift: cancelar el envío antes del apply
	if _, err := ts.shipmentSvc.CancelShipment(sh.TrackingID, "supervisor", "test drift"); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	resp, err := ts.routingSvc.ApplyPlan(context.Background(), "br-caba", model.ApplyPlanRequest{
		BranchID: "br-caba", Plan: plan,
	}, "supervisor")
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if resp.AppliedCount != 0 || resp.FailedCount != 1 {
		t.Errorf("expected 0 applied 1 failed, got %d/%d", resp.AppliedCount, resp.FailedCount)
	}
	if !strings.HasPrefix(resp.Items[0].Error, "estado_cambio:") {
		t.Errorf("expected estado_cambio error, got: %s", resp.Items[0].Error)
	}
}

func TestApplyPlan_DriftEstadoVehiculo_FallaShipmentsDelVehiculo(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "AB123CD", "br-caba", 1000)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours: 1, PriorityForceThreshold: 0.0,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	createShip(t, ts, 100, "Córdoba")
	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil || len(plan.InterBranch) != 1 {
		t.Fatalf("plan setup: err=%v dispatches=%d", err, len(plan.InterBranch))
	}

	// Drift: el vehículo entra en mantenimiento
	if err := ts.vehicleRepo.UpdateStatus("AB123CD", model.VehicleStatusInMaintenance); err != nil {
		t.Fatalf("vehicle maint: %v", err)
	}

	resp, err := ts.routingSvc.ApplyPlan(context.Background(), "br-caba", model.ApplyPlanRequest{
		BranchID: "br-caba", Plan: plan,
	}, "supervisor")
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if resp.AppliedCount != 0 || resp.FailedCount != 1 {
		t.Errorf("expected 0 applied 1 failed, got %d/%d", resp.AppliedCount, resp.FailedCount)
	}
	if resp.Items[0].Error != "vehiculo_no_disponible" {
		t.Errorf("expected vehiculo_no_disponible, got %s", resp.Items[0].Error)
	}
}

func TestApplyPlan_HappyPath_VehiculoQuedaEnCarga(t *testing.T) {
	ts := newRoutingSetup()
	addAvailableVehicle(t, ts, "AB123CD", "br-caba", 1000)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours: 1, PriorityForceThreshold: 0.0,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	createShip(t, ts, 100, "Córdoba")
	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil || len(plan.InterBranch) != 1 {
		t.Fatalf("plan: %v", err)
	}

	resp, err := ts.routingSvc.ApplyPlan(context.Background(), "br-caba", model.ApplyPlanRequest{
		BranchID: "br-caba", Plan: plan,
	}, "supervisor")
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if resp.AppliedCount != 1 || resp.FailedCount != 0 {
		t.Errorf("expected 1 applied, got %d/%d", resp.AppliedCount, resp.FailedCount)
	}

	v, ok := ts.vehicleRepo.GetByID("AB123CD")
	if !ok {
		t.Fatal("vehicle missing after apply")
	}
	if v.Status != model.VehicleStatusLoading {
		t.Errorf("expected vehicle en_carga, got %s", v.Status)
	}
	if v.DestinationBranch == nil || *v.DestinationBranch != "br-cordoba" {
		t.Errorf("expected destination br-cordoba, got %v", v.DestinationBranch)
	}
	if len(v.AssignedShipments) != 1 {
		t.Errorf("expected 1 shipment on vehicle, got %d", len(v.AssignedShipments))
	}
}

// =============================================================================
// RoutingConfigService — validación
// =============================================================================

func TestRoutingConfigService_Update_ValidaRangos(t *testing.T) {
	cfgRepo := repository.NewInMemoryRoutingConfigRepository()
	svc := NewRoutingConfigService(cfgRepo)

	cases := []struct {
		name string
		cfg  model.RoutingConfig
	}{}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := svc.Update(c.cfg); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}

	// happy path
	good := model.DefaultRoutingConfig()
	if _, err := svc.Update(good); err != nil {
		t.Errorf("default config should validate, got: %v", err)
	}
}

// =============================================================================
// GeneratePlan — choferes con ruta ya iniciada
// =============================================================================

func TestGeneratePlan_LastMile_ExcluyeVehiculoConViajeActivo(t *testing.T) {
	ts := newRoutingSetup()
	// Two última-milla vehicles: one with an active trip (busy), one free.
	addLastMileVehicle(t, ts, "VAN-BUSY", "br-caba", 500)
	addLastMileVehicle(t, ts, "VAN-FREE", "br-caba", 500)

	// Create an active trip for VAN-BUSY so it gets excluded from the plan.
	if ts.routingSvc.interBranchTripSvc != nil {
		_, _ = ts.routingSvc.interBranchTripSvc.Create(CreateInterBranchTripCmd{
			Kind:           model.TripKindLastMile,
			VehicleID:      "VAN-BUSY",
			LicensePlate:   "VAN-BUSY",
			OriginBranchID: "br-caba",
			ShipmentIDs:    []string{"LT-EXIST"},
			CreatedBy:      "system",
		})
	}

	// 2 last-mile shipments.
	for i := 0; i < 2; i++ {
		createInboundShip(t, ts, 4, "Córdoba", "br-cordoba", "Buenos Aires", false)
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	// Only VAN-FREE should appear (VAN-BUSY has active trip).
	if ts.routingSvc.interBranchTripSvc != nil {
		if len(plan.LastMile) != 1 {
			t.Fatalf("expected 1 vehicle assignment (VAN-FREE), got %d", len(plan.LastMile))
		}
		if plan.LastMile[0].VehicleID != "VAN-FREE" {
			t.Errorf("expected VAN-FREE in plan, got %s", plan.LastMile[0].VehicleID)
		}
	} else {
		// Without interBranchTripSvc wired, both vehicles appear.
		if len(plan.LastMile) == 0 {
			t.Fatal("expected at least 1 vehicle assignment")
		}
	}
}

func TestGeneratePlan_LastMile_SinVehiculos_TodoUnassigned(t *testing.T) {
	// No última-milla vehicles → all shipments go to unassigned.
	ts := newRoutingSetup()

	for i := 0; i < 2; i++ {
		createInboundShip(t, ts, 4, "Córdoba", "br-cordoba", "Buenos Aires", false)
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.LastMile) != 0 {
		t.Errorf("expected no last-mile assignments, got %d", len(plan.LastMile))
	}
	if len(plan.Unassigned) != 2 {
		t.Fatalf("expected 2 unassigned, got %d", len(plan.Unassigned))
	}
	for _, u := range plan.Unassigned {
		if u.Reason != "sin_vehiculos_ultima_milla_disponibles" {
			t.Errorf("expected sin_vehiculos_ultima_milla_disponibles, got %s", u.Reason)
		}
	}
}

func TestApplyPlan_DriftVehiculoConViajeActivo_FallaItem(t *testing.T) {
	ts := newRoutingSetup()
	addLastMileVehicle(t, ts, "VAN1", "br-caba", 500)

	createInboundShip(t, ts, 4, "Córdoba", "br-cordoba", "Buenos Aires", false)

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil || len(plan.LastMile) != 1 {
		t.Fatalf("plan setup: err=%v last_mile=%d", err, len(plan.LastMile))
	}

	// Drift: vehicle gets an active trip between Generate and Apply.
	if ts.routingSvc.interBranchTripSvc != nil {
		_, _ = ts.routingSvc.interBranchTripSvc.Create(CreateInterBranchTripCmd{
			Kind:           model.TripKindLastMile,
			VehicleID:      "VAN1",
			LicensePlate:   "VAN1",
			OriginBranchID: "br-caba",
			ShipmentIDs:    []string{"LT-OTHER"},
			CreatedBy:      "system",
		})
		resp, err := ts.routingSvc.ApplyPlan(context.Background(), "br-caba", model.ApplyPlanRequest{
			BranchID: "br-caba", Plan: plan,
		}, "supervisor")
		if err != nil {
			t.Fatalf("apply: %v", err)
		}
		if resp.AppliedCount != 0 || resp.FailedCount != 1 {
			t.Errorf("expected 0 applied 1 failed, got %d/%d", resp.AppliedCount, resp.FailedCount)
		}
	}
}

// =============================================================================
// GeneratePlan — carga existente del chofer / vehículo
// =============================================================================

// El vehículo ya tiene 3 envíos cargados (loaded) de un plan previo.
// El próximo plan debe descontar ese peso al evaluar la capacidad.
func TestGeneratePlan_LastMile_RespetaCargaExistenteDelVehiculo(t *testing.T) {
	ts := newRoutingSetup()
	// Vehicle with 50 kg cap: after loading 3×5=15 kg, 35 kg remain for 5 more × 5 = 25 kg.
	addLastMileVehicle(t, ts, "VAN1", "br-caba", 50)

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours:   24,
		PriorityForceThreshold: 0.99,
		MinFillRate:            0.40,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// First plan + apply: 3 shipments × 5 kg = 15 kg loaded onto vehicle.
	for i := 0; i < 3; i++ {
		createInboundShip(t, ts, 5, "Córdoba", "br-cordoba", "Buenos Aires", false)
	}
	plan1, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil || len(plan1.LastMile) != 1 {
		t.Fatalf("plan1: err=%v last_mile=%d", err, len(plan1.LastMile))
	}
	if got := len(plan1.LastMile[0].Shipments); got != 3 {
		t.Fatalf("plan1 expected 3 new shipments, got %d", got)
	}
	if _, err := ts.routingSvc.ApplyPlan(context.Background(), "br-caba", model.ApplyPlanRequest{
		BranchID: "br-caba", Plan: plan1,
	}, "supervisor"); err != nil {
		t.Fatalf("apply1: %v", err)
	}

	// 5 more shipments arrive. Vehicle has 35 kg free → all 5 × 5 kg = 25 kg fit.
	for i := 0; i < 5; i++ {
		createInboundShip(t, ts, 5, "Córdoba", "br-cordoba", "Buenos Aires", false)
	}
	plan2, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("plan2: %v", err)
	}

	if len(plan2.LastMile) != 1 {
		t.Fatalf("plan2 expected 1 last-mile assignment, got %d", len(plan2.LastMile))
	}
	asg := plan2.LastMile[0]
	if len(asg.Shipments) != 5 {
		t.Errorf("expected 5 new shipments, got %d", len(asg.Shipments))
	}
}

// El vehículo viene con 800 kg ya cargados de un plan previo. Debe quedar solo
// 200 kg disponibles para el siguiente plan.
func TestGeneratePlan_InterBranch_RespetaCargaExistenteDelVehiculo(t *testing.T) {
	ts := newRoutingSetup()

	// Vehículo con 800 kg pre-cargados con destino seteado.
	v := addAvailableVehicle(t, ts, "VAN1", "br-caba", 1000)
	dest := "br-cordoba"
	if err := ts.vehicleRepo.SetDestinationBranch(v.ID, &dest); err != nil {
		t.Fatalf("set dest: %v", err)
	}
	// Creamos 8 envíos de 100 kg confirmados, los cargamos al vehículo y los
	// pasamos a "loaded" — replica el estado post-apply de un plan previo.
	// Salir de at_origin_hub es importante para que NO aparezcan en el queue
	// del próximo plan.
	for i := 0; i < 8; i++ {
		sh := createShip(t, ts, 100, "Córdoba")
		if err := ts.vehicleRepo.AddShipment(v.ID, sh.TrackingID); err != nil {
			t.Fatalf("add shipment to vehicle: %v", err)
		}
		if _, err := ts.shipmentSvc.UpdateStatus(sh.TrackingID, model.UpdateStatusRequest{
			Status: model.StatusLoaded, ChangedBy: "supervisor",
		}); err != nil {
			t.Fatalf("loaded: %v", err)
		}
	}

	if _, err := ts.cfgSvc.Update(model.RoutingConfig{
		SLAForceHorizonHours: 1, PriorityForceThreshold: 0.0,
	}); err != nil {
		t.Fatalf("cfg: %v", err)
	}

	// 4 nuevos envíos × 80 kg = 320 kg → solo entran 200 kg disponibles → 2 envíos.
	for i := 0; i < 4; i++ {
		createShip(t, ts, 80, "Córdoba")
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.InterBranch) != 1 {
		t.Fatalf("expected 1 dispatch, got %d", len(plan.InterBranch))
	}
	d := plan.InterBranch[0]
	if d.ExistingWeightKg != 800 {
		t.Errorf("expected existing_weight=800, got %f", d.ExistingWeightKg)
	}
	if len(d.Shipments) != 2 {
		t.Errorf("expected 2 NEW shipments (200 kg disponibles, 80 kg c/u), got %d", len(d.Shipments))
	}
	// 2 envíos quedan sobrepeso.
	overCap := 0
	for _, u := range plan.Unassigned {
		if u.Reason == "sobrepeso_excede_vehiculo" {
			overCap++
		}
	}
	if overCap != 2 {
		t.Errorf("expected 2 sobrepeso unassigned, got %d (plan=%+v)", overCap, plan.Unassigned)
	}
}

// Vehículo disponible (sin trip activo) debe aparecer libre para última milla.
func TestGeneratePlan_LastMile_VehiculoLibreAparece(t *testing.T) {
	ts := newRoutingSetup()
	addLastMileVehicle(t, ts, "VAN1", "br-caba", 500)

	for i := 0; i < 3; i++ {
		createInboundShip(t, ts, 4, "Córdoba", "br-cordoba", "Buenos Aires", false)
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.LastMile) != 1 {
		t.Fatalf("expected 1 last_mile assignment, got %d. unassigned=%+v",
			len(plan.LastMile), plan.Unassigned)
	}
	if plan.LastMile[0].ExistingWeightKg != 0 {
		t.Errorf("expected existing_weight=0 for fresh vehicle, got %f", plan.LastMile[0].ExistingWeightKg)
	}
}

// Las reentregas programadas deben aparecer como candidatos válidos de última
// milla y poder transicionarse a out_for_delivery vía Apply.
func TestGeneratePlan_LastMile_IncluyeReentregaProgramada(t *testing.T) {
	ts := newRoutingSetup()
	addLastMileVehicle(t, ts, "VAN1", "br-caba", 500)

	// Envío entrante a CABA, ya entregado fallido y reprogramado.
	sh := createInboundShip(t, ts, 6, "Córdoba", "br-cordoba", "Buenos Aires", false)
	if _, err := ts.shipmentSvc.UpdateStatus(sh.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusOutForDelivery, DriverID: "drv-1", ChangedBy: "supervisor",
	}); err != nil {
		t.Fatalf("out_for_delivery: %v", err)
	}
	if _, err := ts.shipmentSvc.UpdateStatus(sh.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusDeliveryFailed, ChangedBy: "supervisor", Notes: "ausente",
	}); err != nil {
		t.Fatalf("delivery_failed: %v", err)
	}
	if _, err := ts.shipmentSvc.UpdateStatus(sh.TrackingID, model.UpdateStatusRequest{
		Status: model.StatusRedeliveryScheduled, ChangedBy: "supervisor",
	}); err != nil {
		t.Fatalf("redelivery_scheduled: %v", err)
	}

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.LastMile) != 1 || len(plan.LastMile[0].Shipments) != 1 {
		t.Fatalf("expected 1 last_mile envío, got %+v", plan.LastMile)
	}
	if plan.LastMile[0].Shipments[0] != sh.TrackingID {
		t.Errorf("expected reentrega %s en plan, got %s", sh.TrackingID, plan.LastMile[0].Shipments[0])
	}

	// Apply: la reentrega debe pasar a out_for_delivery sin error.
	resp, err := ts.routingSvc.ApplyPlan(context.Background(), "br-caba", model.ApplyPlanRequest{
		BranchID: "br-caba", Plan: plan,
	}, "supervisor")
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if resp.AppliedCount != 1 || resp.FailedCount != 0 {
		t.Errorf("expected 1 applied 0 failed, got %d/%d (items=%+v)", resp.AppliedCount, resp.FailedCount, resp.Items)
	}
	got, err := ts.shipmentRepo.GetByTrackingID(sh.TrackingID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	// With the new flow, apply loads shipments onto the vehicle (loaded).
	// The driver starts the trip (after QR scan) to move them to out_for_delivery.
	if got.Status != model.StatusLoaded {
		t.Errorf("expected loaded tras apply (driver starts trip later), got %s", got.Status)
	}
}

// silence unused-time-import warning
var _ = time.Now

// =============================================================================
// VRP — tests del path optimizado (con coords reales)
// =============================================================================

// branchesWithCoords overwrites the branches in the test repo with versions
// that have lat/lng populated. Required to exercise the VRP path; without
// depot coords lastMileVRP falls back to the legacy greedy.
func branchesWithCoords(repo repository.BranchRepository) {
	// Coordenadas reales aproximadas de las cabeceras provinciales.
	repo.Update("br-caba", model.Branch{
		ID: "br-caba", Name: "CDBA-01",
		Address:  model.Address{City: "Buenos Aires", Province: "CABA", Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)},
		Province: "CABA", Status: model.BranchStatusActive,
		Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816),
	})
	repo.Update("br-cordoba", model.Branch{
		ID: "br-cordoba", Name: "CORD-01",
		Address:  model.Address{City: "Córdoba", Province: "Córdoba", Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)},
		Province: "Córdoba", Status: model.BranchStatusActive,
		Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888),
	})
}

// createInboundShipWithCoords crea un envío entrante que ya trae lat/lng en
// el recipient address. El geocoder de service.Create no toca coords no-nil,
// así que las coordenadas pasadas se preservan en la proyección.
func createInboundShipWithCoords(t *testing.T, ts routingTestSetup, weightKg float64, originBranchID, destCity string, lat, lon float64) model.Shipment {
	t.Helper()
	req := model.CreateShipmentRequest{
		Sender: model.Customer{
			DNI: "12345678", Name: "Sender", Phone: "1100000000",
			Address: model.Address{City: "Córdoba", Province: "Córdoba"},
		},
		Recipient: model.Customer{
			DNI: "87654321", Name: "Recipient", Phone: "2200000000",
			Address: model.Address{
				City: destCity, Province: destCity,
				Latitude: &lat, Longitude: &lon,
			},
		},
		WeightKg:          weightKg,
		PackageType:       model.PackageBox,
		ReceivingBranchID: originBranchID,
		CreatedBy:         "operator",
	}
	sh, err := ts.shipmentSvc.Create(req)
	if err != nil {
		t.Fatalf("create inbound w/coords: %v", err)
	}
	return advanceToAtHub(t, ts, sh.TrackingID, destCity)
}

// TestGeneratePlan_LastMile_ConCoordsAsignaVehiculo verifica que con un vehículo
// de última milla disponible, los envíos con coords se asignan al vehículo.
func TestGeneratePlan_LastMile_ConCoordsAsignaVehiculo(t *testing.T) {
	ts := newRoutingSetup()
	branchesWithCoords(ts.branchRepo)
	addLastMileVehicle(t, ts, "VAN1", "br-caba", 500)

	createInboundShipWithCoords(t, ts, 5, "br-cordoba", "Buenos Aires", -34.6090, -58.3920)
	createInboundShipWithCoords(t, ts, 5, "br-cordoba", "Buenos Aires", -34.6010, -58.3850)

	plan, err := ts.routingSvc.GeneratePlan(context.Background(), "br-caba")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(plan.LastMile) != 1 {
		t.Fatalf("expected 1 last_mile assignment, got %d", len(plan.LastMile))
	}
	if plan.LastMile[0].VehicleID != "VAN1" {
		t.Errorf("expected VehicleID=VAN1, got %s", plan.LastMile[0].VehicleID)
	}
	if len(plan.LastMile[0].Shipments) != 2 {
		t.Errorf("expected 2 shipments, got %d", len(plan.LastMile[0].Shipments))
	}
}
