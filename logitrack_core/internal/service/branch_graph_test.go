package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// fakeBranchGraphRepo implementa BranchGraphRepository para testing.
type fakeBranchGraphRepo struct {
	edges         []model.BranchEdge
	hopAggregates []model.HopAggregate
}

func (f *fakeBranchGraphRepo) ListEdges() ([]model.BranchEdge, error) {
	return f.edges, nil
}

func (f *fakeBranchGraphRepo) GetEdge(from, to string) (model.BranchEdge, bool) {
	for _, e := range f.edges {
		if e.FromBranchID == from && e.ToBranchID == to {
			return e, true
		}
	}
	return model.BranchEdge{}, false
}

func (f *fakeBranchGraphRepo) UpsertEdge(e model.BranchEdge) error {
	for i, ex := range f.edges {
		if ex.FromBranchID == e.FromBranchID && ex.ToBranchID == e.ToBranchID {
			f.edges[i] = e
			return nil
		}
	}
	f.edges = append(f.edges, e)
	return nil
}

func (f *fakeBranchGraphRepo) SetEnabled(from, to string, enabled bool) error {
	for i, e := range f.edges {
		if e.FromBranchID == from && e.ToBranchID == to {
			f.edges[i].Enabled = enabled
			return nil
		}
	}
	return nil
}

func (f *fakeBranchGraphRepo) DeriveHopAggregates() ([]model.HopAggregate, error) {
	return f.hopAggregates, nil
}

// fakeBranchRepo implementa solo GetByID para BranchGraphService.
type fakeBranchRepo struct {
	branches map[string]model.Branch
}

func (f *fakeBranchRepo) List() []model.Branch       { return nil }
func (f *fakeBranchRepo) ListActive() []model.Branch { return nil }
func (f *fakeBranchRepo) GetByID(id string) (model.Branch, bool) {
	b, ok := f.branches[id]
	return b, ok
}
func (f *fakeBranchRepo) GetByCity(city string) (model.Branch, bool)                    { return model.Branch{}, false }
func (f *fakeBranchRepo) GetByNameOrID(q string) []model.Branch                         { return nil }
func (f *fakeBranchRepo) Create(b model.Branch) error                                   { return nil }
func (f *fakeBranchRepo) Add(b model.Branch)                                            {}
func (f *fakeBranchRepo) Update(id string, b model.Branch) error                        { return nil }
func (f *fakeBranchRepo) UpdateStatus(id string, s model.BranchStatus, u string) error  { return nil }
func (f *fakeBranchRepo) UpdateEmployeeOfMonth(id string, enabled bool, u string) error { return nil }

func newTestGraphService(edges []model.BranchEdge) *BranchGraphService {
	return NewBranchGraphService(
		&fakeBranchGraphRepo{edges: edges},
		&fakeBranchRepo{branches: map[string]model.Branch{}},
	)
}

// =============================================================================
// ShortestPath
// =============================================================================

func TestShortestPath_SameSourceDest(t *testing.T) {
	svc := newTestGraphService(nil)
	path := svc.ShortestPath("caba", "caba")
	if len(path) != 1 || path[0] != "caba" {
		t.Errorf("mismo origen y destino debería devolver [origen], got %v", path)
	}
}

func TestShortestPath_DirectEdge(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
	}
	svc := newTestGraphService(edges)
	path := svc.ShortestPath("caba", "cordoba")
	if len(path) != 2 || path[0] != "caba" || path[1] != "cordoba" {
		t.Errorf("camino directo esperado [caba cordoba], got %v", path)
	}
}

func TestShortestPath_PrefersShorterMultiHop(t *testing.T) {
	// caba→mendoza directo = 1050 km
	// caba→cordoba = 700 km, cordoba→mendoza = 400 km → total 1100 km
	// El algoritmo debe elegir el directo (1050 < 1100).
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "mendoza", DistanceKm: 1050, Enabled: true},
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
		{FromBranchID: "cordoba", ToBranchID: "mendoza", DistanceKm: 400, Enabled: true},
	}
	svc := newTestGraphService(edges)
	path := svc.ShortestPath("caba", "mendoza")
	if len(path) != 2 || path[0] != "caba" || path[1] != "mendoza" {
		t.Errorf("debería preferir directo (1050 < 1100), got %v", path)
	}
}

func TestShortestPath_UsesMultiHopWhenCheaper(t *testing.T) {
	// caba→mendoza directo = 1200 km
	// caba→cordoba = 700 km, cordoba→mendoza = 400 km → total 1100 km (más barato)
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "mendoza", DistanceKm: 1200, Enabled: true},
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
		{FromBranchID: "cordoba", ToBranchID: "mendoza", DistanceKm: 400, Enabled: true},
	}
	svc := newTestGraphService(edges)
	path := svc.ShortestPath("caba", "mendoza")
	if len(path) != 3 || path[0] != "caba" || path[1] != "cordoba" || path[2] != "mendoza" {
		t.Errorf("debería ir via cordoba (1100 < 1200), got %v", path)
	}
}

