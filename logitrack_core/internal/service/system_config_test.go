package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
)

// stubSystemConfigRepoBare es una implementación mínima en memoria de
// SystemConfigRepository, suficiente para los tests de SystemConfigService.
// No usamos newStubSystemConfigRepo de claim_escalation_test.go directamente
// para evitar dependencias cruzadas entre archivos de tests, pero el shape
// es equivalente.
type stubSystemConfigRepoBare struct {
	cfg model.SystemConfig
}

func (s *stubSystemConfigRepoBare) Get() model.SystemConfig          { return s.cfg }
func (s *stubSystemConfigRepoBare) Update(c model.SystemConfig) error { s.cfg = c; return nil }

// validBaseCfg devuelve una SystemConfig que pasa todas las validaciones
// del servicio, con un toggle de escalado parametrizable.
func validBaseCfg(escalationEnabled bool) model.SystemConfig {
	cfg := model.DefaultSystemConfig()
	cfg.ClaimEscalationEnabled = escalationEnabled
	return cfg
}

// TestSystemConfig_OnEscalationEnabled_DispararSoloEnTransicionFalseATrue
// verifica que el callback registrado vía SetOnEscalationEnabled se invoca
// exactamente una vez por transición false → true del toggle de escalado,
// y no se invoca en true → true, true → false, ni false → false.
func TestSystemConfig_OnEscalationEnabled_DispararSoloEnTransicionFalseATrue(t *testing.T) {
	cases := []struct {
		name        string
		prev        bool
		next        bool
		wantInvoked bool
	}{
		{"false → true dispara", false, true, true},
		{"true → true no dispara", true, true, false},
		{"true → false no dispara", true, false, false},
		{"false → false no dispara", false, false, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubSystemConfigRepoBare{cfg: validBaseCfg(tc.prev)}
			svc := NewSystemConfigService(repo)

			invocations := 0
			svc.SetOnEscalationEnabled(func() { invocations++ })

			newCfg := validBaseCfg(tc.next)
			if _, err := svc.Update(newCfg); err != nil {
				t.Fatalf("Update: %v", err)
			}

			if tc.wantInvoked && invocations != 1 {
				t.Errorf("se esperaba 1 invocación del callback, hubo %d", invocations)
			}
			if !tc.wantInvoked && invocations != 0 {
				t.Errorf("no se esperaba invocación, hubo %d", invocations)
			}
		})
	}
}

// TestSystemConfig_OnEscalationEnabled_SinCallbackNoExplota verifica que si
// no se setea callback, Update no se rompe en la transición.
func TestSystemConfig_OnEscalationEnabled_SinCallbackNoExplota(t *testing.T) {
	repo := &stubSystemConfigRepoBare{cfg: validBaseCfg(false)}
	svc := NewSystemConfigService(repo)

	if _, err := svc.Update(validBaseCfg(true)); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if got := repo.Get().ClaimEscalationEnabled; !got {
		t.Errorf("la config debe quedar persistida con escalado habilitado")
	}
}
