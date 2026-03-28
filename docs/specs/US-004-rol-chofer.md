# US-004 — Rol Chofer

**Como** Administrador
**Quiero** definir el rol Chofer
**Para** que pueda actualizar el estado de los envíos asignados a su ruta del día

---

## Descripción del rol

El Chofer (`driver`) es un rol operativo de última milla. Solo ve los envíos de su ruta asignada para el día y puede registrar dos resultados por envío: entrega exitosa (validando el DNI del destinatario) o intento fallido con motivo. No tiene acceso a funciones de gestión de envíos ni a reportes.

---

## Cambios en el modelo de datos

### Campos nuevos en Envío (`Shipment`)

| Campo           | Tipo   | Notas                                               |
|-----------------|--------|-----------------------------------------------------|
| `sender_dni`    | string | Requerido para confirmar (crear / confirmar draft)  |
| `recipient_dni` | string | Requerido para confirmar (crear / confirmar draft)  |

El `sender_dni` se valida operativamente al confirmar el retiro por remitente (`ready_for_return → returned`). El `recipient_dni` se valida al momento de la entrega (`delivering → delivered` o `ready_for_pickup → delivered`).

### Nuevo modelo: Ruta (`Route`)

Una ruta agrupa los envíos asignados a un chofer para un día específico. Es creada/modificada automáticamente cuando un Supervisor o Admin mueve un envío a estado `delivering` y elige un driver.

| Campo           | Tipo       | Notas                                              |
|-----------------|------------|----------------------------------------------------|
| `id`            | string     | Generado automáticamente (`ROUTE-{8 hex}`)        |
| `date`          | string     | Fecha en formato `YYYY-MM-DD`                      |
| `driver_id`     | string     | ID del usuario con rol `driver`                    |
| `shipment_ids`  | []string   | Tracking IDs de los envíos asignados               |
| `created_by`    | string     | Usuario que creó la ruta                           |
| `created_at`    | datetime   | Generado automáticamente                           |

**Restricciones:**
- Solo se pueden asignar a una ruta envíos en transición a estado `delivering`.
- Si el driver ya tiene ruta para ese día, el envío se agrega a la ruta existente.
- Un envío no puede pertenecer a más de una ruta activa el mismo día.

---

## Nuevo estado: `delivery_failed`

Representa un intento de entrega fallido (destinatario ausente, dirección incorrecta, etc.). El paquete queda retenido y pendiente de reasignación por el supervisor.

### Máquina de estados (cambios respecto al estado anterior)

```
at_branch → delivering             (supervisor/admin: asigna shipment + elige driver)
delivering → delivered             (driver: confirma entrega con DNI del destinatario)
delivering → delivery_failed       (driver: registra intento fallido + motivo)
delivery_failed → delivering       (supervisor/admin: re-asigna para reintento, elige driver)
delivery_failed → at_branch        (supervisor/admin: devuelve a sucursal sin reintento)
at_branch → ready_for_pickup       (supervisor/admin: destinatario retira en sucursal actual)
at_branch → ready_for_return       (supervisor/admin: solo válido en sucursal de origen — remitente retira)
ready_for_pickup → delivered       (supervisor/admin: confirma retiro con DNI del destinatario)
ready_for_pickup → in_transit      (supervisor/admin: reenvía a otra sucursal)
ready_for_return → returned        (supervisor/admin: confirma retiro con DNI del remitente)
```

**Transición eliminada:** `delivering → at_branch` directo. Ahora `delivering` solo va a `delivered` o `delivery_failed`.

---

## Flujo de asignación a driver (transición `at_branch → delivering`)

Cuando un Supervisor/Admin mueve un envío a `delivering`:
1. Selecciona el estado `delivering` en el panel de actualización.
2. Aparece un dropdown con la lista de choferes disponibles — `GET /api/v1/users/drivers`.
3. Al confirmar, el backend:
   a. Valida la transición.
   b. Registra el evento con el driver asignado en `notes`.
   c. Crea o actualiza la ruta del día del driver con el tracking ID.

---

## Flujo de entrega (driver)

