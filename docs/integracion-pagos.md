# Integración de Pagos — LogiTrack

> Referencia técnica de la integración de pagos con Mercado Pago, efectivo y transferencia bancaria.
> Idioma: Go (backend) + TypeScript/React (frontend). Base de datos: PostgreSQL.

---

## 1. Arquitectura general

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Frontend    │────▶│  Backend (Go)   │────▶│  Mercado Pago    │
│  React/TS    │     │  Gin + ES       │     │  API externa     │
└──────────────┘     └────────┬────────┘     └────────┬─────────┘
                              │                        │
                              ▼                        ▼
                     ┌────────────────┐    ┌──────────────────────┐
                     │  PostgreSQL    │    │  Webhook entrante    │
                     │  payments      │    │  POST /webhooks/     │
                     │  payment_events│    │  mercadopago         │
                     │  payment_config│    └──────────────────────┘
                     └────────────────┘
```

Tres métodos de pago convergen en el mismo flujo de confirmación. La diferencia está en **cómo se dispara** la confirmación:

| Método | Disparador | `mp_payment_id` | `ChangedBy` |
|--------|-----------|----------------|-------------|
| Mercado Pago | Webhook `POST /webhooks/mercadopago` | ID real de MP | `"mercadopago"` |
| Efectivo | `POST /shipments/:id/cash-payment` | `EFECTIVO-{uuid[:8]}` | username del operador |
| Transferencia | `POST /shipments/:id/transfer-payment` | `MOCK-{uuid[:8]}` | username del operador |

---

## 2. Modelo de datos

### 2.1 `model.Payment`

```go
// internal/model/payment.go
type PaymentStatus string

const (
    PaymentStatusPending   PaymentStatus = "pending"
    PaymentStatusApproved  PaymentStatus = "approved"
    PaymentStatusAbandoned PaymentStatus = "abandoned"
)

