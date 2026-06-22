package service

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

// stubShipmentRepoForEscalation es un stub mínimo de
// repository.ShipmentRepository que solo implementa GetByTrackingID,
// devolviendo un Shipment con el OriginBranchID configurado. El resto de
// métodos paniquean — solo se invoca esta interfaz desde el job de
// escalado, y el test falla ruidosamente si algún cambio futuro empieza a
// usar otra cosa. Permite testear el chequeo del tope sin levantar el
// event-sourced repo completo.
type stubShipmentRepoForEscalation struct {
	repository.ShipmentRepository // panic en cualquier método no implementado
	byTrackingID                  map[string]model.Shipment
}

func newStubShipmentRepoForEscalation() *stubShipmentRepoForEscalation {
	return &stubShipmentRepoForEscalation{byTrackingID: map[string]model.Shipment{}}
}

func (r *stubShipmentRepoForEscalation) put(trackingID, originBranchID string) {
	r.byTrackingID[trackingID] = model.Shipment{
		TrackingID:     trackingID,
		OriginBranchID: originBranchID,
	}
}

func (r *stubShipmentRepoForEscalation) GetByTrackingID(trackingID string) (model.Shipment, error) {
	if sh, ok := r.byTrackingID[trackingID]; ok {
		return sh, nil
	}
	return model.Shipment{}, fmt.Errorf("shipment not found: %s", trackingID)
}

// stubSystemConfigRepo es una implementación en memoria de
// repository.SystemConfigRepository, suficiente para los tests del escalado.
type stubSystemConfigRepo struct {
	mu  sync.RWMutex
	cfg model.SystemConfig
}

func newStubSystemConfigRepo(cfg model.SystemConfig) *stubSystemConfigRepo {
	return &stubSystemConfigRepo{cfg: cfg}
}

func (s *stubSystemConfigRepo) Get() model.SystemConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *stubSystemConfigRepo) Update(cfg model.SystemConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	return nil
}

// defaultEscalationCfg devuelve una config con escalado habilitado y los
// thresholds por defecto (en días), sin importar otros valores que no usa el job.
func defaultEscalationCfg() model.SystemConfig {
	return model.SystemConfig{
		ClaimEscalationEnabled:   true,
		ClaimEscalationBajaDays:  3,
		ClaimEscalationMediaDays: 2,
		ClaimEscalationAltaDays:  1,
	}
}

// seedClaim inserta un reclamo en el repo con la prioridad y updated_at
// indicados, y devuelve su ID.
func seedClaim(t *testing.T, repo repository.ClaimRepository, status model.ClaimStatus, priority model.ClaimPriority, updatedAt time.Time) string {
	t.Helper()
	id, err := repo.NextID()
	if err != nil {
		t.Fatalf("NextID: %v", err)
	}
	c := model.Claim{
		ID:          id,
		TrackingID:  "LT-TEST0001",
		ClaimType:   model.ClaimTypeDelay,
		Status:      status,
		Description: "test",
		CreatedBy:   "tester",
		CreatedAt:   updatedAt,
		UpdatedAt:   updatedAt,
		Priority:    priority,
	}
	if err := repo.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	return id
}

// withFrozenClock corre la función f con el reloj global anclado en `at`,
// y restaura el reloj antes de salir.
func withFrozenClock(t *testing.T, at time.Time, f func()) {
	t.Helper()
	clock.SetOverride(at)
	defer clock.ClearOverride()
	f()
}

func TestClaimEscalation_BajaToMedia(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(defaultEscalationCfg())
	svc := NewClaimEscalationService(claimRepo, cfgRepo, nil)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := seedClaim(t, claimRepo, model.ClaimStatusOpen, model.ClaimPriorityBaja, base)

	// 3 días + 1h: cruzamos el umbral baja=3 días.
	withFrozenClock(t, base.Add(3*24*time.Hour+time.Hour), func() {
		n, err := svc.Run()
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if n != 1 {
			t.Fatalf("se esperaba 1 escalado, hubo %d", n)
		}
	})

	got, err := claimRepo.GetByID(id)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Priority != model.ClaimPriorityMedia {
		t.Errorf("prioridad: quiero media, obtuve %s", got.Priority)
	}
	if got.PriorityNote == "" {
		t.Error("priority_note vacía después del escalado")
	}
}

