// Package ors es un cliente HTTP minimal para OpenRouteService Directions API.
//
// Se usa específicamente para el modo "segura" de última milla, donde
// necesitamos que el motor de ruteo evite polígonos enteros (zonas peligrosas)
// y no solo puntos. OSRM público no soporta avoid_polygons; ORS sí.
//
// API key: registrarse gratis en https://openrouteservice.org/dev/#/signup.
// El cliente devuelve nil cuando ORS_API_KEY no está configurada — el caller
// debe checkear if c == nil para caer al fallback de OSRM.
//
// Rate limits del free tier:
//   - 40 requests/minuto
//   - 2000 requests/día
package ors

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Coord es una coordenada geográfica (WGS84).
type Coord struct {
	Lat float64
	Lon float64
}

// Polygon es el contorno cerrado de una zona a evitar. Los Coords forman un
// anillo (last == first); si no está cerrado, el cliente lo cierra antes de
// serializar a GeoJSON.
type Polygon struct {
	Coords []Coord
}

// Client habla con un servidor OpenRouteService. Es seguro pasar un *Client
// nil — los callers deben chequear if c == nil antes de usarlo.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// NewClient devuelve un cliente listo para usar. Si apiKey está vacía,
// devuelve nil (modo "ORS deshabilitado", caer al fallback). baseURL es
// opcional; default = https://api.openrouteservice.org.
func NewClient(baseURL, apiKey string) *Client {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.openrouteservice.org"
	}
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

// requestBody se serializa al body del POST a /v2/directions/driving-car/geojson.
type requestBody struct {
	Coordinates [][]float64 `json:"coordinates"`
	// Radiuses: radio de snapping en metros por coordenada. -1 = ilimitado.
	// Por defecto ORS usa 350m; algunas coordenadas (suburbios, zonas rurales)
	// pueden no tener calles tan cerca → se envía -1 para todos y ORS elige
	// la calle más cercana sin importar distancia.
	Radiuses []float64       `json:"radiuses"`
	Options  *requestOptions `json:"options,omitempty"`
}

type requestOptions struct {
	AvoidPolygons *geoJSONGeometry `json:"avoid_polygons,omitempty"`
}

// geoJSONGeometry encodea un Polygon o MultiPolygon en formato GeoJSON.
//
//   - Para 1 zona usamos Polygon: coordinates = [ring]  (3 niveles)
//   - Para N zonas usamos MultiPolygon: coordinates = [[ring], [ring], ...]
//
// El campo Coordinates se mantiene como interface{} porque la profundidad
// del array cambia según el tipo.
type geoJSONGeometry struct {
	Type        string      `json:"type"`
	Coordinates interface{} `json:"coordinates"`
}

