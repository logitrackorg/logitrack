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

// maxTablePoints es el tope de puntos por request al OSRM Table API.
// Por encima de este número la URL resultante puede exceder los límites
// de algunos proxies (~8KB) y el costo cuadrático del solver crece feo.
const maxTablePoints = 80

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
