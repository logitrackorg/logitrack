# US-011 — Cancelar un envío

**Como** Supervisor o Admin
**Quiero** cancelar un envío activo
**Para** registrar que no será procesado y mantener el historial de auditoría

**Estado:** Implementada

---

## Criterios de aceptación

1. Solo Supervisor y Admin pueden cancelar envíos.
2. La cancelación requiere un motivo obligatorio.
3. No se puede cancelar un envío en estado `pending` (borrador) ni en estados terminales (`delivered`, `returned`, `cancelled`).
4. Cualquier estado intermedio es cancelable (`in_progress`, `pre_transit`, `in_transit`, `at_branch`, `delivering`, `delivery_failed`, `ready_for_pickup`, `ready_for_return`).
5. Al cancelar se registra un `ShipmentEvent` con `to_status: "cancelled"` y el usuario responsable.
6. Al cancelar se agrega automáticamente un comentario con el motivo: `[Cancelación] <motivo>`.
7. `cancelled` es un estado terminal — no admite más transiciones.

---

## Endpoint

```
POST /api/v1/shipments/:tracking_id/cancel
```

| Campo             | Notas                                                                |
|-------------------|----------------------------------------------------------------------|
| Body              | `{ "reason": "motivo de la cancelación" }`                          |
| Respuesta exitosa | `200 OK` con el envío actualizado (`status: "cancelled"`)            |
| Motivo vacío      | `400 Bad Request`                                                    |
| Estado no válido  | `400 Bad Request` (draft o terminal)                                 |
| Rol no autorizado | `403 Forbidden`                                                      |

---

## Reglas de negocio

1. El motivo no puede ser vacío — se valida antes de cualquier escritura en el repositorio.
2. Estados no cancelables: `pending`, `delivered`, `returned`, `cancelled`.
3. Al cancelar se crea un `ShipmentEvent` con `event_type: "status_change"`, `from_status` = estado actual, `to_status: "cancelled"`, `changed_by` = usuario autenticado.
4. Al cancelar se crea automáticamente un comentario: `[Cancelación] <motivo>`.
5. Las correcciones no se pueden aplicar sobre un envío cancelado (bloqueado por `CorrectShipment`).

---

## Comportamiento del frontend

- En `ShipmentDetail`, el botón **Cancel shipment** (rojo) es visible solo para supervisor y admin.
- El botón está oculto en estados `pending`, `delivered`, `returned` y `cancelled`.
- Al hacer click se abre un modal con:
  - Texto descriptivo de la acción.
  - Textarea de motivo (requerido).
  - Botón "Back" (cierra el modal) y botón "Confirm cancellation" (rojo).
- Si el motivo está vacío, el botón "Confirm cancellation" está deshabilitado.
- Al confirmar, el envío se recarga y el modal se cierra.
- El filtro `active` de la lista de envíos **excluye** los envíos cancelados.
- Existe la opción `Cancelled` en el selector de filtro de estado para ver solo cancelados.

---

## Escenarios

### CA1 — Cancelación exitosa

- **Dado** que el envío `LT-XXXXXXXX` está en `in_transit`
- **Y** el usuario es supervisor
- **Cuando** hace `POST /cancel` con `{ "reason": "Cliente solicitó cancelación" }`
- **Entonces** el servidor responde `200 OK` con `status: "cancelled"`
- **Y** se registra un evento: `from_status: "in_transit"`, `to_status: "cancelled"`, `changed_by: "supervisor"`
- **Y** se agrega el comentario: `[Cancelación] Cliente solicitó cancelación`

### CA2 — Motivo vacío

- **Dado** que el envío está en `at_branch`
- **Cuando** supervisor hace `POST /cancel` con `{ "reason": "" }` o sin `reason`
- **Entonces** el servidor responde `400 Bad Request`
- **Y** el estado del envío no cambia

### CA3 — Cancelar un borrador

- **Dado** que el envío está en `pending`
- **Cuando** supervisor hace `POST /cancel`
- **Entonces** el servidor responde `400 Bad Request`

### CA4 — Cancelar un envío ya finalizado

- **Dado** que el envío está en `delivered`, `returned` o `cancelled`
- **Cuando** supervisor hace `POST /cancel`
- **Entonces** el servidor responde `400 Bad Request`

### CA5 — Operador no puede cancelar

- **Dado** que el envío está en `in_progress`
- **Cuando** el operador hace `POST /cancel`
- **Entonces** el servidor responde `403 Forbidden`

### CA6 — Visual en el frontend

- **Dado** que el supervisor está en el detalle de un envío en `in_transit`
- **Entonces** ve el botón "Cancel shipment" en rojo
- **Cuando** hace click, aparece un modal con textarea de motivo
- **Y** el botón "Confirm cancellation" está deshabilitado hasta ingresar un motivo
- **Cuando** ingresa el motivo y confirma
- **Entonces** el modal se cierra y el envío muestra `status: cancelled`

### CA7 — Cancelado no aparece en filtro Active

- **Dado** que existe un envío en `cancelled`
- **Cuando** el usuario accede a la lista de envíos con filtro "Active" (por defecto)
- **Entonces** el envío cancelado no aparece en la lista
- **Y** al cambiar el filtro a "Cancelled" sí aparece
