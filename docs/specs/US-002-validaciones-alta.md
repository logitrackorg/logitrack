# US-002 — Validaciones del formulario de alta

**Estado:** Implementada

## Actor principal
Operador, Supervisor, Admin (roles con acceso a `/new`).

## Descripción
El formulario de alta valida los campos obligatorios y el formato del email antes de permitir crear o guardar el envío. Los errores del backend se propagan y muestran al usuario.

---

## Campos del formulario

### Obligatorios (bloquean el submit)
| Campo | Validación frontend | Validación backend |
|---|---|---|
| Sender name | `required` | `binding:"required"` |
| Sender phone | `required` | `binding:"required"` |
| Sender DNI | `required` | `binding:"required"` |
| Origin city | `required` | `binding:"required"` (en `Address.City`) |
| Origin province | `required` (select) | `binding:"required"` (en `Address.Province`) |
| Recipient name | `required` | `binding:"required"` |
| Recipient phone | `required` | `binding:"required"` |
| Recipient DNI | `required` | `binding:"required"` |
| Destination city | `required` | `binding:"required"` (en `Address.City`) |
| Destination province | `required` (select) | `binding:"required"` (en `Address.Province`) |
| Receiving branch | `required` (select) | `binding:"required"` |
| Weight (kg) | `required` + `min="0.1"` + `type="number"` | `binding:"required,gt=0"` |
| Package type | `required` (select, default "box") | `binding:"required"` |

### Opcionales
| Campo | Validación |
|---|---|
| Sender / Recipient email | `type="email"` — formato validado por el browser si se ingresa |
| Street (origin / destination) | Sin validación — libre o vacío |
| Special instructions | Sin validación |

---

## Reglas de negocio

1. La validación HTML5 se activa al intentar submittear el form con el botón **"Crear envío"** (`type="submit"`); el browser señala el primer campo inválido.
2. **"Guardar borrador"** no dispara validación HTML5 (es `type="button"`). El backend acepta datos parciales para borradores (`POST /shipments/draft`).
3. Si el backend rechaza la creación (400), el mensaje de error del servidor se muestra bajo el formulario.
4. Si ocurre un error inesperado de red, se muestra el mensaje genérico de fallback.
5. El campo `weight_kg` muestra vacío cuando el valor es `0` para forzar al operador a ingresar un peso explícito.

---

## Escenarios

### CA01 — Campos obligatorios vacíos bloquean el submit

**Dado** que el operador deja campos obligatorios vacíos (ej: sender name y city)
**Cuando** hace clic en "Crear envío"
**Entonces** el browser señala el primer campo vacío y no envía el formulario
**Y** no se realiza ninguna llamada al backend

---

### CA02 — Email con formato inválido

**Dado** que el operador ingresa `"notanemail"` en el campo email del remitente
**Cuando** hace clic en "Crear envío"
**Entonces** el browser indica que el formato del email es inválido
**Y** no se envía el formulario

---

### CA03 — Todos los campos válidos: envío creado

**Dado** que el operador completó todos los campos obligatorios con datos válidos
**Cuando** hace clic en "Crear envío"
**Entonces** el backend crea el envío y responde 201
**Y** el frontend redirige al detalle del nuevo envío (`/shipments/:tracking_id`)

---

### CA04 — El backend rechaza por campo faltante

**Dado** que se envía un payload con `weight_kg: 0` (o `city` vacío)
**Cuando** el backend recibe el request
**Entonces** responde 400 con el mensaje de Gin binding
**Y** el frontend muestra ese mensaje bajo el formulario (no el genérico)

---

### CA05 — Guardar borrador sin validación frontend

**Dado** que el operador solo ingresó nombre y teléfono del remitente
**Cuando** hace clic en "Guardar borrador"
**Entonces** el borrador se guarda con datos parciales
**Y** el frontend redirige al detalle del borrador para completarlo luego
