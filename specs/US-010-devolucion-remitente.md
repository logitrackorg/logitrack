# US-010 — Envío devuelto a remitente

**Estado:** Implementada

## Actor principal
Supervisor, Admin.

## Descripción
Cuando un envío no pudo ser entregado y fue retornado a la sucursal de origen, el supervisor puede marcarlo como listo para ser retirado por el remitente y luego registrar el retiro confirmando la identidad del remitente con su DNI.

---

## Flujo completo

```
at_branch ──► ready_for_return ──► returned
  (debe estar en         (DNI remitente
   sucursal de origen)    requerido y validado)
```

---

## Reglas de negocio

1. La transición `→ ready_for_return` solo está disponible cuando `current_location == receiving_branch.city` (el envío está físicamente en la sucursal de origen).
2. La transición `→ returned` solo está disponible desde `ready_for_return` — ningún otro estado permite ir a `returned`.
3. Para confirmar `→ returned`: `sender_dni` es requerido y debe coincidir exactamente con `shipment.sender_dni`.
4. Si el DNI no coincide, el servidor responde 400 con mensaje `"El DNI no coincide con el del remitente esperado"` y el estado no cambia.
5. El cambio se registra como `ShipmentEvent` con `from_status`, `to_status`, `changed_by` y `timestamp` UTC.
6. `returned` es un estado terminal — no hay transiciones posteriores.
7. Solo supervisor y admin pueden ejecutar estas transiciones (driver no puede).

---

## Escenarios

### CA01 — Marcar envío como listo para retiro por remitente

**Dado** un envío en `at_branch`
**Y** `current_location` coincide con la ciudad de la sucursal de origen (`receiving_branch_id`)
**Y** el usuario es supervisor
**Cuando** selecciona la transición `Ready for Return`
**Entonces** el servidor responde 200 con el estado actualizado a `ready_for_return`
**Y** se registra el evento en el historial

---

### CA02 — `ready_for_return` no disponible si el envío no está en sucursal de origen

**Dado** un envío en `at_branch`
**Y** `current_location` **no** coincide con la ciudad de la sucursal de origen (ej: el envío está en una sucursal intermedia)
**Cuando** el supervisor intenta `PATCH /shipments/:id/status` con `status: "ready_for_return"`
**Entonces** el servidor responde 400 con mensaje explicativo
**Y** en el frontend el botón `Ready for Return` **no aparece** (filtrado client-side mediante `isAtOriginBranch`)

---

### CA03 — DNI correcto: estado cambia a `returned`

**Dado** un envío en estado `ready_for_return`
**Y** el usuario es supervisor
**Cuando** selecciona la transición `Returned` e ingresa el DNI correcto del remitente
**Entonces** el servidor responde 200 con el estado actualizado a `returned`
**Y** se registra el evento con `from_status: "ready_for_return"`, `to_status: "returned"`, `changed_by`, `timestamp`

---

### CA04 — DNI incorrecto: error y estado sin cambios

**Dado** un envío en estado `ready_for_return`
**Cuando** el supervisor intenta `PATCH /shipments/:id/status` con `status: "returned"` y un DNI que no coincide
**Entonces** el servidor responde 400 con `"El DNI no coincide con el del remitente esperado"`
**Y** el estado del envío permanece en `ready_for_return`
**Y** no se crea ningún evento

---

### CA05 — El frontend solicita el DNI antes de confirmar

**Dado** un envío en `ready_for_return`
**Y** el usuario es supervisor
**Cuando** selecciona el botón `Returned` en el panel de cambio de estado
**Entonces** aparece un campo de texto solicitando el DNI del remitente
**Y** el botón "Confirm Update" permanece deshabilitado mientras el campo esté vacío

---

### CA06 — `returned` es estado terminal

**Dado** un envío en estado `returned`
**Cuando** el supervisor accede al detalle
**Entonces** el panel "Update Status" no aparece (no hay transiciones disponibles)
