package service

import (
	"testing"
	"time"

	"github.com/logitrack/core/internal/clock"
)

func TestLessUserID_NumericOrdering(t *testing.T) {
	cases := []struct {
		a, b string
		want bool // true => a should rank before b (a is "lower")
	}{
		{"5", "12", true},  // 5 < 12 numerically (string compare would give false)
		{"12", "5", false}, // inverse of above
		{"2", "10", true},  // 2 < 10 numerically (string compare would give false)
		{"1", "2", true},   // trivial numeric
		{"15", "16", true}, // adjacent
		{"x", "y", true},   // non-numeric fallback to lexicographic
		{"10", "9", false}, // 10 > 9 numerically
	}
	for _, c := range cases {
		if got := lessUserID(c.a, c.b); got != c.want {
			t.Errorf("lessUserID(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestMonthBounds_ARTBoundaries(t *testing.T) {
	// Cualquier instante dentro de mayo 2026 debe producir [1 may 00:00, 31 may 23:59:59] ART.
	mid := time.Date(2026, 5, 15, 14, 30, 0, 0, clock.LocalTZ)
	start, end := monthBounds(mid)

	if start.Day() != 1 || start.Month() != time.May || start.Year() != 2026 {
		t.Errorf("start = %v, want 2026-05-01", start)
	}
	if start.Hour() != 0 || start.Minute() != 0 || start.Second() != 0 {
		t.Errorf("start time = %v, want 00:00:00", start)
	}
	if end.Day() != 31 || end.Month() != time.May {
		t.Errorf("end = %v, want 2026-05-31", end)
	}
	// El fin debe ser estrictamente menor al primer instante del mes siguiente.
	nextMonth := time.Date(2026, 6, 1, 0, 0, 0, 0, clock.LocalTZ)
	if !end.Before(nextMonth) {
		t.Errorf("end %v should be before %v", end, nextMonth)
	}
}

func TestPreviousMonthStart_IsFirstOfPriorMonth(t *testing.T) {
	prev := PreviousMonthStart()
	now := clock.Now().In(clock.LocalTZ)

	if prev.Day() != 1 {
		t.Errorf("PreviousMonthStart day = %d, want 1", prev.Day())
	}
	// Debe ser exactamente un mes antes del primero del mes actual.
	expected := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, clock.LocalTZ).AddDate(0, -1, 0)
	if !prev.Equal(expected) {
		t.Errorf("PreviousMonthStart = %v, want %v", prev, expected)
	}
}
