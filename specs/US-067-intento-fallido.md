# US-067 — Registrar intento fallido de entrega

**Como** Chofer
**Quiero** registrar un intento fallido de entrega
**Para** informar que no se pudo concretar y permitir al Supervisor tomar una decisión

---

## Criterios de aceptación

1. Al registrar el intento fallido, el estado del envío cambia a `delivery_failed`.
2. El motivo del intento fallido es requerido (texto libre).
3. El Supervisor es notificado del cambio.

> **Estado de implementación**
> Los criterios 1 y 2 están completamente implementados.
> El criterio 3 (**notificación al Supervisor**) **no está implementado**. La visibilidad es pasiva: el estado `delivery_failed` aparece en la lista de envíos y en el dashboard, lo que permite al Supervisor detectarlo al consultar el sistema. No existe un mecanismo de push notification, email ni alerta activa.

---

## Reglas de negocio

1. La transición `delivering → delivery_failed` requiere `notes` no vacías — validado por el servidor.
2. El motivo es texto libre. No hay lista predefinida de opciones (ausente, dirección incorrecta, etc.), aunque el frontend muestra ejemplos como placeholder.
3. El evento queda registrado en el historial con el motivo y el usuario que lo registró.
4. Tras `delivery_failed`, el Supervisor puede:
   - Mover a `delivering` para un reintento (requiere seleccionar un chofer).
   - Mover a `at_branch` para retornar el paquete a la sucursal (sin reintento).
5. Aunque el actor principal es el Chofer, el Supervisor y Admin también pueden registrar un intento fallido desde `ShipmentDetail`.

---

## Permisos

| Acción                                              | Roles habilitados              |
|-----------------------------------------------------|--------------------------------|
| Registrar `delivery_failed` (driver — solo su ruta) | driver                         |
| Registrar `delivery_failed` (cualquier envío)       | supervisor, admin              |
| Ver el motivo en el historial de eventos            | todos los roles autenticados   |
| Decidir el siguiente paso tras `delivery_failed`    | supervisor, admin              |

---

## Comportamiento del frontend — Driver (`/driver/route`)

1. Cada envío en estado `delivering` muestra el botón **"Intento fallido"**.
2. Al presionar el botón aparece un textarea con placeholder `"Motivo del intento fallido (requerido)"`.
3. El botón de confirmación está deshabilitado hasta que se ingrese al menos un carácter.
4. Al confirmar: el estado cambia a `delivery_failed` y los botones de acción desaparecen para ese envío.
5. El envío pasa al contador de "finalizados" en el resumen de ruta.

## Comportamiento del frontend — Supervisor (`/shipments/:trackingId`)

1. En el panel de actualización de estado, `delivery_failed` es una opción disponible cuando el envío está en `delivering`.
2. Al seleccionar `delivery_failed`, aparece el campo de notas como requerido.
3. El botón de confirmación está deshabilitado hasta que se ingresen notas.

---

## Escenarios

### CA1 — Chofer registra intento fallido con motivo

- **Dado** que el envío está en `delivering` y pertenece a la ruta del chofer
- **Cuando** el chofer hace `PATCH` con `{ "status": "delivery_failed", "notes": "Destinatario ausente" }`
- **Entonces** el servidor responde `200 OK` con `status: delivery_failed`
- **Y** el evento queda registrado con `notes: "Destinatario ausente"` y el usuario del chofer

### CA2 — Chofer intenta registrar intento fallido sin motivo

- **Dado** que el envío está en `delivering`
- **Cuando** el chofer hace `PATCH` con `{ "status": "delivery_failed" }` sin `notes`
- **Entonces** el servidor responde `400 Bad Request`
- **Y** el estado del envío no cambia

### CA3 — Frontend impide confirmar sin motivo

- **Dado** que el chofer presionó "Intento fallido" en `/driver/route`
- **Cuando** el textarea de motivo está vacío
- **Entonces** el botón "Confirmar" está deshabilitado
- **Y** no se envía ninguna petición al servidor

### CA4 — El motivo queda visible en el historial

- **Dado** que se registró un intento fallido con motivo
- **Cuando** cualquier usuario autenticado consulta `GET /shipments/:id/events`
- **Entonces** el evento de `delivery_failed` incluye el campo `notes` con el motivo ingresado
- **Y** en `ShipmentDetail` el motivo es visible en el historial de eventos

### CA5 — Supervisor ve el envío en estado delivery_failed

- **Dado** que se registró un intento fallido
- **Cuando** el Supervisor consulta la lista de envíos o el dashboard
- **Entonces** el envío aparece con badge `Delivery Failed`
- **Y** puede acceder al detalle para ver el motivo y decidir el próximo paso

### CA6 — Supervisor reintenta entrega tras intento fallido

- **Dado** que el envío está en `delivery_failed`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "delivering", "driver_id": "5" }`
- **Entonces** responde `200 OK` con `status: delivering`
- **Y** el envío aparece en la ruta del chofer asignado

### CA7 — Supervisor devuelve envío a sucursal tras intento fallido

- **Dado** que el envío está en `delivery_failed`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "at_branch" }`
- **Entonces** responde `200 OK` con `status: at_branch`
- **Y** la ubicación se auto-deriva del último evento `at_branch` registrado

### CA8 — Chofer intenta registrar intento fallido en envío fuera de su ruta

- **Dado** que el envío no pertenece a la ruta del chofer
- **Cuando** el chofer hace `PATCH /shipments/:id/status` con `delivery_failed`
- **Entonces** responde `403 Forbidden`