1. El driver ve sus envíos en `/driver/route`.
2. Para cada envío en `delivering`, presiona **"Entregar"**.
3. Aparece un campo para ingresar el DNI del destinatario.
4. Al confirmar:
   - El backend valida que el DNI ingresado coincida con `recipient_dni` del envío.
   - Si coincide: `status → delivered`, se registra `delivered_at`.
   - Si no coincide: `400 Bad Request` — "El DNI no coincide con el del destinatario esperado".

---

## Flujo de intento fallido (driver)

1. El driver presiona **"Intento fallido"** en el envío.
2. Aparece un campo de texto para ingresar el motivo (requerido).
3. Al confirmar: `status → delivery_failed`, se registra el motivo en `notes`.
4. El envío queda visible para el supervisor con estado `delivery_failed`.

---

## Permisos

| Acción                                       | Roles habilitados                               |
|----------------------------------------------|-------------------------------------------------|
| Ver su ruta del día                          | driver                                          |
| Ver detalle básico de un envío de su ruta    | driver                                          |
| Transición `delivering → delivered` (+ DNI) | driver (solo envíos de su ruta), supervisor, admin |
| Transición `delivering → delivery_failed`    | driver (solo envíos de su ruta), supervisor, admin |
| Transición `at_branch → delivering` (+ driver_id) | supervisor, admin                          |
| Transición `delivery_failed → delivering` (+ driver_id) | supervisor, admin                    |
| Transición `delivery_failed → at_branch`     | supervisor, admin                               |
| Transición `at_branch → ready_for_pickup`    | supervisor, admin                               |
| Transición `at_branch → ready_for_return` (solo en sucursal de origen) | supervisor, admin    |
| Transición `ready_for_pickup → delivered` (+ recipient_dni) | supervisor, admin             |
| Transición `ready_for_pickup → in_transit`   | supervisor, admin                               |
| Transición `ready_for_return → returned` (+ sender_dni) | supervisor, admin                 |
| Ver lista de drivers disponibles             | supervisor, admin                               |
| Ver lista completa de envíos                 | todos excepto driver                            |
| Crear / editar envíos                        | operator, supervisor, admin — **no driver**    |
| Ver dashboard / estadísticas                 | supervisor, manager, admin — **no driver**     |

---

## Endpoints

| Método | Path                       | Roles              | Descripción                                       |
|--------|----------------------------|--------------------|---------------------------------------------------|
| GET    | `/api/v1/driver/route`     | driver             | Ruta del día del chofer autenticado               |
| GET    | `/api/v1/users/drivers`    | supervisor, admin  | Lista de usuarios con rol driver                  |

### `GET /api/v1/driver/route` — respuesta

```json
{
  "route": { "id": "ROUTE-XXXXXXXX", "date": "2026-03-21", "driver_id": "...", "shipment_ids": [...] },
  "shipments": [ /* objetos Shipment completos */ ]
}
```

- Si el driver no tiene ruta para hoy: `404 Not Found` con `"no route assigned for today"`.

### `PATCH /api/v1/shipments/:id/status` — campos adicionales

| Campo           | Aplica cuando                        | Obligatorio |
|-----------------|--------------------------------------|-------------|
| `driver_id`     | `status: "delivering"`               | Sí          |
| `recipient_dni` | `status: "delivered"` (driver)       | Sí          |
| `notes`         | `status: "delivery_failed"`          | Sí          |
| `sender_dni`    | `status: "returned"`                 | Sí — debe coincidir con `sender_dni` del envío |

---

## Comportamiento del frontend

1. El Chofer ve `/driver/route` como vista principal al hacer login.
2. La pantalla muestra la lista de envíos con datos del destinatario y dirección de entrega.
3. Cada envío con estado `delivering` muestra dos botones: **"Entregar"** e **"Intento fallido"**.
4. Al presionar "Entregar": aparece un campo de DNI requerido antes de confirmar.
5. Al presionar "Intento fallido": aparece un campo de motivo requerido antes de confirmar.
6. Una vez registrado, los botones desaparecen para ese envío.
7. El Chofer no puede acceder a `/`, `/new`, `/dashboard`. Redirige a `/driver/route`.
8. La navegación solo muestra "Mi ruta".
9. Al seleccionar `delivering` en el panel del supervisor, aparece un dropdown de drivers.
10. Cada envío en `/driver/route` es clickeable y navega a `/shipments/:trackingId` con una vista de solo lectura.
11. La vista de detalle del chofer muestra: tracking ID, tipo de paquete, peso, instrucciones especiales, nombre/teléfono/dirección del destinatario, y estado actual. No incluye el panel de actualización de estado ni el historial de eventos.

