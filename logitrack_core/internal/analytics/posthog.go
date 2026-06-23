package analytics

import (
	"log"
	"os"

	"github.com/posthog/posthog-go"
)

// Client es el wrapper del cliente PostHog
type Client struct {
	ph      posthog.Client
	enabled bool
}

// NewPostHogClient inicializa el cliente PostHog usando la API key del entorno.
// Si no hay API key configurada, devuelve un cliente deshabilitado (no rompe nada).
func NewPostHogClient() *Client {
	apiKey := os.Getenv("POSTHOG_API_KEY")
	if apiKey == "" {
		log.Println("[analytics] POSTHOG_API_KEY no configurada, tracking deshabilitado")
		return &Client{enabled: false}
	}

	ph, err := posthog.NewWithConfig(apiKey, posthog.Config{
		Endpoint: "https://app.posthog.com",
	})
	if err != nil {
		log.Printf("[analytics] Error inicializando PostHog: %v", err)
		return &Client{enabled: false}
	}

	log.Println("[analytics] PostHog inicializado correctamente")
	return &Client{ph: ph, enabled: true}
}

// Track envía un evento a PostHog de forma segura (nunca rompe el flujo principal).
// distinctID: identificador único del usuario (DNI, tracking_id, etc.)
// event: nombre del evento ("chatbot_opened", etc.)
// properties: mapa de propiedades adicionales
func (c *Client) Track(distinctID, event string, properties map[string]interface{}) {
	if !c.enabled || c.ph == nil {
		return
	}

	props := posthog.NewProperties()
	for k, v := range properties {
		props.Set(k, v)
	}

	if err := c.ph.Enqueue(posthog.Capture{
		DistinctId: distinctID,
		Event:      event,
		Properties: props,
	}); err != nil {
		log.Printf("[analytics] Error enviando evento '%s': %v", event, err)
	}
}

// Close cierra el cliente limpiamente (llamar en shutdown).
func (c *Client) Close() {
	if c.enabled && c.ph != nil {
		_ = c.ph.Close()
	}
}
