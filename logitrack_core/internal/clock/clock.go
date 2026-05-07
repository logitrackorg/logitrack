// Package clock provee un reloj global con override en memoria, usado para
// testing manual desde el panel admin. En modo normal Now() devuelve time.Now().
// Cuando un admin setea un override, Now() devuelve time.Now() + offset, donde
// offset = override_target - time.Now() al momento de setear. El reloj sigue
// avanzando desde el override (no queda congelado), de modo que timestamps
// generados durante el override no colisionen.
//
// El estado vive solo en memoria: al reiniciar el backend el override se pierde.
package clock

import (
	"sync"
	"time"
)

var (
	mu     sync.RWMutex
	offset time.Duration
)

// LocalTZ es la zona horaria operativa del sistema (Argentina, UTC-3 sin DST).
// Usar `clock.Now().In(clock.LocalTZ)` cuando se necesite la hora o fecha local
// para lógica de wall-clock (ej: hora de salida del día, fecha de la ruta del
// chofer). Para timestamps absolutos guardados en DB seguir usando UTC.
var LocalTZ *time.Location

func init() {
	loc, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		loc = time.FixedZone("ART", -3*3600)
	}
	LocalTZ = loc
}

// Now devuelve la hora actual según el reloj del sistema, aplicando el offset
// si hay un override activo. Reemplaza time.Now() en todo el código de
// aplicación.
func Now() time.Time {
	mu.RLock()
	off := offset
	mu.RUnlock()
	if off == 0 {
		return time.Now()
	}
	return time.Now().Add(off)
}

// SetOverride configura el reloj para que Now() devuelva el target en este
// instante real, y siga avanzando desde ahí.
func SetOverride(target time.Time) {
	mu.Lock()
	defer mu.Unlock()
	offset = time.Until(target)
}

// ClearOverride desactiva el override; Now() vuelve a equivaler a time.Now().
func ClearOverride() {
	mu.Lock()
	defer mu.Unlock()
	offset = 0
}

// Offset devuelve el offset actual entre Now() y time.Now().
func Offset() time.Duration {
	mu.RLock()
	defer mu.RUnlock()
	return offset
}

// IsActive indica si hay un override aplicado.
func IsActive() bool {
	mu.RLock()
	defer mu.RUnlock()
	return offset != 0
}