func TestShortestPath_SkipsDisabledEdges(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "mendoza", DistanceKm: 1050, Enabled: false}, // deshabilitada
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
		{FromBranchID: "cordoba", ToBranchID: "mendoza", DistanceKm: 400, Enabled: true},
	}
	svc := newTestGraphService(edges)
	path := svc.ShortestPath("caba", "mendoza")
	if len(path) != 3 || path[1] != "cordoba" {
		t.Errorf("debe usar cordoba (directo deshabilitado), got %v", path)
	}
}

func TestShortestPath_NoPath(t *testing.T) {
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
		// No hay arista de cordoba→mendoza ni caba→mendoza
	}
	svc := newTestGraphService(edges)
	path := svc.ShortestPath("caba", "mendoza")
	if path != nil {
		t.Errorf("sin camino debería devolver nil, got %v", path)
	}
}

func TestShortestPath_ThreeHops(t *testing.T) {
	// caba → cordoba → mendoza → bariloche (cadena)
	edges := []model.BranchEdge{
		{FromBranchID: "caba", ToBranchID: "cordoba", DistanceKm: 700, Enabled: true},
		{FromBranchID: "cordoba", ToBranchID: "mendoza", DistanceKm: 400, Enabled: true},
		{FromBranchID: "mendoza", ToBranchID: "bariloche", DistanceKm: 900, Enabled: true},
	}
	svc := newTestGraphService(edges)
	path := svc.ShortestPath("caba", "bariloche")
	expected := []string{"caba", "cordoba", "mendoza", "bariloche"}
	if len(path) != len(expected) {
		t.Fatalf("esperado %v, got %v", expected, path)
	}
	for i, p := range path {
		if p != expected[i] {
			t.Errorf("path[%d] esperado %s, got %s", i, expected[i], p)
		}
	}
}

func TestShortestPath_EmptyGraph(t *testing.T) {
	svc := newTestGraphService(nil)
	path := svc.ShortestPath("caba", "cordoba")
	if path != nil {
		t.Errorf("grafo vacío debería devolver nil, got %v", path)
	}
}

// =============================================================================
// RunAutoderive
// =============================================================================

func TestRunAutoderive_CreatesEdgesFromHopAggregates(t *testing.T) {
	cabaLat, cabaLng := -34.6037, -58.3816
	cordobaLat, cordobaLng := -31.4201, -64.1888
	mendozaLat, mendozaLng := -32.8908, -68.8272

	graphRepo := &fakeBranchGraphRepo{
		hopAggregates: []model.HopAggregate{
			{FromBranchID: "caba", ToBranchID: "cordoba", ObservedCount: 5, AvgTransitHours: 8.5},
			{FromBranchID: "cordoba", ToBranchID: "mendoza", ObservedCount: 3, AvgTransitHours: 6.2},
		},
	}
	branchRepo := &fakeBranchRepo{branches: map[string]model.Branch{
		"caba":    {ID: "caba", Latitude: &cabaLat, Longitude: &cabaLng, Province: "Buenos Aires"},
		"cordoba": {ID: "cordoba", Latitude: &cordobaLat, Longitude: &cordobaLng, Province: "Córdoba"},
		"mendoza": {ID: "mendoza", Latitude: &mendozaLat, Longitude: &mendozaLng, Province: "Mendoza"},
	}}
	svc := NewBranchGraphService(graphRepo, branchRepo)

	count, err := svc.RunAutoderive()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 2 {
		t.Errorf("esperado 2 aristas derivadas, got %d", count)
	}
	if len(graphRepo.edges) != 2 {
		t.Fatalf("esperado 2 aristas en repo, got %d", len(graphRepo.edges))
	}

	// La arista caba→cordoba debe tener distancia ~700 km (Haversine real)
	e := graphRepo.edges[0]
	if e.FromBranchID != "caba" || e.ToBranchID != "cordoba" {
		t.Errorf("primera arista inesperada: %+v", e)
	}
	if e.DistanceKm < 600 || e.DistanceKm > 800 {
		t.Errorf("distancia caba-cordoba esperada ~700 km, got %.1f", e.DistanceKm)
	}
	if e.AvgTransitHours != 8.5 {
		t.Errorf("avg_transit_hours esperado 8.5, got %.1f", e.AvgTransitHours)
	}
	if e.ObservedCount != 5 {
		t.Errorf("observed_count esperado 5, got %d", e.ObservedCount)
	}
	if !e.Enabled || e.Source != "auto" {
		t.Errorf("nueva arista debe estar enabled=true source=auto, got enabled=%v source=%s", e.Enabled, e.Source)
	}
}

