package service

import (
	"sync"
	"testing"
	"time"

	"github.com/logitrack/core/internal/clock"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

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
	svc := NewClaimEscalationService(claimRepo, cfgRepo)

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
	svc := NewClaimEscalationService(claimRepo, cfgRepo)

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
	svc := NewClaimEscalationService(claimRepo, cfgRepo)

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
	svc := NewClaimEscalationService(claimRepo, cfgRepo)

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
	svc := NewClaimEscalationService(claimRepo, cfgRepo)

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
	svc := NewClaimEscalationService(claimRepo, cfgRepo)

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
	svc := NewClaimEscalationService(claimRepo, cfgRepo)

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
