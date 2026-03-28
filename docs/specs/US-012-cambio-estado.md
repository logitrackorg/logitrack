# US-012 — Cambio de estado del envío

**Estado:** Implementada

## Actor principal
Supervisor, Admin (vía `ShipmentDetail`).
Driver (vía `DriverRoute` / `DriverShipmentDetail`, con restricciones adicionales).

## Descripción
El supervisor puede avanzar el estado de un envío a través de las transiciones válidas del proceso logístico. Cada cambio queda registrado en el historial con fecha, hora y usuario que lo realizó.

---

## Modelo de datos relevante

### `UpdateStatusRequest`
| Campo | Tipo | Descripción |
|---|---|---|
| `status` | `ShipmentStatus` | Nuevo estado (requerido) |
| `changed_by` | `string` | Usuario que realiza el cambio |
| `location` | `string` | Ubicación asociada (requerida en ciertas transiciones) |
| `notes` | `string` | Observaciones (requeridas en `delivery_failed`) |
| `driver_id` | `string` | ID del chofer asignado (requerido para → `delivering`) |
| `recipient_dni` | `string` | DNI del destinatario (requerido para → `delivered`) |
| `sender_dni` | `string` | DNI del remitente (requerido para → `returned`) |

### `ShipmentEvent`
| Campo | Descripción |
|---|---|
| `id` | UUID del evento |
| `tracking_id` | Envío al que pertenece |
| `from_status` | Estado anterior |
| `to_status` | Estado resultante |
| `changed_by` | Usuario que ejecutó el cambio |
| `location` | Ubicación registrada en el evento |
| `notes` | Observaciones |
| `timestamp` | Fecha y hora UTC del cambio |

---

## Máquina de estados

```
pending ──[confirmar]──► in_progress ──► in_transit ──► at_branch ──► in_transit (siguiente tramo)
                                                                    ├─► delivering ──► delivered
                                                                    │              └─► delivery_failed ──► delivering (reintento)
                                                                    │                                  └─► at_branch (retorno)
                                                                    ├─► ready_for_pickup ──► delivered
                                                                    │                    └─► in_transit
                                                                    └─► ready_for_return ──► returned
```

`pending` no transiciona vía `UpdateStatus`; usa `ConfirmDraft`. `delivered` y `returned` son terminales.

---

## Reglas de negocio

1. Solo se permiten transiciones definidas en la máquina de estados.
2. El cambio se registra como `ShipmentEvent` con `changed_by`, `timestamp` UTC y demás campos del request.
3. Para `→ delivering`: `driver_id` es requerido; se asigna el envío a la ruta del chofer para ese día.
4. Para `→ delivered`: `recipient_dni` requerido y debe coincidir con `shipment.recipient_dni`.
5. Para `→ returned`: `sender_dni` requerido y debe coincidir con `shipment.sender_dni`.
6. Para `→ delivery_failed`: `notes` requerido (motivo del intento fallido).
7. Para `→ ready_for_return`: el envío debe estar en la sucursal de origen (`current_location == receiving_branch.city`).
8. `in_transit → at_branch`: la location se auto-deriva del último evento `in_transit` (no se envía en el request).
9. `delivery_failed → at_branch`: la location se auto-deriva del último evento `at_branch`.
10. `→ delivered` **no** actualiza `current_location` (el paquete ya no está en ninguna sucursal).
11. Toda validación ocurre **antes** de escribir en el repositorio — estado nunca queda corrupto.
12. El driver solo puede cambiar estado de envíos asignados a su ruta del día (validado en handler).

---

## Escenarios

### CA01 — Transición válida registra evento

**Dado** un envío en estado `at_branch`
**Y** el usuario es supervisor
**Cuando** el supervisor hace `PATCH /shipments/:id/status` con `status: "delivering"`, `driver_id`, `changed_by`
**Entonces** el servidor responde 200 con el envío actualizado
**Y** se crea un `ShipmentEvent` con `from_status: "at_branch"`, `to_status: "delivering"`, `changed_by`, `timestamp` UTC
**Y** el envío se asigna a la ruta del chofer para hoy

---

### CA02 — Transición inválida devuelve error descriptivo

**Dado** un envío en estado `in_transit`
**Cuando** el supervisor intenta `PATCH /shipments/:id/status` con `status: "delivered"`
**Entonces** el servidor responde 400
**Y** el body contiene `{"error": "invalid transition: in_transit → delivered"}`
**Y** el estado del envío no cambia
**Y** no se crea ningún evento

---

### CA03 — El frontend solo muestra las transiciones válidas

**Dado** un envío en estado `at_branch`
**Y** el usuario es supervisor o admin
**Cuando** el supervisor abre `ShipmentDetail`
**Entonces** el panel "Update Status" muestra exactamente los botones: `In Transit`, `Delivering`, `Ready for Pickup`, `Ready for Return`
**Y** no hay botón para estados no permitidos (ej: `Delivered`, `Returned`)

---

### CA04 — El historial de eventos muestra fecha, hora y usuario

**Dado** un envío con múltiples cambios de estado
**Cuando** cualquier usuario con acceso abre `ShipmentDetail`
**Entonces** la sección "Event History" muestra cada evento con:
  - Transición (`from_status → to_status`)
  - Timestamp formateado
  - Usuario (`changed_by`)
  - Ubicación (si aplica)
  - Notas (si aplica)

---

### CA05 — Error del servidor se muestra inline

**Dado** que el servidor rechaza un cambio (por DNI incorrecto, notas faltantes, etc.)
**Cuando** el supervisor confirma el update en el frontend
**Entonces** el mensaje de error del backend se muestra inline en el panel
**Y** el formulario permanece abierto para corregir

---

### CA06 — `ready_for_return` requiere estar en sucursal de origen

**Dado** un envío en `at_branch` cuyo `current_location` **no** coincide con la ciudad de la sucursal de origen
**Cuando** se intenta `→ ready_for_return`
**Entonces** el servidor responde 400 con mensaje explicativo
**Y** en el frontend, el botón `Ready for Return` **no aparece** (filtrado client-side mediante `isAtOriginBranch`)

---

### CA07 — Operador no puede cambiar estado

**Dado** un usuario con rol `operator`
**Cuando** intenta `PATCH /shipments/:id/status`
**Entonces** el servidor responde 403 Forbidden