type Payment struct {
    ID              string        `json:"id"`
    TrackingID      string        `json:"tracking_id"`               // DRAFT-XXX → LT-XXX
    MPPreferenceID  string        `json:"mp_preference_id"`
    MPPaymentID     *string       `json:"mp_payment_id,omitempty"`
    InitPoint       string        `json:"init_point"`                // URL checkout MP (vacío en mock)
    Amount          float64       `json:"amount"`
    Currency        string        `json:"currency"`
    Status          PaymentStatus `json:"status"`
    CreatedAt       time.Time     `json:"created_at"`
    ApprovedAt      *time.Time    `json:"approved_at,omitempty"`
    AbandonedAt     *time.Time    `json:"abandoned_at,omitempty"`
    AbandonedReason string        `json:"abandoned_reason,omitempty"`
}
```

**Máquina de estados**:
```
pending ──▶ approved  (webhook / cash / transfer)
pending ──▶ abandoned (back_to_draft / expiry 24h)
```

### 2.2 `model.PaymentConfig`

```go
// internal/model/payment_config.go
type PaymentConfig struct {
    MPEnabled        bool   `json:"mp_enabled"`
    MockEnabled      bool   `json:"mock_enabled"`
    MPAlias          string `json:"mp_alias"`
    MPCVU            string `json:"mp_cvu"`
    MPAccessToken    string `json:"mp_access_token"`    // AES-256 encriptado
    MPWebhookSecret  string `json:"mp_webhook_secret"`  // AES-256 encriptado
}
```

Tabla singleton `payment_config` (id=1). Las credenciales se encriptan con AES-256-GCM usando `PAYMENT_SECRET_KEY` como clave.

### 2.3 `model.Shipment` — campos de precio

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `price` | `*float64` | Total cobrado. `null` en borradores. |
| `price_breakdown` | `*PriceBreakdown` | Desglose por componente. |
| `price_currency` | `string` | Default `"ARS"`. |

El precio se calcula una sola vez (en `RequestPayment`) y nunca se recalcula. Los campos que afectan el precio (`weight_kg`, `package_type`, `is_fragile`, `shipment_type`) quedan lockeados post-confirmación.

### 2.4 Eventos de dominio

| Evento | Disparador | Efecto en proyección |
|--------|-----------|---------------------|
| `EventPaymentRequested` | `RequestPayment` | status → `pending_payment` |
| `EventPaymentConfirmed` | Webhook / Cash / Transfer | tracking_id DRAFT→LT, status → `at_origin_hub`, ML priority |
| `EventReturnedToDraft` | `BackToDraft` / Expiry | status → `draft` |

---

## 3. Tablas de base de datos

### 3.1 `payments`

```sql
CREATE TABLE payments (
    id                  TEXT PRIMARY KEY,
    tracking_id         TEXT NOT NULL,
    original_tracking_id TEXT,
    mp_preference_id    TEXT NOT NULL UNIQUE,
    mp_payment_id       TEXT UNIQUE,
    init_point          TEXT NOT NULL,
    amount              NUMERIC(12,2) NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'ARS',
    status              TEXT NOT NULL,  -- pending | approved | abandoned
    created_at          TIMESTAMPTZ NOT NULL,
    approved_at         TIMESTAMPTZ,
    abandoned_at        TIMESTAMPTZ,
    abandoned_reason    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_payments_tracking_id ON payments(tracking_id);
CREATE INDEX idx_payments_status_created_at ON payments(status, created_at);
```

- `original_tracking_id` preserva el `DRAFT-XXX` original después de que `tracking_id` cambia a `LT-XXX`.
- `mp_preference_id` es UNIQUE — un borrador solo puede tener un pago activo a la vez.

### 3.2 `payment_events` — Idempotencia de webhooks

```sql
CREATE TABLE payment_events (
    mp_payment_id TEXT PRIMARY KEY,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_payload   JSONB NOT NULL
);
```

Previene procesar dos veces el mismo `mp_payment_id`. Usa `INSERT ... ON CONFLICT (mp_payment_id) DO NOTHING`.

### 3.3 `payment_config`

```sql
CREATE TABLE payment_config (
    id                INTEGER PRIMARY KEY DEFAULT 1,
    mp_enabled        BOOLEAN NOT NULL DEFAULT true,
    mock_enabled      BOOLEAN NOT NULL DEFAULT false,
    mp_alias          TEXT NOT NULL DEFAULT '',
    mp_cvu            TEXT NOT NULL DEFAULT '',
    mp_access_token   TEXT NOT NULL DEFAULT '',
    mp_webhook_secret TEXT NOT NULL DEFAULT ''
);
```

Singleton — siempre hay exactamente una fila con `id=1`.

---

## 4. Cliente Mercado Pago (`internal/mercadopago/`)

### 4.1 `client.go` — HTTP Client

```go
const baseURL = "https://api.mercadopago.com"

type CredentialProvider func() (accessToken, webhookSecret string)

type Client struct {
    staticAccessToken   string           // fallback: env var MP_ACCESS_TOKEN
    staticWebhookSecret string           // fallback: env var MP_WEBHOOK_SECRET
    notificationURL     string           // env var MP_NOTIFICATION_URL
    http                *http.Client     // timeout: 15s
    provider            CredentialProvider // DB credentials (preceden sobre env vars)
}
```

**Resolución de credenciales** (prioridad):
1. `CredentialProvider` (DB → `PaymentConfigService.GetMPCredentials`)
2. Variables de entorno (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`)

**`IsConfigured()`**: `true` si hay access token de cualquier fuente. Si `false`, el sistema opera en modo mock exclusivamente.

**Wiring en `main.go`**:
```go
mpClient := mercadopago.NewClient(
    os.Getenv("MP_ACCESS_TOKEN"),
    os.Getenv("MP_WEBHOOK_SECRET"),
    os.Getenv("MP_NOTIFICATION_URL"),
)
mpClient.SetCredentialProvider(paymentConfigSvc.GetMPCredentials)
```

### 4.2 `preferences.go` — Crear checkout

```go
func (c *Client) CreatePreference(trackingID string, amount float64, currency string) (CreatePreferenceResponse, error)
```

`POST /checkout/preferences`:
```json
{
    "items": [{
        "title": "Envío LogiTrack DRAFT-A1B2C3D4",
        "quantity": 1,
        "unit_price": 15000.00,
        "currency_id": "ARS"
    }],
    "external_reference": "DRAFT-A1B2C3D4",
    "notification_url": "https://logitrack.com.ar/api/v1/webhooks/mercadopago"
}
```

**`external_reference`**: tracking ID del borrador. Es el valor que MP devuelve en el webhook para correlacionar el pago con el envío.

**`notification_url`**: endpoint público donde MP notifica cambios de estado.

Respuesta:
```go
type CreatePreferenceResponse struct {
    ID               string `json:"id"`
    InitPoint        string `json:"init_point"`
    SandboxInitPoint string `json:"sandbox_init_point"`
}
```

### 4.3 `payments.go` — Consultar estado

```go
func (c *Client) GetPayment(mpPaymentID string) (MPPayment, error)
```

