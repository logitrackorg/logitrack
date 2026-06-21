package geo

import (
	_ "embed"
	"encoding/json"
	"sync"
)

// localidades_argentina.json combines two official Argentine sources:
//   - INDEC Censo 2022 population by "gobierno local" (municipality/commune)
//   - Georef (datos.gob.ar) locality centroids
//
// joined by the shared gobierno-local code. Each entry is one real
// city/municipality with its 2022 population and a representative coordinate,
// generated offline and embedded so snap-to-city and geocoding never depend on
// a live network call (no Overpass/Nominatim timeouts, works offline).
//
//go:embed data/localidades_argentina.json
var localidadesJSON []byte

// Locality is one Argentine city/municipality with official 2022 population.
type Locality struct {
	Nombre    string  `json:"nombre"`
	Provincia string  `json:"provincia"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Poblacion int     `json:"poblacion"`
	// Categoria is the INDEC government-type code (MU, M1, M2, CO, CR, …).
	Categoria string `json:"categoria"`
}

var (
	localidadesOnce   sync.Once
	localidades       []Locality
	localidadesByName map[string]Locality // normalized name → most populous match
)

// loadLocalidades parses the embedded dataset once, lazily, and builds a
// normalized-name index. Panics on a malformed asset — a packaging error, not a
// runtime condition callers handle.
func loadLocalidades() {
	localidadesOnce.Do(func() {
		if err := json.Unmarshal(localidadesJSON, &localidades); err != nil {
			panic("geo: localidades_argentina.json inválido: " + err.Error())
		}
		if len(localidades) == 0 {
			panic("geo: localidades_argentina.json sin entradas")
		}
		// Index by normalized name. When several localities share a name across
		// provinces, keep the most populous — the most likely intended one for a
		// bare-name lookup.
		localidadesByName = make(map[string]Locality, len(localidades))
		for _, l := range localidades {
			key := normalizeCity(l.Nombre)
			if ex, ok := localidadesByName[key]; !ok || l.Poblacion > ex.Poblacion {
				localidadesByName[key] = l
			}
		}
	})
}

// LookupLocality returns the most populous locality matching name (accent- and
// case-insensitive) from the embedded INDEC/Georef dataset, if present.
func LookupLocality(name string) (Locality, bool) {
	loadLocalidades()
	l, ok := localidadesByName[normalizeCity(name)]
	return l, ok
}

// Localities returns the full embedded list of Argentine localities. The slice
// is shared (read-only) — callers must not mutate it.
func Localities() []Locality {
	loadLocalidades()
	return localidades
}

// LocalityCount returns how many localities the embedded dataset holds. Useful
// for a startup log line / health check.
func LocalityCount() int {
	loadLocalidades()
	return len(localidades)
}
