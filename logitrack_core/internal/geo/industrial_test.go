package geo

import "testing"

func TestIndustrialZoneCount(t *testing.T) {
	n := IndustrialZoneCount()
	if n == 0 {
		t.Fatal("dataset IGN vacío: el asset embebido no se cargó")
	}
	if n < 400 {
		t.Errorf("se esperaban ~422 zonas IGN, se cargaron %d", n)
	}
}

func TestIndustrialZoneNear(t *testing.T) {
	// gid=93: zona industrial real en el sur del GBA (centro ~-34.786, -58.248).
	const lat, lng = -34.7865, -58.2485

	if !IndustrialZoneNear(lat, lng, 10.0) {
		t.Error("se esperaba detectar una zona industrial IGN cerca del punto conocido")
	}

	// Punto en pleno Atlántico: no debe haber ninguna zona cerca.
	if IndustrialZoneNear(-40.0, -50.0, 10.0) {
		t.Error("no debería haber zonas industriales en el océano")
	}
}

func TestIndustrialRingsInBBox(t *testing.T) {
	// Caja que cubre el sur del GBA, donde están las zonas gid=93/94.
	rings := IndustrialRingsInBBox(-58.5, -35.0, -58.0, -34.5)
	if len(rings) == 0 {
		t.Fatal("se esperaban anillos de zonas industriales en el sur del GBA")
	}
	for i, ring := range rings {
		if len(ring) < 3 {
			t.Errorf("anillo %d con menos de 3 vértices: %d", i, len(ring))
		}
		// Las coordenadas deben venir como [lat, lng] dentro de rangos argentinos.
		lat, lng := ring[0][0], ring[0][1]
		if lat < -56 || lat > -21 {
			t.Errorf("anillo %d: latitud fuera de rango argentino: %f", i, lat)
		}
		if lng < -74 || lng > -53 {
			t.Errorf("anillo %d: longitud fuera de rango argentino: %f", i, lng)
		}
	}

	// Caja en el océano: sin resultados.
	if got := IndustrialRingsInBBox(-50.0, -41.0, -49.0, -40.0); len(got) != 0 {
		t.Errorf("caja oceánica debería devolver 0 anillos, dio %d", len(got))
	}
}