func TestRunAutoderive_HandlesEmptyAggregates(t *testing.T) {
	svc := NewBranchGraphService(&fakeBranchGraphRepo{}, &fakeBranchRepo{branches: map[string]model.Branch{}})
	count, err := svc.RunAutoderive()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 0 {
		t.Errorf("sin aggregates, count debería ser 0, got %d", count)
	}
}

func TestRunAutoderive_DistanceFallsBackToProvinceWhenNoCoords(t *testing.T) {
	graphRepo := &fakeBranchGraphRepo{
		hopAggregates: []model.HopAggregate{
			{FromBranchID: "x", ToBranchID: "y", ObservedCount: 1, AvgTransitHours: 5},
		},
	}
	// Sin lat/lng — debe caer al fallback de provincias
	branchRepo := &fakeBranchRepo{branches: map[string]model.Branch{
		"x": {ID: "x", Province: "Buenos Aires"},
		"y": {ID: "y", Province: "Mendoza"},
	}}
	svc := NewBranchGraphService(graphRepo, branchRepo)

	_, err := svc.RunAutoderive()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(graphRepo.edges) != 1 {
		t.Fatalf("esperado 1 arista, got %d", len(graphRepo.edges))
	}
	// Distancia entre provincias BA y Mendoza debe ser > 0
	if graphRepo.edges[0].DistanceKm <= 0 {
		t.Errorf("distancia debería ser > 0 con fallback de provincia, got %.1f", graphRepo.edges[0].DistanceKm)
	}
}

func TestRunAutoderive_SkipsEdgesWithMissingBranches(t *testing.T) {
	// Cuando una arista referencia branches inexistentes, no podemos calcular
	// distancia confiable. Saltarla en lugar de persistir distancia=0
	// (que Dijkstra preferiría sobre todas las otras rutas).
	graphRepo := &fakeBranchGraphRepo{
		hopAggregates: []model.HopAggregate{
			{FromBranchID: "ghost1", ToBranchID: "ghost2", ObservedCount: 1, AvgTransitHours: 1},
		},
	}
	branchRepo := &fakeBranchRepo{branches: map[string]model.Branch{}}
	svc := NewBranchGraphService(graphRepo, branchRepo)

	count, err := svc.RunAutoderive()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 0 {
		t.Errorf("aristas con branches faltantes deben saltarse, count esperado 0, got %d", count)
	}
	if len(graphRepo.edges) != 0 {
		t.Errorf("no debería haber aristas guardadas, got %d", len(graphRepo.edges))
	}
}

func TestRunAutoderive_SkipsEdgesWithZeroDistance(t *testing.T) {
	// Si dos branches resuelven a la misma coordenada (datos malos, mismo
	// punto), la distancia da 0 y la arista debe saltarse.
	graphRepo := &fakeBranchGraphRepo{
		hopAggregates: []model.HopAggregate{
			{FromBranchID: "a", ToBranchID: "b", ObservedCount: 2, AvgTransitHours: 3},
		},
	}
	sameLat, sameLng := -34.6037, -58.3816
	branchRepo := &fakeBranchRepo{branches: map[string]model.Branch{
		"a": {ID: "a", Latitude: &sameLat, Longitude: &sameLng, Province: "Buenos Aires"},
		"b": {ID: "b", Latitude: &sameLat, Longitude: &sameLng, Province: "Buenos Aires"},
	}}
	svc := NewBranchGraphService(graphRepo, branchRepo)

	count, err := svc.RunAutoderive()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 0 {
		t.Errorf("aristas con distancia 0 deben saltarse, count esperado 0, got %d", count)
	}
}

func TestRunAutoderive_SkipsMixedValidAndInvalid(t *testing.T) {
	// Mezcla de aristas: una válida, una con branches faltantes. Solo la válida se persiste.
	cabaLat, cabaLng := -34.6037, -58.3816
	cordobaLat, cordobaLng := -31.4201, -64.1888

	graphRepo := &fakeBranchGraphRepo{
		hopAggregates: []model.HopAggregate{
			{FromBranchID: "caba", ToBranchID: "cordoba", ObservedCount: 5, AvgTransitHours: 8.5},
			{FromBranchID: "ghost", ToBranchID: "caba", ObservedCount: 1, AvgTransitHours: 1},
		},
	}
	branchRepo := &fakeBranchRepo{branches: map[string]model.Branch{
		"caba":    {ID: "caba", Latitude: &cabaLat, Longitude: &cabaLng, Province: "Buenos Aires"},
		"cordoba": {ID: "cordoba", Latitude: &cordobaLat, Longitude: &cordobaLng, Province: "Córdoba"},
	}}
	svc := NewBranchGraphService(graphRepo, branchRepo)

	count, err := svc.RunAutoderive()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if count != 1 {
		t.Errorf("solo la arista válida debe persistirse, count esperado 1, got %d", count)
	}
	if len(graphRepo.edges) != 1 || graphRepo.edges[0].FromBranchID != "caba" {
		t.Errorf("se esperaba [caba→cordoba], got %+v", graphRepo.edges)
	}
}
