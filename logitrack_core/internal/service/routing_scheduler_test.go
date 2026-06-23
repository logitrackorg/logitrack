package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/vrp"
)

// Tests para candidateDepartures (Fase 3 — scheduling con horarios candidatos).
// El bug que motiva estos tests: si nowMin no se filtra, el scheduler propone
// "salir a las 8 AM" cuando son las 12:45 PM y el solver simula esa salida
// ficticia, dando una cobertura irreal.

func cfgWindow(morningStart, morningEnd, afternoonStart, afternoonEnd int) model.RoutingConfig {
	c := model.DefaultRoutingConfig()
	c.MorningWindowStartHour = morningStart
	c.MorningWindowEndHour = morningEnd
	c.AfternoonWindowStartHour = afternoonStart
	c.AfternoonWindowEndHour = afternoonEnd
	return c
}

func TestCandidateDepartures_NowBeforeMorningStart_AllIntegers(t *testing.T) {
	// Antes de las 8 (morning start), todos los enteros desde 8 hasta 17 (afternoon end-1).
	got := candidateDepartures(cfgWindow(8, 14, 12, 18), 7*60)
	want := []float64{8 * 60, 9 * 60, 10 * 60, 11 * 60, 12 * 60, 13 * 60, 14 * 60, 15 * 60, 16 * 60, 17 * 60}
	if !floatsEqual(got, want) {
		t.Fatalf("candidates con now=7:00 esperaba %v, obtuvo %v", want, got)
	}
}

func TestCandidateDepartures_NowMidday_FiltersPastIntegers(t *testing.T) {
	// 12:45 — los enteros pasados (8..12) no deberían estar. now mismo (765) sí
	// porque no es hora exacta. Después 13, 14, 15, 16, 17.
	got := candidateDepartures(cfgWindow(8, 14, 12, 18), 12*60+45)
	want := []float64{12*60 + 45, 13 * 60, 14 * 60, 15 * 60, 16 * 60, 17 * 60}
	if !floatsEqual(got, want) {
		t.Fatalf("candidates con now=12:45 esperaba %v, obtuvo %v", want, got)
	}
}

func TestCandidateDepartures_NowExactHour_NoExtraNonInteger(t *testing.T) {
	// 13:00 exacto — solo enteros desde 13. No agrega "13:00" como duplicado.
	got := candidateDepartures(cfgWindow(8, 14, 12, 18), 13*60)
	want := []float64{13 * 60, 14 * 60, 15 * 60, 16 * 60, 17 * 60}
	if !floatsEqual(got, want) {
		t.Fatalf("candidates con now=13:00 esperaba %v, obtuvo %v", want, got)
	}
}

func TestCandidateDepartures_NowAfterDayEnd_OnlyFallback(t *testing.T) {
	// 19:00 después de afternoon_end=18. firstHour=19, end=17 → end < firstHour.
	// Por la guarda end <= start no aplica acá. Pero el loop arranca en 19 con
	// end=17, no entra. Y now > (end+1)*60 → tampoco se agrega como extra.
	// Resultado: lista vacía. Esto es aceptable — fuera de horario operativo.
	got := candidateDepartures(cfgWindow(8, 14, 12, 18), 19*60)
	if len(got) != 0 {
		t.Fatalf("candidates con now=19:00 esperaba vacío, obtuvo %v", got)
	}
}

func TestCandidateDepartures_AlternativeWindow(t *testing.T) {
	// Ventanas custom: morning 9-13, afternoon 13-19. Now 10:30.
	// firstHour = ceil(10:30 / 60) = 11. afternoon_end - 1 = 18.
	got := candidateDepartures(cfgWindow(9, 13, 13, 19), 10*60+30)
	want := []float64{10*60 + 30, 11 * 60, 12 * 60, 13 * 60, 14 * 60, 15 * 60, 16 * 60, 17 * 60, 18 * 60}
	if !floatsEqual(got, want) {
		t.Fatalf("candidates con ventanas custom esperaba %v, obtuvo %v", want, got)
	}
}