// orsResponse soporta DOS formatos de respuesta de ORS:
//   - GeoJSON (/geojson): features[0].geometry.coordinates
//   - JSON estándar (/json o sin sufijo): routes[0].geometry.coordinates
//     (coordenadas directas en el campo geometry del estilo geojson_simplified)
//
// ORS cambió el formato en diferentes versiones; intentamos ambas interpretaciones.
type orsResponse struct {
	// Formato GeoJSON (/geojson)
	Features []struct {
		Geometry struct {
			Coordinates [][]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"features"`
	// Formato estándar (/json o raíz)
	Routes []struct {
		Geometry struct {
			Coordinates [][]float64 `json:"coordinates"`
		} `json:"geometry"`
	} `json:"routes"`
}

// Route llama al ORS Directions API e intenta dos endpoints en orden:
//  1. /v2/directions/driving-car/geojson  (respuesta GeoJSON directa)
//  2. /v2/directions/driving-car          (respuesta JSON estándar)
//
// ORS ha cambiado su estructura en distintas versiones; probamos ambos y
// usamos el primero que responda con 2xx. Si avoidPolygons está vacío, ORS
// rutea libremente (equivalente a OSRM Route).
func (c *Client) Route(coords []Coord, avoidPolygons []Polygon) ([]Coord, error) {
	if c == nil {
		return nil, errors.New("ors: client not configured")
	}
	if len(coords) < 2 {
		return nil, errors.New("ors: need at least 2 coordinates")
	}

	// Radiuses: -1 por cada coordenada = sin límite de snapping.
	// ORS usa 350m por defecto y rechaza coords sin calles en ese radio.
	radiuses := make([]float64, len(coords))
	for i := range radiuses {
		radiuses[i] = -1
	}
	body := requestBody{Coordinates: coordsToArr(coords), Radiuses: radiuses}
	if len(avoidPolygons) > 0 {
		body.Options = &requestOptions{
			AvoidPolygons: buildAvoidGeometry(avoidPolygons),
		}
	}
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("ors: marshal body: %w", err)
	}

	// Probar ambos endpoints. Algunos planes/versiones de ORS responden a uno
	// pero no al otro.
	endpoints := []string{
		c.baseURL + "/v2/directions/driving-car/geojson",
		c.baseURL + "/v2/directions/driving-car",
	}
	var lastErr error
	for _, apiURL := range endpoints {
		result, err := c.doRoute(apiURL, jsonBody)
		if err == nil {
			return result, nil
		}
		lastErr = fmt.Errorf("url=%s err=%w", apiURL, err)
	}
	return nil, lastErr
}

func (c *Client) doRoute(apiURL string, jsonBody []byte) ([]Coord, error) {
	req, err := http.NewRequest(http.MethodPost, apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("ors: build request: %w", err)
	}
	req.Header.Set("Authorization", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "LogiTrack/1.0")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ors: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		var errBody [512]byte
		n, _ := resp.Body.Read(errBody[:])
		return nil, fmt.Errorf("ors: status %d body=%s", resp.StatusCode, string(errBody[:n]))
	}

	var parsed orsResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("ors: decode response: %w", err)
	}

	// Extraer coordenadas según el formato de respuesta.
	var raw [][]float64
	if len(parsed.Features) > 0 {
		raw = parsed.Features[0].Geometry.Coordinates
	} else if len(parsed.Routes) > 0 {
		raw = parsed.Routes[0].Geometry.Coordinates
	}
	if len(raw) == 0 {
		return nil, errors.New("ors: no geometry coordinates in response")
	}

	out := make([]Coord, 0, len(raw))
	for _, c := range raw {
		if len(c) < 2 {
			continue
		}
		// GeoJSON: [lng, lat]
		out = append(out, Coord{Lat: c[1], Lon: c[0]})
	}
	return out, nil
}

func coordsToArr(coords []Coord) [][]float64 {
	out := make([][]float64, len(coords))
	for i, c := range coords {
		// GeoJSON: [lng, lat]
		out[i] = []float64{c.Lon, c.Lat}
	}
	return out
}

// polygonToRing convierte un Polygon a un GeoJSON LinearRing (array de [lng,lat]).
// Cierra el anillo si no lo está (GeoJSON requiere last == first).
func polygonToRing(p Polygon) [][]float64 {
	ring := make([][]float64, 0, len(p.Coords)+1)
	for _, c := range p.Coords {
		ring = append(ring, []float64{c.Lon, c.Lat})
	}
	if len(ring) > 0 {
		first, last := ring[0], ring[len(ring)-1]
		if first[0] != last[0] || first[1] != last[1] {
			ring = append(ring, first)
		}
	}
	return ring
}

func buildAvoidGeometry(polys []Polygon) *geoJSONGeometry {
	if len(polys) == 1 {
		// Polygon: coords = [outerRing]
		return &geoJSONGeometry{
			Type:        "Polygon",
			Coordinates: [][][]float64{polygonToRing(polys[0])},
		}
	}
	// MultiPolygon: coords = [[outerRing], [outerRing], ...]
	multi := make([][][][]float64, len(polys))
	for i, p := range polys {
		multi[i] = [][][]float64{polygonToRing(p)}
	}
	return &geoJSONGeometry{
		Type:        "MultiPolygon",
		Coordinates: multi,
	}
}
