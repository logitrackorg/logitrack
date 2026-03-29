# US-019 — Rol Operador

**Como** Administrador
**Quiero** dar de alta usuarios con el rol Operador
**Para** limitar sus permisos a tareas operativas de registro y consulta de envíos

---

## Descripción del rol

El Operador es el rol operativo principal del sistema. Puede crear envíos (directos o borradores), confirmar borradores, cambiar el estado de envíos confirmados y agregar comentarios. No puede ejecutar la transición `delivering → delivered` (confirmar entrega tras intento de última milla), cancelar envíos, corregir datos ni acceder al dashboard de estadísticas. Sí puede ejecutar `ready_for_pickup → delivered` (retiro en sucursal).

> **Estado de implementación**
> El rol Operador y todas sus capacidades están completamente implementados.
> La creación de usuarios Operador por parte del Admin (gestión de usuarios) no está implementada — actualmente el único Operador es el usuario hardcodeado `operator / operator123`.

---

## Permisos

| Acción                                              | Roles habilitados                    |
|-----------------------------------------------------|--------------------------------------|
| Ver lista de envíos                                 | todos excepto driver                 |
| Ver detalle de un envío                             | todos los roles autenticados         |
| Ver historial de eventos de un envío                | todos los roles autenticados         |
| Buscar envíos                                       | todos excepto driver                 |
| Ver sucursales                                      | todos excepto driver                 |
| Crear envío directo (`POST /shipments`)             | operator, supervisor, admin          |
| Guardar borrador (`POST /shipments/draft`)          | operator, supervisor, admin          |
| Editar borrador (`PATCH /shipments/:id/draft`)      | operator, supervisor, admin          |
| Confirmar borrador (`POST /shipments/:id/confirm`)  | operator, supervisor, admin          |
| Cambiar estado de un envío confirmado               | operator, supervisor, admin, driver  |
| Confirmar entrega tras última milla (`delivering → delivered`) | supervisor, admin, driver — **no operator** |
| Confirmar retiro en sucursal (`ready_for_pickup → delivered`)  | operator, supervisor, admin, driver         |
| Cancelar un envío                                   | supervisor, admin — **no operator**  |
| Corregir datos de un envío                          | supervisor, admin — **no operator**  |
| Agregar comentario a un envío                       | operator, supervisor, admin          |
| Ver estadísticas / dashboard                        | supervisor, manager, admin — **no operator** |
| Ver lista de choferes                               | supervisor, admin — **no operator**  |
| Crear usuarios Operador                             | admin — **no implementado aún**      |

---

## Comportamiento del frontend

1. El botón **"+ New Shipment"** es visible para el Operador.
2. El panel de actualización de estado en `ShipmentDetail` **es visible** para el Operador. Cuando el envío está en `delivering`, la opción `Delivered` **no aparece** en el selector (filtrada client-side). En otros estados que permiten `→ delivered` (ej. `ready_for_pickup`), la opción sí aparece.
3. El botón **"✏️ Edit data"** (corrección de datos) **no se muestra** para el Operador.
4. El botón **"Cancel shipment"** **no se muestra** para el Operador.
5. El Operador puede ver y escribir comentarios en envíos no finalizados.
6. El enlace **Dashboard** no aparece en la navegación del Operador.
7. El Operador puede ver el detalle de cualquier envío (lectura), incluyendo el historial de eventos.
8. Si el Operador intenta acceder a `/dashboard` por URL directa, el frontend redirige a `/`.
9. En el detalle de un borrador, el Operador ve el panel de confirmación con el botón **"Confirmar envío"**.

---

## Flujos habilitados

### Flujo A — Crear envío directo

```
POST /api/v1/shipments   (todos los campos requeridos)
→ status: in_progress, tracking_id: LT-XXXXXXXX
→ redirect a /shipments/{tracking_id}
```

### Flujo B — Borrador y confirmación posterior

```
POST /api/v1/shipments/draft   (datos parciales)
→ status: pending, tracking_id: DRAFT-XXXXXXXX
→ redirect a /shipments/DRAFT-XXXXXXXX

PATCH /api/v1/shipments/DRAFT-XXXXXXXX/draft   (actualizar datos)
→ guarda cambios y redirige a /?status=pending

POST /api/v1/shipments/DRAFT-XXXXXXXX/confirm
→ si válido: status: in_progress, tracking_id: LT-XXXXXXXX
→ si inválido: 400 con campos faltantes
```

