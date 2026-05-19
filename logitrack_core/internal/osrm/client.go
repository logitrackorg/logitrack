// Package osrm es un cliente HTTP minimal para el OSRM Table API.
//
// Se usa para construir matrices de tiempo y distancia entre paradas en el
// solver de VRP. El cliente es opcional: si no hay URL configurada, el caller
// usa un fallback de Haversine.
//
// Limitaciones conocidas del OSRM público (router.project-osrm.org):
//   - Sin SLA, rate-limited, ToS restringe uso intensivo.
//   - Pensado para desarrollo. Producción → self-host.
package osrm

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Coord es una coordenada geográfica (WGS84).
type Coord struct {
	Lat float64
	Lon float64
}

// Client habla con un servidor OSRM. Es seguro pasar un *Client nil — los
// callers deben chequear if c == nil antes de usarlo.
type Client struct {
	baseURL string
	http    *http.Client
}

// maxTablePoints es el tope de puntos por request a los endpoints de OSRM.
// El Table API tiene costo cuadrático en N, así que conviene quedar bajo;
// el Route API solo necesita estar bajo el límite de URL del proxy (~8KB ≈
// 200 coords). 150 alcanza para cubrir el caso de última milla con bordeado
// denso de varias zonas sin que el matrix de scheduling explote.
const maxTablePoints = 150

// NewClient devuelve un cliente listo para usar. Si baseURL está vacía o
// solo contiene whitespace, devuelve nil — ese es el modo "OSRM deshabilitado".
func NewClient(baseURL string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil
	}
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// tableResponse modela la respuesta del endpoint /table/v1/driving.
type tableResponse struct {
	Code      string      `json:"code"`
	Message   string      `json:"message,omitempty"`
	Durations [][]float64 `json:"durations"`
	Distances [][]float64 `json:"distances"`
}

// routeResponse modela la respuesta del endpoint /route/v1/driving con
// geometries=geojson — devuelve coords [lng, lat] a lo largo del trayecto.
type routeResponse struct {
	Code    string `json:"code"`
	Message string `json:"message,omitempty"`
	Routes  []struct {
		Geometry struct {
			Coordinates [][]float64 `json:"coordinates"`
		} `json:"geometry"`
		Distance float64 `json:"distance"` // metros
		Duration float64 `json:"duration"` // segundos
	} `json:"routes"`
}

// Route consulta el OSRM Route API y devuelve la geometría del trayecto (puntos
// lat/lng a lo largo de las calles) que pasa por los waypoints indicados en
// orden. Útil para dibujar la polyline real de una ruta en el mapa, en lugar
// de líneas rectas Haversine.
//
// Las coords intermedias se tratan como via-points: OSRM rutea por ellas en
// orden, snappeando cada una a la calle más cercana. Esto permite "forzar"
// la ruta a pasar por puntos específicos (por ejemplo, para bordear una zona
// peligrosa pasando vértices del polígono).
func (c *Client) Route(coords []Coord) ([]Coord, error) {
	if c == nil {
		return nil, errors.New("osrm: client not configured")
	}
	if len(coords) < 2 {
		return nil, errors.New("osrm: need at least 2 coordinates")
	}
	if len(coords) > maxTablePoints {
		return nil, fmt.Errorf("osrm: too many points (%d > %d)", len(coords), maxTablePoints)
	}

	parts := make([]string, len(coords))
	for i, c := range coords {
		parts[i] = strconv.FormatFloat(c.Lon, 'f', 6, 64) + "," + strconv.FormatFloat(c.Lat, 'f', 6, 64)
	}
	apiURL := c.baseURL + "/route/v1/driving/" + strings.Join(parts, ";") + "?overview=full&geometries=geojson"

	req, err := http.NewRequest(http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("osrm: build request: %w", err)
	}
	req.Header.Set("User-Agent", "LogiTrack/1.0")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("osrm: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("osrm: unexpected status %d", resp.StatusCode)
	}

	var body routeResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("osrm: decode response: %w", err)
	}
	if body.Code != "Ok" {
		return nil, fmt.Errorf("osrm: code=%s message=%s", body.Code, body.Message)
	}
	if len(body.Routes) == 0 {
		return nil, errors.New("osrm: no routes returned")
	}

	raw := body.Routes[0].Geometry.Coordinates
	out := make([]Coord, len(raw))
	for i, c := range raw {
		// GeoJSON: [lng, lat]
		if len(c) < 2 {
			continue
		}
		out[i] = Coord{Lat: c[1], Lon: c[0]}
	}
	return out, nil
}

// DurationMatrix consulta el OSRM Table API y devuelve dos matrices NxN:
// durations en segundos y distances en metros.
//
// El primer elemento de coords se trata como el depósito; todos los pares
// son válidos (la matriz no tiene una dirección privilegiada). Devuelve
// error si el cliente no está disponible, si len(coords) excede maxTablePoints
// o si el servidor responde con algo distinto a code: "Ok".
func (c *Client) DurationMatrix(coords []Coord) ([][]float64, [][]float64, error) {
	if c == nil {
		return nil, nil, errors.New("osrm: client not configured")
	}
	if len(coords) < 2 {
		return nil, nil, errors.New("osrm: need at least 2 coordinates")
	}
	if len(coords) > maxTablePoints {
		return nil, nil, fmt.Errorf("osrm: too many points (%d > %d)", len(coords), maxTablePoints)
	}

	parts := make([]string, len(coords))
	for i, c := range coords {
		// OSRM espera lon,lat (no lat,lon).
		parts[i] = strconv.FormatFloat(c.Lon, 'f', 6, 64) + "," + strconv.FormatFloat(c.Lat, 'f', 6, 64)
	}
	apiURL := c.baseURL + "/table/v1/driving/" + strings.Join(parts, ";") + "?annotations=duration,distance"

	req, err := http.NewRequest(http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("osrm: build request: %w", err)
	}
	req.Header.Set("User-Agent", "LogiTrack/1.0")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("osrm: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		return nil, nil, fmt.Errorf("osrm: unexpected status %d", resp.StatusCode)
	}

	var body tableResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, nil, fmt.Errorf("osrm: decode response: %w", err)
	}
	if body.Code != "Ok" {
		return nil, nil, fmt.Errorf("osrm: code=%s message=%s", body.Code, body.Message)
	}
	if len(body.Durations) != len(coords) {
		return nil, nil, fmt.Errorf("osrm: duration matrix size mismatch (got %d expected %d)", len(body.Durations), len(coords))
	}
	return body.Durations, body.Distances, nil
}