`GET /v1/payments/{id}` → verifica que el pago fue realmente aprobado (no se confía ciegamente en el webhook).

```go
type MPPayment struct {
    ID                 int64   `json:"id"`
    Status             string  `json:"status"`              // "approved", "pending", "rejected"...
    ExternalReference  string  `json:"external_reference"`  // = DRAFT tracking ID
    TransactionAmount  float64 `json:"transaction_amount"`
    CurrencyID         string  `json:"currency_id"`
}
```

### 4.4 `webhook.go` — Validar firma

```go
func (c *Client) ValidateSignature(xSignature, xRequestID, dataID string) error
```

**Formato del header `x-signature`**: `ts={timestamp},v1={hex-hmac}`

**Algoritmo de validación**:
1. Extrae `ts` y `v1` del header
2. Construye el manifest: `id:{dataID};request-id:{xRequestID};ts:{ts};`
3. Calcula `HMAC-SHA256(manifest, webhookSecret)`
4. Compara con `v1` usando `hmac.Equal` (timing-safe)

**Skip en desarrollo**: `MP_SKIP_SIGNATURE=true` → saltea validación.

---

## 5. Servicio de Pagos (`internal/service/payment.go`)

### 5.1 `RequestPayment` — Iniciar flujo de pago

```
POST /api/v1/shipments/:tracking_id/request-payment
```

**Flujo**:
1. Obtiene el draft → valida `status == "draft"`
2. Valida campos (mismas reglas que `ConfirmDraft`)
3. Sella precio: si no tiene, lo calcula con `PricingService`
4. Sella prioridad ML con `MLClient.PredictFromShipment()`
5. Si `MP_ENABLED=true` **y** token configurado (`IsConfigured()`):
   - Crea preferencia real en MP → `init_point` ≠ `""`
   - Sino: crea mock → `preferenceID = "MOCK-{uuid[:8]}"`, `init_point = ""`
6. `INSERT INTO payments` (status = `"pending"`)
7. `repo.RequestPayment()` → `EventPaymentRequested` → status = `"pending_payment"`

### 5.2 `HandleWebhook` — Procesar notificación MP

```
POST /api/v1/webhooks/mercadopago  (público, sin auth)
```

**Flujo idempotente**:
1. `INSERT INTO payment_events` → si ya existe (`ON CONFLICT DO NOTHING`), retorna sin error
2. `GET /v1/payments/{mpPaymentID}` a MP → verifica `status == "approved"`
3. Busca payment activo por `external_reference` (= tracking ID del draft)
4. Verifica que el shipment siga en `"pending_payment"`
5. Genera nuevo tracking ID `LT-XXXXXXXX`
6. `repo.ConfirmPayment()` → `EventPaymentConfirmed`:
   - tracking_id cambia de `DRAFT-XXX` a `LT-XXX`
   - status → `"at_origin_hub"`
7. Marca payment como `"approved"`
8. **Auto-transición**: si `origin_branch_id == final_branch_id` → status → `"at_hub"` (saltea la pata inter-sucursal)
9. Dispara emails de confirmación (`sendConfirmationEmails`)

**⚠️ El webhook siempre retorna HTTP 200**, incluso en error. MP reintentaría indefinidamente con otro código de estado.

### 5.3 `ConfirmCashPayment` — Pago en efectivo

```
POST /api/v1/shipments/:tracking_id/cash-payment
```

Mismo flujo que `HandleWebhook` pero:
- `mpPaymentID = "EFECTIVO-{uuid[:8]}"`
- `ChangedBy = username` del operador
- No consulta a MP

### 5.4 `ConfirmMockPayment` — Transferencia bancaria

```
POST /api/v1/shipments/:tracking_id/transfer-payment
```

Idéntico a `ConfirmCashPayment` pero con prefijo `"MOCK-"`.

### 5.5 `BackToDraft` — Abandonar pago

```
POST /api/v1/shipments/:tracking_id/back-to-draft
```

1. Verifica `status == "pending_payment"`
2. `paymentRepo.MarkAbandoned("back_to_draft")`
3. `repo.RevertToDraft()` → `EventReturnedToDraft` → status = `"draft"`

### 5.6 `ExpirePending` — Expiración automática

Ejecutado por `PaymentScheduler` cada 15 minutos. Revierte a `draft` todo pago `"pending"` con más de 24 horas de antigüedad.

