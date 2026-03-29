# US-020 — Rol Supervisor

**Como** Administrador
**Quiero** dar de alta usuarios con el rol Supervisor
**Para** habilitar funciones de validación, control y cambio de estados en el sistema logístico

---

## Descripción del rol

El Supervisor es el rol operativo de mayor alcance sobre los envíos. Puede realizar todas las acciones del Operador más la gestión completa del ciclo de vida de los envíos: transicionar cualquier estado, asignar choferes y acceder a estadísticas y auditoría completa.

> **Estado de implementación**
> - El rol Supervisor y todas sus capacidades están completamente implementados.
> - La creación de usuarios Supervisor por parte del Admin (gestión de usuarios) **no está implementada**. Actualmente el único Supervisor del sistema es el usuario hardcodeado `supervisor / supervisor123`.

---

## Permisos

| Acción                                                      | Roles habilitados                              |
|-------------------------------------------------------------|------------------------------------------------|
| Ver lista de envíos                                         | todos excepto driver                           |
| Ver detalle de un envío                                     | todos los roles autenticados                   |
| Buscar envíos                                               | todos excepto driver                           |
| Ver sucursales                                              | todos excepto driver                           |
| Crear envío directo (`POST /shipments`)                     | operator, supervisor, admin                    |
| Guardar borrador (`POST /shipments/draft`)                  | operator, supervisor, admin                    |
| Editar borrador (`PATCH /shipments/:id/draft`)              | operator, supervisor, admin                    |
| Confirmar borrador (`POST /shipments/:id/confirm`)          | operator, supervisor, admin                    |
| Cambiar estado de un envío (`PATCH /shipments/:id/status`)  | supervisor, admin (driver con restricciones)   |
| Cancelar un envío (`POST /shipments/:id/cancel`)            | supervisor, admin                              |
| Corregir datos de un envío (`PATCH /shipments/:id/correct`) | operator, supervisor, admin                    |
| Agregar comentario a un envío                               | operator, supervisor, admin                    |
| Asignar chofer al mover a `delivering`                      | supervisor, admin                              |
| Ver lista de choferes (`GET /users/drivers`)                | supervisor, admin                              |
| Ver estadísticas / dashboard                                | supervisor, manager, admin                     |
| Ver historial de eventos de un envío (auditoría)            | todos los roles autenticados                   |
| Crear usuarios Supervisor                                   | admin — **no implementado aún**                |

---

## Transiciones de estado habilitadas

El Supervisor puede ejecutar **cualquier transición válida** de la máquina de estados, sin excepción:

| Transición                                      | Requisito adicional                          |
|-------------------------------------------------|----------------------------------------------|
| `in_progress → in_transit`                      | `location` requerido (ciudad destino)        |
| `in_transit → at_branch`                        | auto-derivado                                |
| `at_branch → in_transit`                        | `location` requerido (próxima ciudad)        |
| `at_branch → delivering`                        | `driver_id` requerido                        |
| `at_branch → ready_for_pickup`                  | —                                            |
| `at_branch → ready_for_return`                  | envío debe estar en sucursal de origen       |
| `delivering → delivered`                        | `recipient_dni` requerido y debe coincidir   |
| `delivering → delivery_failed`                  | `notes` requerido                            |
| `delivery_failed → delivering`                  | `driver_id` requerido                        |
| `delivery_failed → at_branch`                   | auto-derivado                                |
| `ready_for_pickup → delivered`                  | `recipient_dni` requerido y debe coincidir   |
| `ready_for_pickup → in_transit`                 | `location` requerido                         |
| `ready_for_return → returned`                   | `sender_dni` requerido y debe coincidir      |

---

## Auditoría

El historial completo de eventos de cada envío (`GET /shipments/:id/events`) es accesible para todos los roles autenticados. Cada evento registra: estado anterior, estado nuevo, usuario responsable, ubicación y notas.

---

## Comportamiento del frontend

1. El panel de actualización de estado en `ShipmentDetail` es visible solo para Supervisor y Admin.
2. Al seleccionar `delivering` en el panel, aparece un dropdown con los choferes disponibles obtenido de `GET /api/v1/users/drivers`.
3. Al seleccionar `delivered`, aparece un campo de DNI del destinatario (requerido).
4. Al seleccionar `returned`, aparece un campo de DNI del remitente (requerido).
5. Al seleccionar `delivery_failed`, aparece un campo de notas (requerido).
6. El enlace Dashboard es visible en la navegación.
7. El botón "+ New Shipment" es visible.

---

## Gestión de usuarios Supervisor (no implementado)

En el estado actual el sistema tiene un único Supervisor hardcodeado. La gestión de usuarios por parte del Admin (crear, editar, desactivar cuentas de Supervisor) es una funcionalidad pendiente de implementar. Cuando se implemente, deberá cumplir:

