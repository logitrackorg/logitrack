# Guía de Integración con Mercado Pago

> Documentación oficial, SDKs, API reference y ejemplos para integrar Mercado Pago desde cero.
> Independiente de LogiTrack — válido para cualquier proyecto.

---

## 1. Links oficiales

| Recurso | URL |
|---------|-----|
| **Developers (AR)** | [mercadopago.com.ar/developers/es](https://www.mercadopago.com.ar/developers/es) |
| **Documentación completa** | [mercadopago.com.ar/developers/es/docs](https://www.mercadopago.com.ar/developers/es/docs) |
| **Referencia API** | [mercadopago.com.ar/developers/es/reference](https://www.mercadopago.com.ar/developers/es/reference) |
| **SDKs** | [mercadopago.com.ar/developers/es/docs/sdks-library/landing](https://www.mercadopago.com.ar/developers/es/docs/sdks-library/landing) |
| **Credenciales** | [mercadopago.com.ar/developers/panel/app](https://www.mercadopago.com.ar/developers/panel/app) |
| **SDK Go (GitHub)** | [github.com/mercadopago/sdk-go](https://github.com/mercadopago/sdk-go) |
| **SDK Python (GitHub)** | [github.com/mercadopago/sdk-python](https://github.com/mercadopago/sdk-python) |
| **SDK Node.js (npm)** | `npm install mercadopago` |
| **SDK PHP (GitHub)** | [github.com/mercadopago/sdk-php](https://github.com/mercadopago/sdk-php) |
| **Status de servicios** | [status.mercadopago.com](https://status.mercadopago.com/) |
| **Soporte técnico** | [mercadopago.com.ar/developers/es/support](https://www.mercadopago.com.ar/developers/es/support/center) |
| **Comunidad Discord** | [discord.gg/yth5bMKhdn](https://discord.com/invite/yth5bMKhdn) |
| **MCP Server** | [mcp.mercadopago.com](https://mcp.mercadopago.com) |

---

## 2. Soluciones de pago — ¿Cuál elegir?

Mercado Pago ofrece dos caminos principales para pagos online:

### Checkout Pro (redirect)

El usuario es redirigido a una página de pago hosteada por Mercado Pago. **Ideal para empezar rápido.**

```
Tu servidor              Mercado Pago                  Usuario
    │                         │                           │
    ├─ POST /checkout/ ──────▶│                           │
    │    preferences           │                           │
    │◀── init_point ──────────┤                           │
    │                         │                           │
    ├─ redirige al ──────────────────────────────────────▶│
    │   init_point                                        │
    │                         │◀──── paga en MP ──────────┤
    │◀── webhook ─────────────┤                           │
    │                         │                           │
    │◀── redirect a back_url ─────────────────────────────┤
```

**Ventajas**: no manejás datos de tarjeta (PCI DSS lo cubre MP), diseño configurable, múltiples medios de pago.
**Desventajas**: el usuario sale de tu sitio.

### Checkout API / Checkout Transparente (embedded)

El formulario de pago se renderiza en tu sitio. **Control total del UX.**

```
Frontend (tu sitio)              Backend (tu server)           Mercado Pago
    │                                  │                           │
    ├─ renderiza Brick/CardForm ──────│                           │
    ├─ usuario ingresa tarjeta ───────│                           │
    ├─ genera CardToken ──────────────│                           │
    │                                  │                           │
    ├─ POST /process_payment ────────▶│                           │
    │  { token, amount, ... }         ├─ POST /v1/payments ──────▶│
    │                                  │◀── payment {status} ──────┤
    │◀── resultado ────────────────────┤                           │
```

**Ventajas**: experiencia 100% en tu sitio, control total del flujo.
**Desventajas**: necesitás PCI DSS compliance (MP lo simplifica con sus Bricks).

### ¿Cuál usar?

| Criterio | Checkout Pro | Checkout API |
|----------|-------------|--------------|
| Complejidad de integración | Baja | Media |
| Customización UX | Limitada | Total |
| PCI DSS | No te preocupás | Atendido por Bricks/SDK |
| Conversión | Alta (confianza MP) | Depende de tu UX |
| Tiempo de desarrollo | 2-4 horas | 1-3 días |

---

## 3. Credenciales — Lo primero

Creá tu aplicación en el [panel de desarrolladores](https://www.mercadopago.com.ar/developers/panel/app). Vas a obtener dos pares de credenciales:

| Entorno | Access Token | Propósito |
|---------|-------------|-----------|
| **Sandbox** (pruebas) | `TEST-XXXXXXXXXXXXXXXXXXXXXXXXXXXXX` | Desarrollo y testing |
| **Producción** | `APP_USR-XXXXXXXXXXXXXXXXXXXXXXXXXXX` | Transacciones reales |

> ⚠️ **Nunca** expongas el Access Token en frontend. Solo en tu servidor.
> En producción, rotalo periódicamente desde el panel.

---

## 4. Checkout Pro — Integración completa

### 4.1 Backend: Crear preferencia

**Paso 1**: Instalar SDK.

```bash
# Go
go get github.com/mercadopago/sdk-go

# Node.js
npm install mercadopago

# Python
pip install mercadopago

# PHP
composer require mercadopago/dx-php
```

**Paso 2**: Crear endpoint que genera la preferencia.

#### Go (SDK oficial)
```go
package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/mercadopago/sdk-go/pkg/config"
	"github.com/mercadopago/sdk-go/pkg/preference"
)

func createPreferenceHandler(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.New("APP_USR-1234567890123456-abcdef...")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	client := preference.NewClient(cfg)

	request := preference.Request{
		Items: []preference.ItemRequest{
			{
				Title:       "Mi producto",
				Quantity:    1,
				UnitPrice:   15000,
				CurrencyID:  "ARS",
			},
		},
		ExternalReference: "orden-123",
		NotificationURL:   "https://miapp.com/webhooks/mercadopago",
		BackURLs: &preference.BackURLsRequest{
			Success: "https://miapp.com/pago-exitoso",
			Failure: "https://miapp.com/pago-fallido",
			Pending: "https://miapp.com/pago-pendiente",
		},
		AutoReturn: "approved",
	}

	resource, err := client.Create(context.Background(), request)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// resource.InitPoint es la URL de pago
	fmt.Fprintf(w, `{"init_point": "%s"}`, resource.InitPoint)
}
```

#### Python
```python
import mercadopago

sdk = mercadopago.SDK("APP_USR-1234567890123456-abcdef...")

preference_data = {
    "items": [
        {
            "title": "Mi producto",
            "quantity": 1,
            "unit_price": 15000,
            "currency_id": "ARS"
        }
    ],
    "external_reference": "orden-123",
    "notification_url": "https://miapp.com/webhooks/mercadopago",
    "back_urls": {
        "success": "https://miapp.com/pago-exitoso",
        "failure": "https://miapp.com/pago-fallido",
        "pending": "https://miapp.com/pago-pendiente"
    },
    "auto_return": "approved"
}

preference_response = sdk.preference().create(preference_data)
preference = preference_response["response"]

print(preference["init_point"])  # URL de pago
```

#### Node.js
```javascript
const mercadopago = require("mercadopago");

mercadopago.configure({
  access_token: "APP_USR-1234567890123456-abcdef...",
});

app.post("/create-preference", async (req, res) => {
  const preference = {
    items: [
      {
        title: "Mi producto",
        quantity: 1,
        unit_price: 15000,
        currency_id: "ARS",
      },
    ],
    external_reference: "orden-123",
    notification_url: "https://miapp.com/webhooks/mercadopago",
    back_urls: {
      success: "https://miapp.com/pago-exitoso",
      failure: "https://miapp.com/pago-fallido",
      pending: "https://miapp.com/pago-pendiente",
    },
    auto_return: "approved",
  };

  const response = await mercadopago.preferences.create(preference);
  res.json({ init_point: response.body.init_point });
});
```

#### Sin SDK (HTTP directo — cualquier lenguaje)

```bash
curl -X POST 'https://api.mercadopago.com/checkout/preferences' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer APP_USR-XXXXXXXX' \
  -d '{
    "items": [{
        "title": "Mi producto",
        "quantity": 1,
        "unit_price": 15000,
        "currency_id": "ARS"
    }],
    "external_reference": "orden-123",
    "notification_url": "https://miapp.com/webhooks/mercadopago",
    "back_urls": {
        "success": "https://miapp.com/pago-exitoso",
        "failure": "https://miapp.com/pago-fallido",
        "pending": "https://miapp.com/pago-pendiente"
    },
    "auto_return": "approved"
}'
```

Respuesta:
```json
{
  "id": "123456789-abcdef...",
  "init_point": "https://www.mercadopago.com.ar/checkout/v1/redirect?...",
  "sandbox_init_point": "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?...",
  "date_created": "2025-01-15T10:30:00.000-03:00"
}
```

### 4.2 Frontend: Redirigir al pago

Opción A — Link simple:
```html
<a href="{{ init_point }}">Pagar con Mercado Pago</a>
```

Opción B — Wallet Brick (integración embebida):
```html
<script src="https://sdk.mercadopago.com/js/v2"></script>
<div id="walletBrick_container"></div>

<script>
  const mp = new MercadoPago("TEST-XXXXXXXX", { locale: "es-AR" });
  const bricksBuilder = mp.bricks();

  const renderWalletBrick = async () => {
    const settings = {
      initialization: {
        preferenceId: "{{ preference_id }}",
      },
      customization: {
        texts: {
          action: "pay",
          valueProp: "security_safety",
        },
      },
    };
    window.walletBrickController = await bricksBuilder.create(
      "wallet",
      "walletBrick_container",
      settings
    );
  };
  renderWalletBrick();
</script>
```

### 4.3 Campos clave de la preferencia

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `items[].title` | Sí | Nombre del producto/servicio |
| `items[].quantity` | Sí | Cantidad |
| `items[].unit_price` | Sí | Precio unitario |
| `items[].currency_id` | No (default: moneda de la cuenta) | `"ARS"`, `"BRL"`, etc. |
| `external_reference` | **Muy recomendado** | Tu ID interno para correlacionar pagos |
| `notification_url` | **Muy recomendado** | URL donde MP enviará webhooks |
| `back_urls.success` | Recomendado | URL post-pago exitoso |
| `back_urls.failure` | Recomendado | URL post-pago fallido |
| `back_urls.pending` | Recomendado | URL post-pago pendiente |
| `auto_return` | Recomendado | `"approved"` → redirige automático |
| `payer.email` | Recomendado | Pre-llena el email del comprador |
| `payer.name` | Opcional | Nombre del comprador |
| `payer.identification` | Opcional | DNI / CUIT / CPF |
| `expires` | Opcional | `true` para que expire |
| `date_of_expiration` | Opcional | ISO 8601 con timezone |
| `payment_methods.excluded_payment_types` | Opcional | Excluir medios de pago |
| `statement_descriptor` | Opcional | Texto en el resumen de tarjeta |

---

## 5. Webhooks — Recibir notificaciones

### 5.1 Tipos de notificación

MP puede notificar de dos formas:

1. **Webhook vía `notification_url`**: MP hace POST a tu endpoint por cada cambio de estado del pago.
2. **IPN (legacy)**: query params `?data.id=XXX&type=payment`.

### 5.2 Validación de firma (obligatorio en producción)

MP incluye el header `x-signature` con formato `ts={timestamp_ms},v1={hmac_hex}`.

#### Go
```go
func validateWebhookSignature(xSignature, xRequestID, dataID, secret string) error {
	parts := strings.Split(xSignature, ",")
	var ts, v1 string
	for _, p := range parts {
		kv := strings.SplitN(strings.TrimSpace(p), "=", 2)
		if len(kv) != 2 { continue }
		switch kv[0] {
		case "ts": ts = kv[1]
		case "v1": v1 = kv[1]
		}
	}
	if ts == "" || v1 == "" {
		return fmt.Errorf("x-signature mal formado")
	}

	manifest := fmt.Sprintf("id:%s;request-id:%s;ts:%s;", dataID, xRequestID, ts)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(manifest))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(v1)) {
		return fmt.Errorf("firma inválida")
	}
	return nil
}
```

#### JavaScript/Node.js
```javascript
const crypto = require("crypto");

function validateSignature(xSignature, xRequestId, dataID, secret) {
  const parts = xSignature.split(",");
  let ts, v1;
  parts.forEach((part) => {
    const [key, value] = part.split("=").map((s) => s.trim());
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  });
  if (!ts || !v1) throw new Error("x-signature mal formado");

  const manifest = `id:${dataID};request-id:${xRequestId};ts:${ts};`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(manifest);
  const expected = hmac.digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(v1)
  );
}
```

#### Python
```python
import hmac
import hashlib

def validate_signature(x_signature, x_request_id, data_id, secret):
    parts = dict(kv.split("=") for kv in x_signature.split(","))
    ts, v1 = parts.get("ts"), parts.get("v1")
    if not ts or not v1:
        raise ValueError("x-signature mal formado")

    manifest = f"id:{data_id};request-id:{x_request_id};ts:{ts};"
    expected = hmac.new(
        secret.encode(),
        manifest.encode(),
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(expected, v1)
```

### 5.3 Flujo completo del webhook

```
1. Recibir POST de MP con x-signature header
2. Validar firma HMAC-SHA256 (usando tu webhook secret)
3. Parsear body: {"action": "payment.updated", "data": {"id": 123456789}}
4. Consultar estado real a MP: GET /v1/payments/{data.id}
5. Verificar status == "approved"
6. Actualizar tu orden (external_reference → tu tracking ID interno)
7. Responder HTTP 200 a MP (siempre, incluso en error)
```

> ⚠️ **Respondé siempre HTTP 200**. MP reintenta el webhook si recibe 4xx/5xx.

### 5.4 Idempotencia

MP puede enviar el mismo webhook múltiples veces. Guardá `mp_payment_id` en tu DB y verificá antes de procesar:

```sql
INSERT INTO payment_events (mp_payment_id, raw_payload)
VALUES ($1, $2)
ON CONFLICT (mp_payment_id) DO NOTHING
```

---

## 6. Estados del pago

Después de recibir un webhook, **siempre** consultá el estado real con `GET /v1/payments/{id}`.

| Status | Significado | Acción |
|--------|-------------|--------|
| `approved` | Pago acreditado | ✅ Confirmar orden/servicio |
| `pending` | Esperando confirmación | ⏳ No hacer nada, esperar otro webhook |
| `in_process` | En revisión | ⏳ Esperar, típico de tarjetas |
| `rejected` | Rechazado | ❌ Notificar al usuario |
| `cancelled` | Cancelado | ❌ Liberar stock si corresponde |
| `refunded` | Devuelto | ↩️ Reversar la operación |
| `charged_back` | Contracargo | ⚠️ Disputa iniciada |

Campos adicionales relevantes de la respuesta:

```json
{
  "id": 123456789,
  "status": "approved",
  "status_detail": "accredited",
  "external_reference": "orden-123",
  "transaction_amount": 15000,
  "currency_id": "ARS",
  "payment_method_id": "visa",
  "payment_type_id": "credit_card",
  "installments": 1,
  "payer": {
    "email": "comprador@email.com",
    "identification": { "type": "DNI", "number": "12345678" }
  },
  "date_approved": "2025-01-15T10:35:00.000-03:00"
}
```

---

## 7. Checkout API / Transparente — Formulario embebido

### 7.1 CardForm (JavaScript — frontend)

```html
<script src="https://sdk.mercadopago.com/js/v2"></script>

<form id="form-checkout">
  <div id="form-checkout__cardNumber"></div>
  <div id="form-checkout__expirationDate"></div>
  <div id="form-checkout__securityCode"></div>
  <input type="text" id="form-checkout__cardholderName" placeholder="Titular" />
  <select id="form-checkout__issuer"></select>
  <select id="form-checkout__installments"></select>
  <select id="form-checkout__identificationType"></select>
  <input type="text" id="form-checkout__identificationNumber" placeholder="DNI" />
  <input type="email" id="form-checkout__cardholderEmail" placeholder="E-mail" />
  <button type="submit">Pagar</button>
</form>

<script>
  const mp = new MercadoPago("TEST-XXXXXXXX", { locale: "es-AR" });

  const cardForm = mp.cardForm({
    amount: "15000.00",
    iframe: true,
    form: {
      id: "form-checkout",
      cardNumber: { id: "form-checkout__cardNumber" },
      expirationDate: { id: "form-checkout__expirationDate" },
      securityCode: { id: "form-checkout__securityCode" },
      cardholderName: { id: "form-checkout__cardholderName" },
      issuer: { id: "form-checkout__issuer" },
      installments: { id: "form-checkout__installments" },
      identificationType: { id: "form-checkout__identificationType" },
      identificationNumber: { id: "form-checkout__identificationNumber" },
      cardholderEmail: { id: "form-checkout__cardholderEmail" },
    },
    callbacks: {
      onFormMounted: (error) => {
        if (error) console.error("Error montando formulario:", error);
      },
      onSubmit: (event) => {
        event.preventDefault();

        const {
          paymentMethodId, issuerId, cardholderEmail,
          amount, token, installments, identificationNumber, identificationType,
        } = cardForm.getCardFormData();

        fetch("/api/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            issuer_id: issuerId,
            payment_method_id: paymentMethodId,
            transaction_amount: Number(amount),
            installments: Number(installments),
            description: "Compra en Mi Tienda",
            payer: {
              email: cardholderEmail,
              identification: {
                type: identificationType,
                number: identificationNumber,
              },
            },
          }),
        })
        .then((r) => r.json())
        .then((data) => {
          if (data.status === "approved") {
            window.location.href = "/pago-exitoso";
          } else {
            alert("Pago rechazado: " + data.status_detail);
          }
        });
      },
    },
  });
</script>
```

### 7.2 Backend: Procesar el pago con token

#### Go
```go
cfg, _ := config.New("APP_USR-XXXXXXXX")
client := payment.NewClient(cfg)

request := payment.Request{
    TransactionAmount: 15000,
    Token:             "token_generado_en_frontend",
    Description:       "Compra en Mi Tienda",
    Installments:      1,
    PaymentMethodID:   "visa",
    Payer: &payment.PayerRequest{
        Email: "comprador@email.com",
        Identification: &payment.IdentificationRequest{
            Type:   "DNI",
            Number: "12345678",
        },
    },
}

resource, err := client.Create(context.Background(), request)
// resource.Status → "approved", "rejected", "pending", "in_process"
```

#### Node.js
```javascript
const payment = await mercadopago.payment.save({
  transaction_amount: 15000,
  token: req.body.token,
  description: "Compra en Mi Tienda",
  installments: 1,
  payment_method_id: req.body.payment_method_id,
  issuer_id: req.body.issuer_id,
  payer: {
    email: req.body.payer.email,
    identification: {
      type: req.body.payer.identification.type,
      number: req.body.payer.identification.number,
    },
  },
});
// payment.body.status → "approved"
```

---

## 8. QR de pago / Transferencia

Para generar un QR que el cliente pueda escanear desde su app bancaria:

### 8.1 QR de Mercado Pago (init_point)

El `init_point` de la preferencia ya contiene una URL de checkout. Podés convertirlo en QR:

```go
import qrcode "github.com/skip2/go-qrcode"

qrPNG, _ := qrcode.Encode(initPoint, qrcode.Medium, 256)
qrBase64 := base64.StdEncoding.EncodeToString(qrPNG)
```

### 8.2 QR de alias/CVU (Argentina)

Los alias de Mercado Pago son reconocidos por billeteras argentinas (Naranja X, Ualá, etc.). Al escanear un alias como QR, la app bancaria navega directo a la pantalla de transferencia.

```go
// Contenido del QR: simplemente el alias
qrContent := "miempresa.cobros"  // tu alias de MP

qrPNG, _ := qrcode.Encode(qrContent, qrcode.Medium, 256)
```

> Nota: el monto no se puede incluir en este QR — lo ingresa manualmente el cliente.

---

## 9. Configuración del SDK Go — completo

```
go get github.com/mercadopago/sdk-go
```

```go
package main

import (
	"context"
	"github.com/mercadopago/sdk-go/pkg/config"
	"github.com/mercadopago/sdk-go/pkg/preference"
	"github.com/mercadopago/sdk-go/pkg/payment"
	"github.com/mercadopago/sdk-go/pkg/paymentmethod"
	"github.com/mercadopago/sdk-go/pkg/order"
)

func main() {
	// 1. Configurar con access token (prod) o test token (sandbox)
	cfg, err := config.New("APP_USR-XXXXXXXX")
	if err != nil { panic(err) }

	// 2. Listar medios de pago disponibles
	pmClient := paymentmethod.NewClient(cfg)
	paymentMethods, err := pmClient.List(context.Background())

	// 3. Crear preferencia de pago (Checkout Pro)
	prefClient := preference.NewClient(cfg)
	pref, err := prefClient.Create(context.Background(), preference.Request{...})

	// 4. Crear pago directo (Checkout API)
	payClient := payment.NewClient(cfg)
	pay, err := payClient.Create(context.Background(), payment.Request{...})

	// 5. Consultar un pago existente
	payInfo, err := payClient.Get(context.Background(), 123456789)

	// 6. Crear orden (Checkout API con órdenes)
	orderClient := order.NewClient(cfg)
	ord, err := orderClient.Create(context.Background(), order.Request{...})
}
```

---

## 10. Seguridad — Checklist para producción

- [ ] Access Token de producción **nunca** en código fuente ni repositorio
- [ ] Access Token se almacena en variable de entorno o secret manager
- [ ] Webhook secret configurado en el panel de MP
- [ ] Validación de firma HMAC-SHA256 en el endpoint de webhook
- [ ] Idempotencia de webhooks (db insert con `ON CONFLICT`)
- [ ] HTTPS en **todas** las URLs (back_urls, notification_url)
- [ ] Respuesta HTTP 200 en webhook aunque falle (evitar reintentos infinitos)
- [ ] Rotación periódica de credenciales
- [ ] Logging de eventos de pago para auditoría (sin datos sensibles de tarjeta)
- [ ] Sandbox testing antes de pasar a producción
- [ ] Certificado SSL válido en el dominio de notificación

### Variables de entorno recomendadas

```bash
# Producción
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxxxxxxxxxxxx
MP_WEBHOOK_SECRET=tu_webhook_secret_del_panel
MP_NOTIFICATION_URL=https://miapp.com/api/webhooks/mercadopago

# Sandbox (testing)
MP_ACCESS_TOKEN=TEST-xxxxxxxxxxxxxxxxxxxxxxx
MP_WEBHOOK_SECRET=
MP_SKIP_SIGNATURE=true  # Solo en dev, saltar validación de firma
```

---

## 11. Sandbox — Cómo probar

### 11.1 Tarjetas de prueba (Argentina)

| Tipo | Marca | Número | CVV | Vencimiento |
|------|-------|--------|-----|-------------|
| Crédito | Mastercard | `5031 7557 3453 0604` | 123 | 11/30 |
| Crédito | Visa | `4509 9535 6623 3704` | 123 | 11/30 |
| Crédito | American Express | `3711 803032 57522` | 1234 | 11/30 |
| Débito | Mastercard | `5287 3383 1025 3304` | 123 | 11/30 |
| Débito | Visa | `4002 7686 9439 5619` | 123 | 11/30 |

### 11.2 Simular resultados con cardholder name

En Sandbox, el nombre del titular controla el resultado de la transacción:

| Resultado | Nombre en el formulario | Documento |
|-----------|------------------------|-----------|
| ✅ Aprobado | `APRO` | DNI 12345678 |
| ❌ Rechazado (error general) | `OTHE` | DNI 12345678 |
| ⏳ Pendiente | `CONT` | — |
| 📞 Requiere contacto | `CALL` | — |
| 💰 Fondos insuficientes | `FUND` | — |
| 🔒 Código seguridad inválido | `SECU` | — |
| 📅 Tarjeta vencida | `EXPI` | — |

### 11.3 Usuarios de prueba

| Tipo | Usuario | Password |
|------|---------|----------|
| Comprador | TESTUSER123456 | qatest123 |
| Vendedor | TESTUSER789012 | qatest456 |

> Creá usuarios de prueba desde el panel: [mercadopago.com.ar/developers/panel/test-users](https://www.mercadopago.com.ar/developers/panel/test-users)

### 11.4 Webhooks en Sandbox

MP no envía webhooks reales desde Sandbox. Para probar, simulá la notificación:

```bash
# Notificación que enviaría MP
curl -X POST https://miapp.com/api/webhooks/mercadopago \
  -H "Content-Type: application/json" \
  -d '{"action":"payment.updated","data":{"id":"123456789"}}'
```

O usá servicios como [webhook.site](https://webhook.site) para ver las notificaciones que MP intenta enviar.

---

## 12. Errores comunes y soluciones

| Error | Causa | Solución |
|-------|-------|----------|
| `401 Unauthorized` | Token inválido o expirado | Verificar access token en [panel](https://www.mercadopago.com.ar/developers/panel/app) |
| `400 Bad Request` | Campos faltantes o inválidos | Revisar el body contra la [API reference](https://www.mercadopago.com.ar/developers/es/reference) |
| `invalid installments` | Cuotas no disponibles para ese método | Listar cuotas con `GET /v1/payment_methods/installments` |
| Webhook no llega | `notification_url` no es HTTPS o no responde 200 | Verificar con [webhook.site](https://webhook.site) |
| Firma inválida | Webhook secret incorrecto o manifest mal construido | Verificar formato: `id:{dataID};request-id:{xRequestID};ts:{ts};` |
| `cc_rejected_insufficient_amount` | Tarjeta sin fondos | Rechazo legítimo — mostrar mensaje al usuario |
| `cc_rejected_other_reason` | Rechazo genérico del banco | Sugerir reintentar con otro medio de pago |
| `pending_contingency` | Pago en revisión por contingencia | No cancelar — MP lo resuelve en ~48hs |

---

## 13. Referencia rápida de endpoints

### Checkout Pro (Preferences)
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/checkout/preferences` | Crear preferencia |
| GET | `/checkout/preferences/{id}` | Consultar preferencia |
| PUT | `/checkout/preferences/{id}` | Actualizar preferencia |

### Payments
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/v1/payments` | Crear pago directo |
| GET | `/v1/payments/{id}` | Consultar pago |
| GET | `/v1/payments/search` | Buscar pagos |
| PUT | `/v1/payments/{id}` | Actualizar pago (cancelar) |
| POST | `/v1/payments/{id}/refunds` | Reembolsar pago |

### Otros
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/v1/payment_methods` | Listar medios de pago |
| GET | `/v1/payment_methods/installments` | Listar planes de cuotas |
| POST | `/v1/customers` | Crear cliente |
| GET | `/v1/customers/{id}/cards` | Listar tarjetas guardadas |
| POST | `/v1/card_tokens` | Tokenizar tarjeta |
| GET | `/v1/identification_types` | Tipos de documento por país |

---

## 14. Ejemplos reales en GitHub

| Repo | Stack | Lo que cubre |
|------|-------|-------------|
| [goncy/next-mercadopago](https://github.com/goncy/next-mercadopago) ⭐662 | Next.js + TypeScript | Checkout Pro, suscripciones, Bricks, Marketplace/Split, Checkout API, webhooks |
| [HarrysonLadines/mercadopago-checkoutpro](https://github.com/HarrysonLadines/mercadopago-checkoutpro) | Express + TypeScript | Checkout Pro, validación HMAC x-signature, flujo completo |
| [Victor-Lis/Mercado-Pago-API](https://github.com/Victor-Lis/Mercado-Pago-API) | Node.js + Fastify + TS | Arquitectura completa, webhooks, Swagger, Docker, Ngrok |
| [danielaregert/...mercadopago-api](https://github.com/danielaregert/claude-skill-mercadopago-api) | Go | Skill Claude Code con HMAC validation, tabla status/status_detail, tarjetas test AR |
| [mercadolibre/demo-mercadopago-mcp-server](https://github.com/mercadolibre/demo-mercadopago-mcp-server) | Node.js + MCP | Demo oficial del MCP Server |

---

## 15. MCP Server — Herramientas para AI Agents

Mercado Pago tiene un **MCP Server oficial** que expone herramientas para AI agents (Claude, Cursor, VS Code, Windsurf, ChatGPT).

| Documento | URL |
|-----------|-----|
| Overview | [mercadopago.com.ar/developers/en/docs/mcp-server/overview](https://www.mercadopago.com.ar/developers/en/docs/mcp-server/overview) |
| Conexión (IDE, Claude, OpenAI) | Docs → Checkout API → MCP Server |

**Tools disponibles**:
- `search_documentation` — buscar en docs oficiales desde el agente
- `get_application`, `create_application`, `get_credentials` — gestionar apps y credenciales
- Configurar y monitorear Webhooks
- Crear test users
- Medir calidad de integración

Ideal para acelerar el desarrollo — el agente puede consultar docs actualizadas sin salir del IDE.

---

## 16. Recursos adicionales

- [Guía de primeros pasos (MP oficial)](https://www.mercadopago.com.ar/developers/es/docs/getting-started)
- [MCP Server de Mercado Pago](https://mcp.mercadopago.com) — Integración asistida por IA
- [Bricks — Componentes UI](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/landing)
- [Referencia de API completa](https://www.mercadopago.com.ar/developers/es/reference)
- [Changelog de API](https://www.mercadopago.com.ar/developers/es/changelog)
- [PCI DSS Compliance con MP](https://www.mercadopago.com.ar/developers/es/docs/security/pci)
- [Políticas de seguridad](https://www.mercadopago.com.ar/developers/es/docs/security)