// TestFindBestDeparture_AfternoonShipments_ChoosesNoon valida la regresión donde
// findBestDepartureForRoute siempre elegía el horario más temprano (8am) aunque
// los envíos no cayeran en su ventana.
//
// Causa raíz: twoOpt reconstruía las Stop sin setear OutOfWindow, así que
// routeMetrics contaba todas como "in window" → coverage=100% para cualquier
// horario → tiebreaker dep ASC → 8am siempre ganaba.
//
// Con el fix, la cobertura para 8am es 0% (todos afternoon fuera de ventana)
// y para 12pm es 100%, por lo que 12pm debe ganar.
func TestFindBestDeparture_AfternoonShipments_ChoosesNoon(t *testing.T) {
	// 4 envíos afternoon en una grilla 1D: x=1,2,3,4 (travel ~1 min c/u).
	tids := []string{"LT-01", "LT-02", "LT-03", "LT-04"}
	deliveries := []vrp.Node{
		{ID: "LT-01", WeightKg: 5, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-02", WeightKg: 5, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-03", WeightKg: 5, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-04", WeightKg: 5, TimeWindow: model.TimeWindowAfternoon},
	}
	xs := []float64{0, 1, 2, 3, 4} // depot=0, entregas x=1..4
	n := len(xs)
	dur := make([][]float64, n)
	dist := make([][]float64, n)
	for i := 0; i < n; i++ {
		dur[i] = make([]float64, n)
		dist[i] = make([]float64, n)
		for j := 0; j < n; j++ {
			d := xs[j] - xs[i]
			if d < 0 {
				d = -d
			}
			dur[i][j] = d * 60
			dist[i][j] = d * 1000
		}
	}
	indexByTID := map[string]int{
		"LT-01": 0, "LT-02": 1, "LT-03": 2, "LT-04": 3,
	}

	cfg := model.DefaultRoutingConfig()
	// nowMin = 8:00 → candidatos 8,9,10,...,17
	nowMin := float64(8 * 60)

	svc := &RoutingService{}
	bestDep, bestRoute, bestCov := svc.findBestDepartureForRoute(
		"drv1", 150,
		tids,
		vrp.Coord{},
		deliveries,
		indexByTID,
		dur, dist,
		cfg,
		nowMin,
	)

	// Con el fix, salir a las 12:00 (720 min) o después da coverage=100%.
	// Salir antes da coverage < 100% → el scheduler debe elegir >= 12:00.
	if bestDep < float64(cfg.AfternoonWindowStartHour)*60 {
		t.Errorf("expected departure >= afternoon start (%d:00 = %d min), got %.0f min (%.0f:%.0f)",
			cfg.AfternoonWindowStartHour, cfg.AfternoonWindowStartHour*60,
			bestDep, bestDep/60, float64(int(bestDep)%60))
	}
	if bestCov < 1.0 {
		t.Errorf("expected coverage=1.0 for afternoon shipments departing at noon, got %.2f", bestCov)
	}
	if len(bestRoute.Stops) != 4 {
		t.Errorf("expected 4 stops in best route, got %d", len(bestRoute.Stops))
	}
}

func floatsEqual(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestFindCostOptimalDeparture_AfternoonShipments verifica que el modo "costo"
// también elige el horario de salida que maximiza ventanas, aunque el orden
// de paradas ya viene fijado por distancia mínima.
func TestFindCostOptimalDeparture_AfternoonShipments(t *testing.T) {
	tids := []string{"LT-C1", "LT-C2", "LT-C3"}
	deliveries := []vrp.Node{
		{ID: "LT-C1", WeightKg: 5, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-C2", WeightKg: 5, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-C3", WeightKg: 5, TimeWindow: model.TimeWindowAfternoon},
	}
	xs := []float64{0, 1, 2, 3} // depot=0, entregas x=1..3
	n := len(xs)
	dur := make([][]float64, n)
	dist := make([][]float64, n)
	for i := 0; i < n; i++ {
		dur[i] = make([]float64, n)
		dist[i] = make([]float64, n)
		for j := 0; j < n; j++ {
			d := xs[j] - xs[i]
			if d < 0 {
				d = -d
			}
			dur[i][j] = d * 60
			dist[i][j] = d * 1000
		}
	}
	indexByTID := map[string]int{"LT-C1": 0, "LT-C2": 1, "LT-C3": 2}
	cfg := model.DefaultRoutingConfig()
	nowMin := float64(8 * 60)

	svc := &RoutingService{}
	bestDep, bestRoute, bestCov := svc.findCostOptimalDeparture(
		"drv1", 150, tids, vrp.Coord{}, deliveries, indexByTID, dur, dist, cfg, nowMin,
	)

	if bestDep < float64(cfg.AfternoonWindowStartHour)*60 {
		t.Errorf("costo: expected departure >= afternoon start, got %.0f min", bestDep)
	}
	if bestCov < 1.0 {
		t.Errorf("costo: expected coverage=1.0, got %.2f", bestCov)
	}
	if len(bestRoute.Stops) != 3 {
		t.Errorf("costo: expected 3 stops, got %d", len(bestRoute.Stops))
	}
}

// TestSegCrossesAnyZone verifica que el helper de zonas peligrosas detecta correctamente
// si un segmento cruza un polígono.
func TestSegCrossesAnyZone(t *testing.T) {
	// Polígono: cuadrado entre lat 0-1, lng 0-1
	square := []model.ZonePoint{{Lat: 0, Lng: 0}, {Lat: 1, Lng: 0}, {Lat: 1, Lng: 1}, {Lat: 0, Lng: 1}}
	zones := []model.Zone{{Active: true, Polygon: square}}

	// Segmento que cruza la zona diagonalmente (de afuera a afuera cruzando el cuadrado)
	if !segCrossesAnyZone(-0.5, 0.5, 1.5, 0.5, zones) {
		t.Error("esperaba que el segmento cruce la zona, pero no la detectó")
	}

	// Segmento completamente fuera de la zona
	if segCrossesAnyZone(2, 2, 3, 3, zones) {
		t.Error("segmento fuera de la zona no debería cruzarla")
	}

	// Sin zonas activas: nunca cruza
	inactiveZones := []model.Zone{{Active: false, Polygon: square}}
	if segCrossesAnyZone(-0.5, 0.5, 1.5, 0.5, inactiveZones) {
		t.Error("zona inactiva no debe contar como peligrosa")
	}
}

// TestApplyZonePenalties verifica que los arcos que cruzan una zona reciben penalización.
func TestApplyZonePenalties(t *testing.T) {
	// Depot fuera de zona, delivery0 fuera, delivery1 dentro de la zona.
	// Coord 0: depot (lat=-1, lng=0.5)
	// Coord 1: delivery0 (lat=2, lng=0.5) — el segmento depot→delivery0 cruza el cuadrado
	// Coord 2: delivery1 (lat=0.5, lng=0.5) — dentro de la zona
	square := []model.ZonePoint{{Lat: 0, Lng: 0}, {Lat: 1, Lng: 0}, {Lat: 1, Lng: 1}, {Lat: 0, Lng: 1}}
	zones := []model.Zone{{Active: true, Polygon: square}}

	coords := []vrp.Coord{
		{Lat: -1, Lon: 0.5},  // depot
		{Lat: 2, Lon: 0.5},   // delivery0 — cruzar zona en segmento depot→d0
		{Lat: 0.5, Lon: 0.5}, // delivery1 — dentro de la zona
	}
	dur := [][]float64{
		{0, 100, 100},
		{100, 0, 100},
		{100, 100, 0},
	}
	applyZonePenaltiesToMatrix(dur, coords, zones)

	// depot→delivery0 cruza la zona y d0 no está en la zona → penalizado
	if dur[0][1] != 100*safeRouteZonePenalty {
		t.Errorf("depot→d0 esperaba %.1f, obtuvo %.1f", 100*safeRouteZonePenalty, dur[0][1])
	}
	// depot→delivery1: delivery1 está dentro de la zona → NO penalizar (entrega en zona)
	if dur[0][2] != 100 {
		t.Errorf("depot→d1 (en zona) no debería penalizarse, obtuvo %.1f", dur[0][2])
	}
}

// TestRouteModeSegura_CABAScenario valida que el modo segura produce un orden
// diferente al modo ventanas usando las coords reales del seed de CABA.
//
// Sucursal (depot): Once / Balvanera (-34.6037, -58.3816)
// Zona peligrosa:   corredor lat -34.592...-34.598, lng -58.420...-58.376
//
//	— queda entre el depot y las 4 entregas del norte.
//
// Entregas SUR (no cruzan zona): LT-LM00001 (Congreso), LT-LM00004 (Caballito)
// Entregas NORTE (cruzan zona):  LT-LM00002 (Belgrano), LT-LM00003 (Sta Fe),
//
//	LT-LM00005 (Palermo), LT-LM00006 (Recoleta)
//
// Todas las ventanas son flexible para eliminar la influencia del horario y
// testear solo el efecto de la penalización de zona (igual al seed actualizado).
//
// El test usa vrp.Solve directamente con DepartureMin=12:00 (todos los stops
// elegibles) para aislar el efecto puro del penalty sobre el orden de paradas,
// sin la capa de selección de horario de findBestDepartureForRoute.
//
// Expectativa en modo SEGURA:
//
//	Las dos entregas del SUR deben aparecer ANTES de la primera entrega del NORTE
//	— penalty 2.5× hace que los arcos que cruzan la zona sean más caros que el
//	desvío al stop del sur (LM00004 a ~4.4 km vs LM00006 penalizado a 5.97 km).
func TestRouteModeSegura_CABAScenario(t *testing.T) {
	depot := vrp.Coord{Lat: -34.6037, Lon: -58.3816}

	// Todas las ventanas en flexible para eliminar la influencia del horario.
	// (LM00004 también es flexible en el seed actualizado.)
	deliveries := []vrp.Node{
		{ID: "LT-LM00001", Coord: vrp.Coord{Lat: -34.6045, Lon: -58.3878}, WeightKg: 2.5, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00002", Coord: vrp.Coord{Lat: -34.5605, Lon: -58.4585}, WeightKg: 7.8, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00003", Coord: vrp.Coord{Lat: -34.5894, Lon: -58.4106}, WeightKg: 0.4, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00004", Coord: vrp.Coord{Lat: -34.6109, Lon: -58.4356}, WeightKg: 3.2, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00005", Coord: vrp.Coord{Lat: -34.5856, Lon: -58.4338}, WeightKg: 11.5, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00006", Coord: vrp.Coord{Lat: -34.5862, Lon: -58.4015}, WeightKg: 5.6, TimeWindow: model.TimeWindowFlexible},
	}

	allCoords := make([]vrp.Coord, 0, len(deliveries)+1)
	allCoords = append(allCoords, depot)
	for _, d := range deliveries {
		allCoords = append(allCoords, d.Coord)
	}

	zone := []model.Zone{{
		Active: true,
		Polygon: []model.ZonePoint{
			{Lat: -34.592, Lng: -58.420},
			{Lat: -34.592, Lng: -58.376},
			{Lat: -34.598, Lng: -58.376},
			{Lat: -34.598, Lng: -58.420},
		},
	}}

	cfg := model.DefaultRoutingConfig()
	// DepartureMin fijo al mediodía para que todos los stops sean elegibles.
	// Usar un único horario aísla el efecto de la penalización de zona sin
	// que la capa de selección de horario iguale los resultados.
	const noonMin = 12 * 60.0

	baseDur, baseDist := haversineMatrix(allCoords, cfg.AvgSpeedKmh)

	baseProb := vrp.Problem{
		Depot:                   vrp.Node{ID: "depot", Coord: depot},
		Deliveries:              deliveries,
		Drivers:                 []vrp.Driver{{ID: "drv1", MaxWeightKg: 150}},
		DurationMatrix:          baseDur,
		DistanceMatrix:          baseDist,
		DepartureMin:            noonMin,
		ServiceTimeMin:          float64(cfg.ServiceTimeMinutes),
		DayEndMin:               float64(cfg.AfternoonWindowEndHour) * 60,
		MorningWindowStartMin:   float64(cfg.MorningWindowStartHour) * 60,
		MorningWindowEndMin:     float64(cfg.MorningWindowEndHour) * 60,
		AfternoonWindowStartMin: float64(cfg.AfternoonWindowStartHour) * 60,
		AfternoonWindowEndMin:   float64(cfg.AfternoonWindowEndHour) * 60,
		EnforceTimeWindows:      false,
	}

	// Ventanas: resolver con matriz base (sin penalizaciones).
	ventanasSol := vrp.Solve(baseProb)

	// Segura: resolver con matriz penalizada.
	seguraDur := copyMatrix(baseDur)
	applyZonePenaltiesToMatrix(seguraDur, allCoords, zone)
	seguraProblem := baseProb
	seguraProblem.DurationMatrix = seguraDur
	seguraSol := vrp.Solve(seguraProblem)

	if len(ventanasSol.Routes) == 0 || len(seguraSol.Routes) == 0 {
		t.Fatal("alguno de los modos no produjo ruta")
	}
	ventanasRoute := ventanasSol.Routes[0]
	seguraRoute := seguraSol.Routes[0]

	ventanasOrder := routeStopOrder(ventanasRoute)
	seguraOrder := routeStopOrder(seguraRoute)
	t.Logf("ventanas order=%v  totalDist=%.1fkm", ventanasOrder, ventanasRoute.TotalDistanceKm)
	t.Logf("segura   order=%v  totalDist=%.1fkm", seguraOrder, seguraRoute.TotalDistanceKm)

	// ── 1. Los modos deben producir órdenes DISTINTOS ────────────────────────
	// El penalty 2.5× en los arcos que cruzan la zona debe cambiar el orden
	// que produce el VRP (de lo contrario los modos son indistinguibles).
	if slicesEqual(ventanasOrder, seguraOrder) {
		t.Fatal("ventanas y segura produjeron el mismo orden — penalty de zona no tiene efecto")
	}

	// ── 2. Segura: el north cluster debe aparecer CONTIGUO ───────────────────
	// El 2-opt con penalty penaliza cruzar la zona innecesariamente, así que
	// todos los stops del norte (que requieren cruzar la zona) deberían
	// quedar agrupados en un bloque continuo para minimizar cruces.
	northSet := map[string]bool{
		"LT-LM00002": true, "LT-LM00003": true,
		"LT-LM00005": true, "LT-LM00006": true,
	}
	firstNorthIdx, lastNorthIdx := len(seguraOrder), -1
	for i, id := range seguraOrder {
		if northSet[id] {
			if i < firstNorthIdx {
				firstNorthIdx = i
			}
			if i > lastNorthIdx {
				lastNorthIdx = i
			}
		}
	}
	if firstNorthIdx > lastNorthIdx {
		t.Fatal("no se encontraron stops del norte en la ruta segura")
	}
	// Los 4 stops del norte deben ocupar posiciones consecutivas [firstNorth, firstNorth+3].
	contiguousNorthCount := 0
	for i := firstNorthIdx; i <= lastNorthIdx; i++ {
		if northSet[seguraOrder[i]] {
			contiguousNorthCount++
		}
	}
	if contiguousNorthCount != 4 {
		t.Errorf("segura: el cluster norte no es contiguo — solo %d de 4 stops del norte están en el bloque [%d,%d]: %v",
			contiguousNorthCount, firstNorthIdx, lastNorthIdx, seguraOrder)
	}

	// ── 3. Ventanas: LM00004 aparece ANTES en la ruta que en segura ──────────
	// Sin penalty de zona, el VRP coloca LM00004 (distancia directa ~4.4km
	// desde LM00001) antes del cluster norte. En segura, LM00004 queda DESPUÉS
	// del cluster norte porque ir norte→sur→norte costaría 3 cruces de zona.
	lm4InVentanas, lm4InSegura := -1, -1
	for i, id := range ventanasOrder {
		if id == "LT-LM00004" {
			lm4InVentanas = i
		}
	}
	for i, id := range seguraOrder {
		if id == "LT-LM00004" {
			lm4InSegura = i
		}
	}
	if lm4InVentanas == -1 || lm4InSegura == -1 {
		t.Fatal("LT-LM00004 no encontrado en alguna de las rutas")
	}
	if lm4InVentanas >= lm4InSegura {
		t.Errorf("se esperaba que LM00004 aparezca más tarde en segura (pos %d) que en ventanas (pos %d)\n"+
			"  ventanas: %v\n  segura: %v", lm4InSegura, lm4InVentanas, ventanasOrder, seguraOrder)
	}
}

// TestCostMode_8Stops_RealProduction replica el escenario REAL de producción:
// las 8 entregas de última milla del seed de CABA (LM00001-7 + DELIVER01) con
// sus ventanas mixtas reales (morning, afternoon, flexible). Verifica que el
// modo costo nunca devuelve más km que el modo ventanas — caso reportado por
// el usuario donde costo daba 45.5km y ventanas 38.3km.
func TestCostMode_8Stops_RealProduction(t *testing.T) {
	depot := vrp.Coord{Lat: -34.6037, Lon: -58.3816}
	deliveries := []vrp.Node{
		{ID: "LT-LM00001", Coord: vrp.Coord{Lat: -34.6045, Lon: -58.3878}, WeightKg: 2.5, TimeWindow: model.TimeWindowMorning},
		{ID: "LT-LM00002", Coord: vrp.Coord{Lat: -34.5605, Lon: -58.4585}, WeightKg: 7.8, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-LM00003", Coord: vrp.Coord{Lat: -34.5894, Lon: -58.4106}, WeightKg: 0.4, TimeWindow: model.TimeWindowMorning},
		{ID: "LT-LM00004", Coord: vrp.Coord{Lat: -34.6109, Lon: -58.4356}, WeightKg: 3.2, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00005", Coord: vrp.Coord{Lat: -34.5856, Lon: -58.4338}, WeightKg: 11.5, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00006", Coord: vrp.Coord{Lat: -34.5862, Lon: -58.4015}, WeightKg: 5.6, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00007", Coord: vrp.Coord{Lat: -34.535, Lon: -58.560}, WeightKg: 3.2, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-DELIVER01", Coord: vrp.Coord{Lat: -34.5877, Lon: -58.3972}, WeightKg: 1.2, TimeWindow: model.TimeWindowAfternoon},
	}
	allCoords := make([]vrp.Coord, 0, len(deliveries)+1)
	allCoords = append(allCoords, depot)
	for _, d := range deliveries {
		allCoords = append(allCoords, d.Coord)
	}
	allTIDs := make([]string, len(deliveries))
	indexByTID := map[string]int{}
	for i, d := range deliveries {
		allTIDs[i] = d.ID
		indexByTID[d.ID] = i
	}
	cfg := model.DefaultRoutingConfig()
	nowMin := float64(cfg.MorningWindowStartHour) * 60
	svc := &RoutingService{}
	baseDur, baseDist := haversineMatrix(allCoords, cfg.AvgSpeedKmh)

	_, ventanasRoute, _ := svc.findBestDepartureForRoute(
		"drv1", 150, allTIDs, depot, deliveries, indexByTID, baseDur, baseDist, cfg, nowMin,
	)
	_, costoRoute, _ := svc.findCostOptimalDeparture(
		"drv1", 150, allTIDs, depot, deliveries, indexByTID, baseDur, baseDist, cfg, nowMin,
	)

	t.Logf("ventanas: order=%v  totalDist=%.2fkm", routeStopOrder(ventanasRoute), ventanasRoute.TotalDistanceKm)
	t.Logf("costo:    order=%v  totalDist=%.2fkm", routeStopOrder(costoRoute), costoRoute.TotalDistanceKm)

	if costoRoute.TotalDistanceKm > ventanasRoute.TotalDistanceKm+0.01 {
		t.Errorf("costo (%.2fkm) NO debe ser mayor que ventanas (%.2fkm) — el modo costo debe siempre encontrar la ruta más corta o igual",
			costoRoute.TotalDistanceKm, ventanasRoute.TotalDistanceKm)
	}
}

// TestCostMode_NeverWorseThanVentanas verifica que la ruta del modo costo
// nunca tiene MÁS km que la ruta del modo ventanas. Costo optimiza por
// distancia pura ignorando ventanas, así que su km debe ser <= ventanas
// (que está limitado por las restricciones de ventana horaria).
//
// Usa coords reales del seed de CABA con ventanas MIXTAS (algunas morning,
// otras afternoon, otras flexible) — el escenario real en producción.
func TestCostMode_NeverWorseThanVentanas(t *testing.T) {
	depot := vrp.Coord{Lat: -34.6037, Lon: -58.3816}
	deliveries := []vrp.Node{
		{ID: "LT-LM00001", Coord: vrp.Coord{Lat: -34.6045, Lon: -58.3878}, WeightKg: 2.5, TimeWindow: model.TimeWindowMorning},
		{ID: "LT-LM00002", Coord: vrp.Coord{Lat: -34.5605, Lon: -58.4585}, WeightKg: 7.8, TimeWindow: model.TimeWindowAfternoon},
		{ID: "LT-LM00003", Coord: vrp.Coord{Lat: -34.5894, Lon: -58.4106}, WeightKg: 0.4, TimeWindow: model.TimeWindowMorning},
		{ID: "LT-LM00004", Coord: vrp.Coord{Lat: -34.6109, Lon: -58.4356}, WeightKg: 3.2, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00005", Coord: vrp.Coord{Lat: -34.5856, Lon: -58.4338}, WeightKg: 11.5, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00006", Coord: vrp.Coord{Lat: -34.5862, Lon: -58.4015}, WeightKg: 5.6, TimeWindow: model.TimeWindowFlexible},
	}
	allCoords := make([]vrp.Coord, 0, len(deliveries)+1)
	allCoords = append(allCoords, depot)
	for _, d := range deliveries {
		allCoords = append(allCoords, d.Coord)
	}
	allTIDs := []string{"LT-LM00001", "LT-LM00002", "LT-LM00003", "LT-LM00004", "LT-LM00005", "LT-LM00006"}
	indexByTID := map[string]int{}
	for i, d := range deliveries {
		indexByTID[d.ID] = i
	}
	cfg := model.DefaultRoutingConfig()
	nowMin := float64(cfg.MorningWindowStartHour) * 60
	svc := &RoutingService{}
	baseDur, baseDist := haversineMatrix(allCoords, cfg.AvgSpeedKmh)

	_, ventanasRoute, _ := svc.findBestDepartureForRoute(
		"drv1", 150, allTIDs, depot, deliveries, indexByTID, baseDur, baseDist, cfg, nowMin,
	)
	_, costoRoute, _ := svc.findCostOptimalDeparture(
		"drv1", 150, allTIDs, depot, deliveries, indexByTID, baseDur, baseDist, cfg, nowMin,
	)

	t.Logf("ventanas: order=%v  totalDist=%.2fkm", routeStopOrder(ventanasRoute), ventanasRoute.TotalDistanceKm)
	t.Logf("costo:    order=%v  totalDist=%.2fkm", routeStopOrder(costoRoute), costoRoute.TotalDistanceKm)

	if costoRoute.TotalDistanceKm > ventanasRoute.TotalDistanceKm+0.01 {
		t.Errorf("costo mode produjo MÁS km (%.2f) que ventanas (%.2f) — debería ser menor o igual",
			costoRoute.TotalDistanceKm, ventanasRoute.TotalDistanceKm)
	}
}

// TestRouteModeSegura_ViaFindBestDeparture verifica que los modos ventanas y segura
// producen rutas distintas cuando se llama a través de findBestDepartureForRoute,
// que es el code path real usado por RecomputeLastMileAssignment en producción.
// nowMin=8*60 simula una generación de plan a las 8am.
func TestRouteModeSegura_ViaFindBestDeparture(t *testing.T) {
	depot := vrp.Coord{Lat: -34.6037, Lon: -58.3816}
	deliveries := []vrp.Node{
		{ID: "LT-LM00001", Coord: vrp.Coord{Lat: -34.6045, Lon: -58.3878}, WeightKg: 2.5, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00002", Coord: vrp.Coord{Lat: -34.5605, Lon: -58.4585}, WeightKg: 7.8, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00003", Coord: vrp.Coord{Lat: -34.5894, Lon: -58.4106}, WeightKg: 0.4, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00004", Coord: vrp.Coord{Lat: -34.6109, Lon: -58.4356}, WeightKg: 3.2, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00005", Coord: vrp.Coord{Lat: -34.5856, Lon: -58.4338}, WeightKg: 11.5, TimeWindow: model.TimeWindowFlexible},
		{ID: "LT-LM00006", Coord: vrp.Coord{Lat: -34.5862, Lon: -58.4015}, WeightKg: 5.6, TimeWindow: model.TimeWindowFlexible},
	}
	allCoords := make([]vrp.Coord, 0, len(deliveries)+1)
	allCoords = append(allCoords, depot)
	for _, d := range deliveries {
		allCoords = append(allCoords, d.Coord)
	}
	zone := []model.Zone{{
		Active: true,
		Polygon: []model.ZonePoint{
			{Lat: -34.592, Lng: -58.420},
			{Lat: -34.592, Lng: -58.376},
			{Lat: -34.598, Lng: -58.376},
			{Lat: -34.598, Lng: -58.420},
		},
	}}
	allTIDs := []string{"LT-LM00001", "LT-LM00002", "LT-LM00003", "LT-LM00004", "LT-LM00005", "LT-LM00006"}
	indexByTID := map[string]int{}
	for i, d := range deliveries {
		indexByTID[d.ID] = i
	}
	cfg := model.DefaultRoutingConfig()
	nowMin := float64(8 * 60)
	svc := &RoutingService{}
	baseDur, baseDist := haversineMatrix(allCoords, cfg.AvgSpeedKmh)

	_, ventanasRoute, _ := svc.findBestDepartureForRoute(
		"drv1", 150, allTIDs, depot, deliveries, indexByTID, baseDur, baseDist, cfg, nowMin,
	)
	seguraDur := copyMatrix(baseDur)
	applyZonePenaltiesToMatrix(seguraDur, allCoords, zone)
	_, seguraRoute, _ := svc.findBestDepartureForRoute(
		"drv1", 150, allTIDs, depot, deliveries, indexByTID, seguraDur, baseDist, cfg, nowMin,
	)

	ventanasOrder := routeStopOrder(ventanasRoute)
	seguraOrder := routeStopOrder(seguraRoute)
	t.Logf("ventanas (findBestDeparture): %v", ventanasOrder)
	t.Logf("segura   (findBestDeparture): %v", seguraOrder)

	if slicesEqual(ventanasOrder, seguraOrder) {
		t.Error("findBestDepartureForRoute: ventanas y segura producen el mismo orden con zona activa — penalty insuficiente o zona no intersecta rutas")
	}
	// En segura, LM00004 debe aparecer más tarde que en ventanas.
	lm4V, lm4S := -1, -1
	for i, id := range ventanasOrder {
		if id == "LT-LM00004" {
			lm4V = i
		}
	}
	for i, id := range seguraOrder {
		if id == "LT-LM00004" {
			lm4S = i
		}
	}
	if lm4V >= lm4S {
		t.Errorf("segura (findBestDeparture): LM00004 debería aparecer más tarde (pos %d) que en ventanas (pos %d)", lm4S, lm4V)
	}
}

func routeStopOrder(r vrp.Route) []string {
	out := make([]string, len(r.Stops))
	for i, s := range r.Stops {
		out[i] = s.NodeID
	}
	return out
}

func slicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
