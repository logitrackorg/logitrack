package geo

import "testing"

func TestLocalityCount(t *testing.T) {
	n := LocalityCount()
	if n == 0 {
		t.Fatal("dataset de localidades vacío: el asset embebido no se cargó")
	}
	if n < 1500 {
		t.Errorf("se esperaban ~2100 localidades, se cargaron %d", n)
	}
}

func TestLocalitiesAreWithinArgentina(t *testing.T) {
	for _, l := range Localities() {
		if l.Lat < -56 || l.Lat > -21 {
			t.Errorf("%s (%s): latitud fuera de rango argentino: %f", l.Nombre, l.Provincia, l.Lat)
		}
		if l.Lng < -74 || l.Lng > -53 {
			t.Errorf("%s (%s): longitud fuera de rango argentino: %f", l.Nombre, l.Provincia, l.Lng)
		}
		if l.Poblacion <= 0 {
			t.Errorf("%s (%s): población no positiva: %d", l.Nombre, l.Provincia, l.Poblacion)
		}
		if l.Nombre == "" {
			t.Error("localidad con nombre vacío")
		}
	}
}

func TestLocalitiesContainKnownCities(t *testing.T) {
	want := map[string]bool{
		"El Calafate": false, "Ushuaia": false, "Tandil": false,
		"San Carlos de Bariloche": false, "Rosario": false,
	}
	for _, l := range Localities() {
		if _, ok := want[l.Nombre]; ok {
			want[l.Nombre] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("ciudad conocida ausente del dataset: %s", name)
		}
	}
}