1. Solo el Admin puede crear cuentas de Supervisor (`POST /api/v1/users`).
2. El Admin define username, contraseña y rol en el momento del alta.
3. El nuevo usuario puede autenticarse con `POST /api/v1/auth/login` inmediatamente.
4. El sistema rechaza con `403 Forbidden` cualquier intento de un no-Admin de crear usuarios.

---

## Escenarios

### CA1 — Login del Supervisor

- **Dado** que existe el usuario `supervisor / supervisor123` con rol `supervisor`
- **Cuando** hace `POST /api/v1/auth/login`
- **Entonces** responde `200 OK` con token y `role: supervisor`

### CA2 — Supervisor ve el panel de actualización de estado

- **Dado** que el Supervisor está autenticado y abre el detalle de un envío
- **Cuando** el envío tiene transiciones disponibles
- **Entonces** el panel de actualización de estado es visible
- **Y** puede seleccionar cualquier estado válido para la transición actual

### CA3 — Supervisor asigna chofer al mover a delivering

- **Dado** que el envío está en `at_branch`
- **Cuando** el Supervisor selecciona `delivering` en el panel
- **Entonces** aparece un dropdown de choferes obtenido de `GET /api/v1/users/drivers`
- **Y** el botón de confirmación está deshabilitado hasta que se seleccione un chofer

### CA4 — Supervisor confirma entrega con DNI correcto

- **Dado** que el envío está en `delivering` con `recipient_dni: "30123456"`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "delivered", "recipient_dni": "30123456" }`
- **Entonces** responde `200 OK` con `status: delivered` y `delivered_at` registrado

### CA5 — Supervisor confirma entrega con DNI incorrecto

- **Dado** que el envío está en `delivering`
- **Cuando** el Supervisor hace `PATCH` con `recipient_dni` incorrecto
- **Entonces** responde `400 Bad Request` con `"El DNI no coincide con el del destinatario esperado"`
- **Y** el estado del envío no cambia

### CA6 — Supervisor registra intento fallido

- **Dado** que el envío está en `delivering`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "delivery_failed", "notes": "Destinatario ausente" }`
- **Entonces** responde `200 OK` con `status: delivery_failed`

### CA7 — Supervisor intenta registrar intento fallido sin notas

- **Dado** que el envío está en `delivering`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "delivery_failed" }` sin `notes`
- **Entonces** responde `400 Bad Request`

### CA8 — Supervisor marca envío como ready_for_pickup

- **Dado** que el envío está en `at_branch`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "ready_for_pickup" }`
- **Entonces** responde `200 OK` con `status: ready_for_pickup`

### CA9 — Supervisor marca envío como ready_for_return en sucursal de origen

- **Dado** que el envío está en `at_branch` y la sucursal actual coincide con `receiving_branch_id`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "ready_for_return" }`
- **Entonces** responde `200 OK` con `status: ready_for_return`

### CA10 — Supervisor intenta ready_for_return en sucursal que no es la de origen

- **Dado** que el envío está en `at_branch` en una sucursal diferente a la de origen
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "ready_for_return" }`
- **Entonces** responde `400 Bad Request` indicando que el envío no está en la sucursal de origen

### CA11 — Supervisor confirma retiro por remitente con DNI correcto

- **Dado** que el envío está en `ready_for_return` con `sender_dni: "27845123"`
- **Cuando** el Supervisor hace `PATCH` con `{ "status": "returned", "sender_dni": "27845123" }`
- **Entonces** responde `200 OK` con `status: returned`

### CA12 — Supervisor accede al dashboard y estadísticas

- **Dado** que el Supervisor está autenticado
- **Cuando** navega a `/dashboard`
- **Entonces** ve el tablero con estadísticas de envíos
- **Y** el enlace Dashboard es visible en la navegación

### CA14 — Supervisor cancela un envío activo

- **Dado** que el envío está en un estado intermedio (ej. `in_transit`)
- **Cuando** el Supervisor hace `POST /cancel` con `{ "reason": "Cliente solicitó cancelación" }`
- **Entonces** responde `200 OK` con `status: cancelled`
- **Y** se registra un evento con `from_status: "in_transit"`, `to_status: "cancelled"`
- **Y** se agrega un comentario automático: `[Cancelación] Cliente solicitó cancelación`

### CA15 — Supervisor no puede cancelar un envío finalizado

- **Dado** que el envío está en `delivered`, `returned` o `cancelled`
- **Cuando** el Supervisor intenta `POST /cancel`
- **Entonces** responde `400 Bad Request`

### CA16 — Supervisor no puede cancelar un borrador

- **Dado** que el envío está en `pending`
- **Cuando** el Supervisor intenta `POST /cancel`
- **Entonces** responde `400 Bad Request` (los borradores se eliminan, no se cancelan)

### CA13 — Supervisor ve auditoría completa de un envío

- **Dado** que un envío tiene múltiples eventos registrados
- **Cuando** el Supervisor accede a `GET /shipments/:id/events`
- **Entonces** recibe el historial completo de eventos en orden cronológico
- **Y** cada evento incluye: estado anterior, estado nuevo, usuario, ubicación y notas