func TestClaimEscalation_MediaToAlta(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(defaultEscalationCfg())
	svc := NewClaimEscalationService(claimRepo, cfgRepo, nil)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := seedClaim(t, claimRepo, model.ClaimStatusInReview, model.ClaimPriorityMedia, base)

	// 2 días exactos: cruzamos el umbral media=2 días.
	withFrozenClock(t, base.Add(2*24*time.Hour), func() {
		if _, err := svc.Run(); err != nil {
			t.Fatalf("Run: %v", err)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if got.Priority != model.ClaimPriorityAlta {
		t.Errorf("prioridad: quiero alta, obtuve %s", got.Priority)
	}
}

func TestClaimEscalation_AltaToUrgente(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(defaultEscalationCfg())
	svc := NewClaimEscalationService(claimRepo, cfgRepo, nil)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := seedClaim(t, claimRepo, model.ClaimStatusOpen, model.ClaimPriorityAlta, base)

	// 1 día + 1h: cruzamos el umbral alta=1 día.
	withFrozenClock(t, base.Add(24*time.Hour+time.Hour), func() {
		if _, err := svc.Run(); err != nil {
			t.Fatalf("Run: %v", err)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if got.Priority != model.ClaimPriorityUrgente {
		t.Errorf("prioridad: quiero urgente, obtuve %s", got.Priority)
	}
}

func TestClaimEscalation_UrgenteNoEscala(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(defaultEscalationCfg())
	svc := NewClaimEscalationService(claimRepo, cfgRepo, nil)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := seedClaim(t, claimRepo, model.ClaimStatusOpen, model.ClaimPriorityUrgente, base)

	withFrozenClock(t, base.Add(30*24*time.Hour), func() {
		n, err := svc.Run()
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if n != 0 {
			t.Fatalf("urgente no debe escalar, hubo %d", n)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if got.Priority != model.ClaimPriorityUrgente {
		t.Errorf("urgente debe quedar igual, obtuve %s", got.Priority)
	}
}

func TestClaimEscalation_DentroDelUmbralNoEscala(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(defaultEscalationCfg())
	svc := NewClaimEscalationService(claimRepo, cfgRepo, nil)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := seedClaim(t, claimRepo, model.ClaimStatusOpen, model.ClaimPriorityBaja, base)

	// Apenas 12 horas, por debajo del umbral baja=72h.
	withFrozenClock(t, base.Add(12*time.Hour), func() {
		n, err := svc.Run()
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if n != 0 {
			t.Fatalf("no debe escalar dentro del umbral, hubo %d", n)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if got.Priority != model.ClaimPriorityBaja {
		t.Errorf("prioridad: quiero baja, obtuve %s", got.Priority)
	}
}

func TestClaimEscalation_FeatureDeshabilitada(t *testing.T) {
	cfg := defaultEscalationCfg()
	cfg.ClaimEscalationEnabled = false

	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(cfg)
	svc := NewClaimEscalationService(claimRepo, cfgRepo, nil)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := seedClaim(t, claimRepo, model.ClaimStatusOpen, model.ClaimPriorityBaja, base)

	// Muy lejos del umbral, pero el flag está apagado.
	withFrozenClock(t, base.Add(30*24*time.Hour), func() {
		n, err := svc.Run()
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if n != 0 {
			t.Fatalf("flag deshabilitado: 0 escalados, hubo %d", n)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if got.Priority != model.ClaimPriorityBaja {
		t.Errorf("flag deshabilitado: prioridad debe quedar igual, obtuve %s", got.Priority)
	}
}

func TestClaimEscalation_ReclamoResueltoSeIgnora(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(defaultEscalationCfg())
	svc := NewClaimEscalationService(claimRepo, cfgRepo, nil)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	id := seedClaim(t, claimRepo, model.ClaimStatusResolvedOperativa, model.ClaimPriorityBaja, base)

	withFrozenClock(t, base.Add(200*time.Hour), func() {
		n, err := svc.Run()
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if n != 0 {
			t.Fatalf("resuelto no debe escalar, hubo %d", n)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if got.Priority != model.ClaimPriorityBaja {
		t.Errorf("reclamo resuelto: prioridad debe quedar igual, obtuve %s", got.Priority)
	}
}

// seedClaimAt inserta un reclamo con un tracking ID y sucursal asignada
// dados, además de prioridad/estado/updatedAt. La sucursal asignada es la
// que el in-memory claim repo usa para CountOpenAndUrgentByBranch.
func seedClaimAt(t *testing.T, repo repository.ClaimRepository, trackingID, branchID string, status model.ClaimStatus, priority model.ClaimPriority, updatedAt time.Time) string {
	t.Helper()
	id, err := repo.NextID()
	if err != nil {
		t.Fatalf("NextID: %v", err)
	}
	c := model.Claim{
		ID:               id,
		TrackingID:       trackingID,
		ClaimType:        model.ClaimTypeDelay,
		Status:           status,
		Description:      "test",
		CreatedBy:        "tester",
		CreatedAt:        updatedAt,
		UpdatedAt:        updatedAt,
		Priority:         priority,
		AssignedBranchID: branchID,
	}
	if err := repo.Create(c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	return id
}

// escalationCfgWithCap devuelve la cfg default de escalado con un cap de
// urgentes por sucursal personalizado.
func escalationCfgWithCap(capPct float64) model.SystemConfig {
	cfg := defaultEscalationCfg()
	cfg.UrgentClaimsCapPct = capPct
	return cfg
}

// TestClaimEscalation_AltaNoEscalaPorTopeYDejaNota verifica que cuando la
// sucursal está saturada de urgentes (ratio ≥ cap), un reclamo en "alta"
// con inactividad vencida NO escala a "urgente" y queda con la nota visible
// en PriorityNote.
func TestClaimEscalation_AltaNoEscalaPorTopeYDejaNota(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(escalationCfgWithCap(0.2))
	shipRepo := newStubShipmentRepoForEscalation()
	shipRepo.put("LT-CAP00001", "caba")
	svc := NewClaimEscalationService(claimRepo, cfgRepo, shipRepo)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	// 4 urgentes abiertos en la misma sucursal — saturan el cap (0.2).
	for i := range 4 {
		seedClaimAt(t, claimRepo, fmt.Sprintf("LT-URG%05d", i), "caba",
			model.ClaimStatusInReview, model.ClaimPriorityUrgente, base)
	}
	// El reclamo bajo prueba, alta, ya inactivo más allá del umbral.
	id := seedClaimAt(t, claimRepo, "LT-CAP00001", "caba",
		model.ClaimStatusOpen, model.ClaimPriorityAlta, base)

	withFrozenClock(t, base.Add(2*24*time.Hour), func() {
		n, err := svc.Run()
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if n != 0 {
			t.Fatalf("tope alcanzado: 0 escalados, hubo %d", n)
		}
	})

	got, err := claimRepo.GetByID(id)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Priority != model.ClaimPriorityAlta {
		t.Errorf("tope alcanzado: la prioridad debe quedar en alta, obtuve %s", got.Priority)
	}
	if !strings.Contains(got.PriorityNote, urgentCapNote) {
		t.Errorf("tope alcanzado: priority_note debe contener la nota de tope, obtuve %q", got.PriorityNote)
	}
	if !got.UpdatedAt.Equal(base) {
		t.Errorf("tope alcanzado: UpdatedAt no debe avanzar (reloj de inactividad), obtuve %v vs %v", got.UpdatedAt, base)
	}
}

// TestClaimEscalation_NotaDeTopeNoSeDuplica verifica que en el siguiente
// tick (sucursal sigue saturada, reclamo sigue vencido), la nota de tope
// queda una sola vez en PriorityNote — la rama de skip es idempotente.
func TestClaimEscalation_NotaDeTopeNoSeDuplica(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(escalationCfgWithCap(0.2))
	shipRepo := newStubShipmentRepoForEscalation()
	shipRepo.put("LT-CAP00002", "caba")
	svc := NewClaimEscalationService(claimRepo, cfgRepo, shipRepo)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range 4 {
		seedClaimAt(t, claimRepo, fmt.Sprintf("LT-URG%05d", i), "caba",
			model.ClaimStatusInReview, model.ClaimPriorityUrgente, base)
	}
	id := seedClaimAt(t, claimRepo, "LT-CAP00002", "caba",
		model.ClaimStatusOpen, model.ClaimPriorityAlta, base)

	// Dos ticks consecutivos: ambos deben encontrar el tope y skipear.
	withFrozenClock(t, base.Add(2*24*time.Hour), func() {
		if _, err := svc.Run(); err != nil {
			t.Fatalf("Run 1: %v", err)
		}
	})
	withFrozenClock(t, base.Add(2*24*time.Hour+15*time.Minute), func() {
		if _, err := svc.Run(); err != nil {
			t.Fatalf("Run 2: %v", err)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if count := strings.Count(got.PriorityNote, urgentCapNote); count != 1 {
		t.Errorf("la nota de tope debe aparecer una sola vez, apareció %d veces (note=%q)", count, got.PriorityNote)
	}
}

// TestClaimEscalation_AltaEscalaACuandoCapNoSeAlcanza verifica que cuando
// la sucursal NO está saturada (ratio < cap), un reclamo en "alta" vencido
// sí escala a "urgente" y la nota de tope NO queda en PriorityNote.
func TestClaimEscalation_AltaEscalaACuandoCapNoSeAlcanza(t *testing.T) {
	claimRepo := repository.NewInMemoryClaimRepository()
	cfgRepo := newStubSystemConfigRepo(escalationCfgWithCap(0.5))
	shipRepo := newStubShipmentRepoForEscalation()
	shipRepo.put("LT-LOW0001", "cordoba")
	svc := NewClaimEscalationService(claimRepo, cfgRepo, shipRepo)

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	// Solo el reclamo bajo prueba en la sucursal — ratio 0/1 = 0 < cap.
	id := seedClaimAt(t, claimRepo, "LT-LOW0001", "cordoba",
		model.ClaimStatusOpen, model.ClaimPriorityAlta, base)

	withFrozenClock(t, base.Add(2*24*time.Hour), func() {
		n, err := svc.Run()
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if n != 1 {
			t.Fatalf("cap no alcanzado: se esperaba 1 escalado, hubo %d", n)
		}
	})

	got, _ := claimRepo.GetByID(id)
	if got.Priority != model.ClaimPriorityUrgente {
		t.Errorf("cap no alcanzado: la prioridad debe ser urgente, obtuve %s", got.Priority)
	}
	if strings.Contains(got.PriorityNote, urgentCapNote) {
		t.Errorf("cap no alcanzado: la nota de tope no debe estar presente, obtuve %q", got.PriorityNote)
	}
}
