# US-068 — Registrar entrega exitosa de un envío

**Como** Chofer
**Quiero** registrar la entrega exitosa de un envío
**Para** actualizar su estado a `delivered` y dejar constancia en auditoría

---

## Criterios de aceptación

1. Al confirmar la entrega, el estado cambia a `delivered` y se registra `delivered_at` con fecha/hora y el usuario responsable.
2. El envío entregado ya no muestra botones de acción en la vista del Chofer.
3. Debe ingresarse el DNI de la persona que recibe el paquete; debe coincidir con el `recipient_dni` registrado en el envío.

---

## Reglas de negocio

1. La transición a `delivered` es válida desde dos estados:
   - `delivering → delivered` (entrega a domicilio por el chofer)
   - `ready_for_pickup → delivered` (retiro en sucursal confirmado por supervisor/admin)
2. `recipient_dni` es requerido en ambos casos — validado por el servidor antes de cualquier escritura.
3. Si el DNI ingresado no coincide con el `recipient_dni` del envío, el servidor rechaza con `400` y el estado **no cambia**.
4. Al confirmar la entrega el servidor registra `delivered_at` con timestamp UTC.
5. `delivered` es un estado terminal — no admite transiciones posteriores.
6. El evento queda en el historial con: `from_status: delivering`, `to_status: delivered`, `changed_by`, `timestamp`.
7. Aunque el actor principal es el Chofer, el Supervisor y Admin también pueden registrar la entrega desde `ShipmentDetail` (incluyendo `ready_for_pickup → delivered`).

---

## Permisos

| Acción                                                   | Roles habilitados              |
|----------------------------------------------------------|--------------------------------|
| `delivering → delivered` (solo envíos de su ruta)       | driver                         |
| `delivering → delivered` (cualquier envío)               | supervisor, admin              |
| `ready_for_pickup → delivered`                           | supervisor, admin              |
| Ver `delivered_at` en el detalle del envío               | todos los roles autenticados   |

---

## Comportamiento del frontend — Driver (`/driver/route`)

1. Cada envío en `delivering` muestra el botón **"Entregar"**.
2. Al presionar "Entregar" aparece un campo de texto para ingresar el DNI del destinatario.
3. El botón "Confirmar entrega" está deshabilitado hasta que se ingrese un valor en el campo DNI.
4. Si el DNI no coincide, el servidor devuelve `400` y el frontend muestra el mensaje de error sin navegar.
5. Al confirmar exitosamente, los botones de acción desaparecen para ese envío y el card queda visible en modo solo lectura con badge `Delivered`.
6. El contador de "finalizados" en el resumen de ruta se incrementa.

## Comportamiento del frontend — Supervisor (`/shipments/:trackingId`)

1. Al seleccionar `delivered` en el panel de actualización, aparece un campo de DNI del destinatario (requerido).
2. El botón de confirmación está deshabilitado hasta que se ingrese el DNI.
3. Si el DNI no coincide, se muestra el error inline sin cambiar el estado.

---

## Escenarios

### CA1 — Entrega exitosa con DNI correcto

- **Dado** que el envío tiene `recipient_dni: "30123456"` y está en `delivering`
- **Cuando** el chofer hace `PATCH` con `{ "status": "delivered", "recipient_dni": "30123456" }`
- **Entonces** el servidor responde `200 OK` con `status: delivered`
- **Y** el campo `delivered_at` está presente con la fecha/hora de la entrega
- **Y** el evento queda registrado con `changed_by` igual al usuario del chofer

### CA2 — Entrega con DNI incorrecto

- **Dado** que el envío tiene `recipient_dni: "30123456"`
- **Cuando** el chofer hace `PATCH` con `{ "status": "delivered", "recipient_dni": "99999999" }`
- **Entonces** el servidor responde `400 Bad Request` con `"El DNI no coincide con el del destinatario esperado"`
- **Y** el estado del envío no cambia
- **Y** no se registra `delivered_at`

### CA3 — Entrega sin DNI

- **Dado** que el envío está en `delivering`
- **Cuando** el chofer hace `PATCH` con `{ "status": "delivered" }` sin `recipient_dni`
- **Entonces** el servidor responde `400 Bad Request`
- **Y** el estado del envío no cambia

### CA4 — Frontend impide confirmar sin DNI

- **Dado** que el chofer presionó "Entregar" en `/driver/route`
- **Cuando** el campo de DNI está vacío
- **Entonces** el botón "Confirmar entrega" está deshabilitado
- **Y** no se envía ninguna petición al servidor

### CA5 — El envío queda en modo solo lectura tras entrega

- **Dado** que el chofer registró la entrega exitosa
- **Cuando** visualiza la ruta actualizada
- **Entonces** el envío muestra badge `Delivered` sin botones de acción
- **Y** el contador de finalizados en el resumen de ruta se incrementa

### CA6 — La entrega queda registrada en auditoría

- **Dado** que se registró una entrega exitosa
- **Cuando** cualquier usuario autenticado consulta `GET /shipments/:id/events`
- **Entonces** el último evento tiene `to_status: delivered`, `changed_by` y `timestamp`
- **Y** el campo `delivered_at` del envío refleja esa misma fecha/hora

### CA7 — Retiro en sucursal confirmado con DNI correcto

- **Dado** que el envío está en `ready_for_pickup` con `recipient_dni: "31204567"`
- **Cuando** el supervisor hace `PATCH` con `{ "status": "delivered", "recipient_dni": "31204567" }`
- **Entonces** responde `200 OK` con `status: delivered` y `delivered_at` registrado

### CA8 — El envío entregado no aparece en el filtro activo de la lista

- **Dado** que un envío fue entregado
- **Cuando** cualquier usuario consulta la lista de envíos con filtro `Active`
- **Entonces** el envío entregado no aparece en los resultados