---

## Escenarios

### CA1 — Login del Chofer

- **Dado** que existe el usuario `chofer / chofer123` con rol `driver`
- **Cuando** hace `POST /api/v1/auth/login`
- **Entonces** responde `200 OK` con token y `role: driver`
- **Y** el frontend redirige a `/driver/route`

### CA2 — Chofer consulta su ruta del día

- **Dado** que el chofer tiene ruta asignada para hoy
- **Cuando** hace `GET /api/v1/driver/route`
- **Entonces** responde `200 OK` con la ruta y los envíos completos

### CA3 — Chofer sin ruta asignada

- **Dado** que el chofer no tiene ruta para hoy
- **Cuando** hace `GET /api/v1/driver/route`
- **Entonces** responde `404 Not Found` con `"no route assigned for today"`

### CA4 — Supervisor asigna envío a driver al mover a delivering

- **Dado** que el envío `LT-XXXXXXXX` está en `at_branch`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "delivering", "driver_id": "5" }`
- **Entonces** el servidor responde `200 OK` con el envío en estado `delivering`
- **Y** el envío aparece en la ruta del día del driver elegido
- **Y** si el driver no tenía ruta para hoy, se crea automáticamente

### CA5 — Entrega exitosa con DNI correcto

- **Dado** que el envío tiene `recipient_dni: "30123456"` y está en estado `delivering`
- **Cuando** el driver hace `PATCH` con `{ "status": "delivered", "recipient_dni": "30123456" }`
- **Entonces** responde `200 OK` con `status: delivered` y `delivered_at` registrado

### CA6 — Entrega con DNI incorrecto

- **Dado** que el envío tiene `recipient_dni: "30123456"`
- **Cuando** el driver hace `PATCH` con `{ "status": "delivered", "recipient_dni": "99999999" }`
- **Entonces** responde `400 Bad Request` con `"El DNI no coincide con el del destinatario esperado"`
- **Y** el estado del envío no cambia

### CA7 — Entrega sin DNI

- **Dado** que el envío está en `delivering`
- **Cuando** el driver hace `PATCH` con `{ "status": "delivered" }` sin `recipient_dni`
- **Entonces** responde `400 Bad Request`

### CA8 — Intento fallido con motivo

- **Dado** que el envío está en `delivering`
- **Cuando** el driver hace `PATCH` con `{ "status": "delivery_failed", "notes": "Destinatario ausente" }`
- **Entonces** responde `200 OK` con `status: delivery_failed` y evento con el motivo

### CA9 — Intento fallido sin motivo

- **Dado** que el envío está en `delivering`
- **Cuando** el driver hace `PATCH` sin `notes`
- **Entonces** responde `400 Bad Request`

### CA10 — Driver intenta actualizar envío fuera de su ruta

- **Dado** que `LT-ZZZZZZZZ` no pertenece a la ruta del driver
- **Cuando** el driver hace `PATCH /api/v1/shipments/LT-ZZZZZZZZ/status`
- **Entonces** responde `403 Forbidden`

### CA11 — Driver intenta acceder a la lista de envíos

- **Dado** que el driver tiene token válido
- **Cuando** hace `GET /api/v1/shipments`
- **Entonces** responde `403 Forbidden`

### CA12 — Driver navega a ruta no permitida

- **Dado** que el driver está autenticado
- **Cuando** intenta navegar a `/dashboard`, `/new` o `/` por URL
- **Entonces** el frontend redirige a `/driver/route`

### CA22 — Driver intenta transición de estado no permitida

- **Dado** que el driver tiene un envío en su ruta en estado `delivering`
- **Cuando** hace `PATCH /api/v1/shipments/:id/status` con `{ "status": "in_transit" }` (u otro estado distinto a `delivered` o `delivery_failed`)
- **Entonces** el servidor responde `403 Forbidden`
- **Y** el estado del envío no cambia

### CA23 — Driver accede al detalle de un envío de su ruta

- **Dado** que el driver tiene envíos asignados en su ruta
- **Cuando** hace clic en un envío en `/driver/route`
- **Entonces** el frontend navega a `/shipments/:trackingId`
- **Y** la pantalla muestra: tracking ID, tipo de paquete, peso, instrucciones especiales, nombre del destinatario, teléfono del destinatario, dirección de entrega y estado actual
- **Y** no se muestra el panel de actualización de estado ni el historial de eventos

### CA24 — Driver intenta acceder al detalle de un envío que no está en su ruta

- **Dado** que el driver está autenticado
- **Cuando** navega directamente a `/shipments/LT-ZZZZZZZZ` (un envío que no existe en su ruta)
- **Entonces** el backend responde `200 OK` (el endpoint es público para roles autenticados)
- **Y** el frontend muestra los datos básicos del envío de solo lectura (sin restricción adicional por ruta en el detalle)

### CA13 — Supervisor ve lista de drivers al asignar entrega

- **Dado** que el supervisor selecciona `delivering` en el panel de actualización
- **Cuando** el dropdown de drivers se renderiza
- **Entonces** muestra todos los usuarios con rol `driver` obtenidos de `GET /api/v1/users/drivers`

### CA14 — Supervisor re-asigna envío fallido a otro driver

- **Dado** que el envío tiene `status: delivery_failed`
- **Cuando** el supervisor hace `PATCH` con `{ "status": "delivering", "driver_id": "6" }`
- **Entonces** responde `200 OK` con `status: delivering`
- **Y** el envío aparece en la ruta del nuevo driver

### CA15 — Crear envío sin DNI del destinatario

- **Dado** que el usuario hace `POST /api/v1/shipments` sin `recipient_dni`
- **Entonces** responde `400 Bad Request`

### CA16 — Marcar envío como listo para retiro por destinatario

- **Dado** que el envío está en `at_branch`
- **Cuando** el supervisor hace `PATCH` con `{ "status": "ready_for_pickup" }`
- **Entonces** responde `200 OK` con `status: ready_for_pickup`
- **Y** el destinatario puede pasar a retirar por esa sucursal

### CA17 — Marcar envío como listo para devolución al remitente

- **Dado** que el envío está en `at_branch` y la sucursal actual es la sucursal de origen (`receiving_branch_id`)
- **Cuando** el supervisor hace `PATCH` con `{ "status": "ready_for_return" }`
- **Entonces** responde `200 OK` con `status: ready_for_return`

### CA18 — Intento de ready_for_return en sucursal que no es la de origen

- **Dado** que el envío está en `at_branch` pero la sucursal actual no es la sucursal de origen
- **Cuando** el supervisor intenta hacer `PATCH` con `{ "status": "ready_for_return" }`
- **Entonces** responde `400 Bad Request` indicando que el envío no está en la sucursal de origen

### CA19 — Confirmar retiro por destinatario con DNI correcto

- **Dado** que el envío tiene `recipient_dni: "31204567"` y está en `ready_for_pickup`
- **Cuando** el supervisor hace `PATCH` con `{ "status": "delivered", "recipient_dni": "31204567" }`
- **Entonces** responde `200 OK` con `status: delivered` y `delivered_at` registrado

### CA20 — Confirmar retiro por remitente con DNI correcto

- **Dado** que el envío tiene `sender_dni: "27845123"` y está en `ready_for_return`
- **Cuando** el supervisor hace `PATCH` con `{ "status": "returned", "sender_dni": "27845123" }`
- **Entonces** responde `200 OK` con `status: returned`

### CA21 — Confirmar retiro por remitente con DNI incorrecto

- **Dado** que el envío tiene `sender_dni: "27845123"` y está en `ready_for_return`
- **Cuando** el supervisor hace `PATCH` con `{ "status": "returned", "sender_dni": "99999999" }`
- **Entonces** responde `400 Bad Request` con `"El DNI no coincide con el del remitente esperado"`
- **Y** el estado del envío no cambia