```go
// internal/service/payment_scheduler.go
func (s *PaymentScheduler) Start() {
    go func() {
        for range time.Tick(15 * time.Minute) {
            cutoff := time.Now().UTC().Add(-24 * time.Hour)
            s.svc.ExpirePending(cutoff)
        }
    }()
}
```

---

## 6. Handler HTTP (`internal/handler/payment.go`)

### 6.1 Rutas

| Método | Ruta | Middleware | Handler |
|--------|------|-----------|---------|
| POST | `/api/v1/webhooks/mercadopago` | público | `Webhook` |
| POST | `/api/v1/shipments/:id/request-payment` | shipmentWrite | `RequestPayment` |
| POST | `/api/v1/shipments/:id/back-to-draft` | shipmentWrite | `BackToDraft` |
| GET | `/api/v1/shipments/:id/payment` | shipmentDetailRead | `GetPayment` |
| GET | `/api/v1/shipments/:id/payment/qr` | shipmentDetailRead | `GeneratePaymentQR` |
| POST | `/api/v1/shipments/:id/cash-payment` | shipmentWrite | `ConfirmCashPayment` |
| POST | `/api/v1/shipments/:id/transfer-payment` | shipmentWrite | `ConfirmTransferPayment` |
| GET | `/api/v1/payment/config` | authenticated | `Get` (masked) |
| PATCH | `/api/v1/payment/config` | adminOnly | `Update` |
| PATCH | `/api/v1/payment/config/credentials` | adminOnly | `UpdateCredentials` |

### 6.2 Webhook — Parsing del body

MP puede mandar notificaciones en dos formatos:

**Formato estándar** (JSON body):
```json
{"action": "payment.updated", "data": {"id": 123456789}}
```

**Formato IPN legacy** (query params):
```
?data.id=123456789&type=payment
?id=123456789&topic=payment
```

El handler soporta ambos. Además `data.id` puede venir como número (pagos reales) o string (notificaciones de prueba), por eso usa `json.RawMessage` + normalización:

```go
type webhookBody struct {
    Action string `json:"action"`
    Data   struct {
        ID json.RawMessage `json:"id"`
    } `json:"data"`
}

func (wb webhookBody) dataID() string {
    raw := string(wb.Data.ID)
    if len(raw) == 0 { return "" }
    if raw[0] == '"' {
        var s string
        json.Unmarshal(wb.Data.ID, &s)
        return s
    }
    return raw
}
```

### 6.3 QR de pago

`GET /api/v1/shipments/:id/payment/qr` genera un QR code PNG (256×256, base64).

**Contenido del QR** (prioridad):
1. `mp_alias` de la config (ej: `"logitrack.cobros"`)
2. `mp_cvu` de la config
3. `init_point` de Mercado Pago (fallback)

Los alias son reconocidos por billeteras argentinas (Mercado Pago, Naranja X, Ualá) y navegan directo a la pantalla de transferencia.

---

## 7. Configuración segura (`internal/service/payment_config.go`)

### 7.1 Encriptación AES-256

`internal/repository/postgres_payment_config.go` encripta `mp_access_token` y `mp_webhook_secret` con AES-256-GCM antes de persistir. La clave viene de `PAYMENT_SECRET_KEY` (variable de entorno).

### 7.2 Rotación de credenciales

```go
func UpdateCredentials(currentToken, newToken, currentSecret, newSecret string) (PaymentConfig, error)
```

- Si el token almacenado no está vacío, **requiere** que `currentToken` coincida exactamente.
- Misma verificación para `currentSecret`.
- Esto evita sobrescrituras accidentales.

### 7.3 Respuesta enmascarada

`GET /payment/config` retorna credenciales ofuscadas:
```json
{
    "mp_access_token": "••••••••abcd",
    "mp_webhook_secret": "••••••••wxyz"
}
```

Los campos no sensibles (`mp_enabled`, `mock_enabled`, `mp_alias`, `mp_cvu`) se retornan en claro.

---

## 8. Repositorio (`internal/repository/`)

### 8.1 `PaymentRepository` (interfaz)

```go
// internal/repository/payment.go
type PaymentRepository interface {
    Create(p model.Payment) error
    GetByTrackingID(trackingID string) (model.Payment, error)
    GetActiveByTrackingID(trackingID string) (model.Payment, error)
    MarkApproved(paymentID, mpPaymentID, newTrackingID string, ts time.Time) error
    MarkAbandoned(paymentID, reason string, ts time.Time) error
    UpdateTrackingID(oldTrackingID, newTrackingID string) error
    ListExpired(cutoff time.Time) ([]model.Payment, error)
    RecordWebhookEvent(mpPaymentID string, rawPayload []byte) (bool, error)
}
```