---

## Escenarios

### CA1 — Login del Operador

- **Dado** que existe el usuario `operator / operator123` con rol `operator`
- **Cuando** hace `POST /api/v1/auth/login`
- **Entonces** responde `200 OK` con token y `role: operator`
- **Y** el frontend redirige a `/`

### CA2 — Operador crea un envío directo

- **Dado** que el Operador tiene todos los datos del envío
- **Cuando** hace `POST /api/v1/shipments` con payload completo
- **Entonces** responde `201 Created` con `status: in_progress` y `tracking_id: LT-XXXXXXXX`
- **Y** el frontend redirige a `/shipments/{tracking_id}`

### CA3 — Operador guarda un borrador

- **Dado** que el Operador no tiene todos los datos aún
- **Cuando** hace `POST /api/v1/shipments/draft` con datos parciales
- **Entonces** responde `201 Created` con `status: pending` y `tracking_id: DRAFT-XXXXXXXX`
- **Y** el frontend redirige al detalle del borrador

### CA4 — Operador edita y confirma un borrador

- **Dado** que existe un borrador con todos los campos requeridos completos
- **Cuando** el Operador hace `POST /shipments/DRAFT-XXXXXXXX/confirm`
- **Entonces** responde `200 OK` con `status: in_progress` y un nuevo `tracking_id: LT-XXXXXXXX`
- **Y** el frontend redirige al nuevo tracking ID

### CA5 — Operador intenta confirmar borrador con datos incompletos

- **Dado** que el borrador tiene campos requeridos faltantes
- **Cuando** el Operador intenta confirmar
- **Entonces** responde `400 Bad Request` con detalle de campos faltantes
- **Y** el borrador permanece en `pending`

### CA6 — Operador consulta el detalle de un envío

- **Dado** que el Operador está autenticado
- **Cuando** hace `GET /api/v1/shipments/:id`
- **Entonces** responde `200 OK` con los datos del envío
- **Y** en el frontend aparece el panel de actualización de estado si hay transiciones disponibles

### CA7 — Operador cambia el estado de un envío

- **Dado** que el Operador tiene un token válido y el envío está en `in_progress`
- **Cuando** hace `PATCH /api/v1/shipments/:id/status` con `{ "status": "in_transit", "location": "Córdoba" }`
- **Entonces** responde `200 OK` con el envío actualizado
- **Y** se registra un `ShipmentEvent` con `changed_by` igual al usuario operator

### CA7d — Operador intenta confirmar entrega desde delivering

- **Dado** que el envío está en `delivering`
- **Cuando** el Operador hace `PATCH /api/v1/shipments/:id/status` con `{ "status": "delivered", "recipient_dni": "..." }`
- **Entonces** responde `403 Forbidden`
- **Y** el estado del envío no cambia
- **Y** en el frontend la opción `Delivered` no aparece en el selector

### CA7e — Operador confirma retiro en sucursal (ready_for_pickup → delivered)

- **Dado** que el envío está en `ready_for_pickup`
- **Cuando** el Operador hace `PATCH /api/v1/shipments/:id/status` con `{ "status": "delivered", "recipient_dni": "..." }` correcto
- **Entonces** responde `200 OK` con `status: delivered`
- **Y** en el frontend la opción `Delivered` sí aparece en el selector

### CA7b — Operador intenta cancelar un envío

- **Dado** que el Operador tiene un token válido
- **Cuando** hace `POST /api/v1/shipments/:id/cancel`
- **Entonces** responde `403 Forbidden`

### CA7c — Operador intenta corregir datos de un envío

- **Dado** que el Operador tiene un token válido
- **Cuando** hace `PATCH /api/v1/shipments/:id/correct`
- **Entonces** responde `403 Forbidden`

### CA8 — Operador intenta acceder al dashboard

- **Dado** que el Operador está autenticado
- **Cuando** navega directamente a `/dashboard` por URL
- **Entonces** el frontend redirige a `/`

### CA9 — Operador intenta acceder a estadísticas vía API

- **Dado** que el Operador tiene un token válido
- **Cuando** hace `GET /api/v1/stats`
- **Entonces** responde `403 Forbidden`

### CA10 — Operador busca envíos

- **Dado** que el Operador está autenticado
- **Cuando** hace `GET /api/v1/search?q=Juan`
- **Entonces** responde `200 OK` con los envíos que coincidan con la búsqueda
