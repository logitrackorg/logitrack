package service

import (
	"testing"

	"github.com/logitrack/core/internal/model"
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