### 8.2 `postgresPaymentRepository` — Implementación PostgreSQL

Archivo: `internal/repository/payment_pg.go`

**`RecordWebhookEvent` — Idempotencia**:
```go
func (r *postgresPaymentRepository) RecordWebhookEvent(mpPaymentID string, rawPayload []byte) (bool, error) {
    res, err := r.db.Exec(`
        INSERT INTO payment_events (mp_payment_id, raw_payload)
        VALUES ($1, $2)
        ON CONFLICT (mp_payment_id) DO NOTHING`,
        mpPaymentID, rawPayload,
    )
    n, _ := res.RowsAffected()
    return n > 0, nil  // true = primera vez, false = ya procesado
}
```

### 8.3 `PaymentConfigRepository`

```go
type PaymentConfigRepository interface {
    Get() model.PaymentConfig
    Update(cfg model.PaymentConfig) error
}
```

Implementación en `internal/repository/postgres_payment_config.go` con encriptación/desencriptación AES-256 transparente.

---

## 9. Frontend

### 9.1 Clientes API

| Archivo | Endpoints |
|---------|-----------|
| `src/api/payments.ts` | `requestPayment`, `backToDraft`, `get`, `confirmCashPayment`, `confirmTransferPayment`, `getQR`, `getConfig`, `updateConfig`, `updateCredentials` |
| `src/api/pricing.ts` | `quote`, `getConfig`, `updateConfig` |
| `src/api/shipments.ts` | Tipo `PriceBreakdown`, campo `price` en `Shipment` |

### 9.2 Componentes

| Componente | Rol |
|-----------|-----|
| `PaymentMethodsPanel.tsx` | Panel con 3 métodos de pago (MP link, MP QR, efectivo, transferencia) + modales de confirmación |
| `ShipmentQRModal.tsx` | Modal de QR con variante `"payment"` |
| `PriceCard.tsx` | Card de precio con desglose expandible |
| `StatusBadge.tsx` | Badge `pending_payment` → "Pago pendiente" (ámbar) |

### 9.3 Páginas

| Página | Ruta | Rol |
|--------|------|-----|
| `NewShipment.tsx` | `/new` | Cotización en vivo (debounce 400ms) + `PaymentPollModal` |
| `ShipmentDetail.tsx` | `/shipments/:id` | `PriceCard` + `PaymentMethodsPanel` |
| `PaymentConfig.tsx` | `/payment-config` | Admin: toggles, QR type, credenciales |
| `PricingConfig.tsx` | `/pricing-config` | Admin: 9 parámetros de pricing |
| `FacturacionTab.tsx` | `/dashboard` | KPIs de facturación, tabla por sucursal |

### 9.4 Flujo de usuario

```
1. Operador llena formulario → ve cotización en vivo (debounce 400ms)
2. Click "Continuar al pago" → POST /shipments/:id/request-payment
3. Panel de pago:
   ├─ Mercado Pago: link copiable + QR
   ├─ Efectivo: modal → POST /shipments/:id/cash-payment
   └─ Transferencia: alias/CBU + confirmación → POST /shipments/:id/transfer-payment
4. Polling: PaymentPollModal consulta GET /shipments/:id/payment hasta detectar "approved"
5. Redirección al shipment confirmado (LT-XXXX)
```

---

## 10. Flujo end-to-end (Mercado Pago real)

```
Operador                  Backend                         MercadoPago
   │                        │                                  │
   ├─ llena formulario ────▶│                                  │
   │                        ├─ pricingApi.quote() (debounce)   │
   │◀── cotización en vivo──┤                                  │
   │                        │                                  │
   ├─ "Continuar al pago" ─▶│                                  │
   │                        ├─ valida draft                    │
   │                        ├─ sella precio + ML priority      │
   │                        ├─ POST /checkout/preferences ────▶│
   │                        │◀──── preference {id, init_point}─┤
   │                        ├─ INSERT payments (pending)       │
   │                        ├─ EventPaymentRequested           │
   │◀── init_point + QR ────┤                                  │
   │                        │                                  │
   │  [cliente paga en MP] ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│
   │                        │                                  │
   │                        │◀─── POST /webhooks/mercadopago ──┤
   │                        ├─ valida firma HMAC-SHA256        │
   │                        ├─ INSERT payment_events (idemp)   │
   │                        ├─ GET /v1/payments/{id} ─────────▶│
   │                        │◀──── {status: "approved"} ───────┤
   │                        ├─ EventPaymentConfirmed            │
   │                        ├─ DRAFT-XXX → LT-XXX              │
   │                        ├─ status → at_origin_hub          │
   │                        ├─ MarkApproved(payment)           │
   │◀── polling detecta ────┤                                  │
   │    payment.status=approved                                │
   │                        │                                  │
   ├─ redirige a LT-XXXX ──▶│                                  │
```

---

## 11. Variables de entorno

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `MP_ACCESS_TOKEN` | Solo en producción | Token de acceso MP (fallback si DB no tiene) |
| `MP_WEBHOOK_SECRET` | Solo en producción | Secreto para validar firma de webhooks |
| `MP_NOTIFICATION_URL` | Solo en producción | URL pública del endpoint de webhook |
| `MP_SKIP_SIGNATURE` | No (dev) | `"true"` para saltear validación de firma |
| `MP_ENABLED` | No (dev) | `"true"` para crear preferencias reales en MP |
| `PAYMENT_SECRET_KEY` | Sí | Clave AES-256 para encriptar credenciales en DB |

---

## 12. Archivos del módulo

### Backend (`logitrack_core/`)

| Archivo | Rol |
|---------|-----|
| `internal/model/payment.go` | Struct `Payment`, estados |
| `internal/model/payment_config.go` | Struct `PaymentConfig`, defaults |
| `internal/model/pricing.go` | `PricingConfig`, `PriceBreakdown`, helpers |
| `internal/model/domain_event.go` | `EventPaymentRequested`, `EventPaymentConfirmed`, `EventReturnedToDraft` |
| `internal/mercadopago/client.go` | HTTP client MP, `CredentialProvider` |
| `internal/mercadopago/preferences.go` | `CreatePreference` |
| `internal/mercadopago/payments.go` | `GetPayment` |
| `internal/mercadopago/webhook.go` | `ValidateSignature` HMAC-SHA256 |
| `internal/service/payment.go` | `PaymentService`: `RequestPayment`, `HandleWebhook`, `BackToDraft`, `ExpirePending` |
| `internal/service/payment_simulate.go` | `ConfirmCashPayment`, `ConfirmMockPayment` |
| `internal/service/payment_scheduler.go` | `PaymentScheduler` (cada 15 min) |
| `internal/service/payment_config.go` | `PaymentConfigService`: CRUD + rotación segura |
| `internal/service/pricing.go` | `PricingService`: `Quote`, `UpdateConfig` |
| `internal/handler/payment.go` | `PaymentHandler`: 10 endpoints |
| `internal/handler/payment_config.go` | `PaymentConfigHandler` |
| `internal/handler/pricing.go` | `PricingHandler` |
| `internal/repository/payment.go` | `PaymentRepository` interfaz |
| `internal/repository/payment_pg.go` | `postgresPaymentRepository` |
| `internal/repository/payment_config.go` | `PaymentConfigRepository` interfaz |
| `internal/repository/postgres_payment_config.go` | Implementación con AES-256 |
| `internal/repository/pricing_config.go` | `PricingConfigRepository` |
| `internal/repository/shipment_es.go` | `RequestPayment`, `ConfirmPayment`, `RevertToDraft` en event store |
| `internal/projection/postgres_shipment.go` | Procesa eventos de pago en la proyección |
| `internal/db/migrate.go` | Tablas `payments`, `payment_events`, `payment_config` |
| `cmd/server/main.go` | Wiring: servicios, handlers, rutas, middleware |

### Frontend (`logitrack_web/`)

| Archivo | Rol |
|---------|-----|
| `src/api/payments.ts` | Cliente HTTP para pagos |
| `src/api/pricing.ts` | Cliente HTTP para pricing |
| `src/components/PaymentMethodsPanel.tsx` | Panel de métodos de pago |
| `src/components/ShipmentQRModal.tsx` | Modal QR (variante payment) |
| `src/components/PriceCard.tsx` | Card de precio con desglose |
| `src/components/StatusBadge.tsx` | Badge "Pago pendiente" |
| `src/pages/NewShipment.tsx` | Cotización en vivo + polling |
| `src/pages/ShipmentDetail.tsx` | PriceCard + PaymentMethodsPanel |
| `src/pages/PaymentConfig.tsx` | Admin: config de pagos |
| `src/pages/PricingConfig.tsx` | Admin: tarifario |
| `src/pages/reports/FacturacionTab.tsx` | Dashboard de facturación |
