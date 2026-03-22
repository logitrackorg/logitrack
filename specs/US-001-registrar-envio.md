# US-001 — Registrar un envío

**Como** Operador
**Quiero** registrar un envío
**Para** generar el tracking ID y comenzar el seguimiento

---

## Criterios de aceptación

1. El sistema asigna un tracking ID único y automático al confirmar el alta.
2. El envío se crea con estado inicial `in_progress` (confirmado, listo para despacho).
3. El tracking ID es visible en pantalla inmediatamente después de la creación.

---

## Modelo de datos

### Envío (Shipment)

| Campo                 | Tipo       | Notas                                                        |
|-----------------------|------------|--------------------------------------------------------------|
| `tracking_id`         | string     | `DRAFT-{8 hex}` en borradores. `LT-{8 hex}` al confirmar (reemplaza al DRAFT-). |
| `sender_name`         | string     | Requerido para confirmar                                     |
| `sender_dni`          | string     | Requerido para confirmar                                     |
| `sender_phone`        | string     | Requerido para confirmar                                     |
| `sender_email`        | string     | Opcional                                                     |
| `origin`              | Address    | `city` y `province` requeridos para confirmar               |
| `recipient_name`      | string     | Requerido para confirmar                                     |
| `recipient_dni`       | string     | Requerido para confirmar. Validado por el backend al momento de la entrega. |
| `recipient_phone`     | string     | Requerido para confirmar                                     |
| `recipient_email`     | string     | Opcional                                                     |
| `destination`         | Address    | `city` y `province` requeridos para confirmar               |
| `weight_kg`           | float      | Requerido para confirmar (> 0)                               |
| `package_type`        | enum       | `envelope` / `box` / `pallet` / `fragile`. Requerido para confirmar |
| `special_instructions`| string     | Opcional                                                     |
| `receiving_branch_id` | string     | Sucursal receptora. Requerido para crear envío directo (binding). Validado en frontend al confirmar borrador. |
| `status`              | enum       | Ver estados más abajo                                        |
| `current_location`    | string     | Ciudad de la sucursal receptora al crear. Ciudad de la última sucursal luego. |
| `created_at`          | datetime   | Generado automáticamente                                     |
| `estimated_delivery_at`| datetime  | `created_at + 7 días`                                       |
| `delivered_at`        | datetime   | Solo presente al alcanzar `delivered`                        |

### Dirección (Address)

| Campo        | Tipo   | Notas                      |
|--------------|--------|----------------------------|
| `street`     | string | Opcional                   |
| `city`       | string | Requerido para confirmar   |
| `province`   | string | Requerido para confirmar   |
| `postal_code`| string | Opcional                   |

### Estados del ciclo de vida del envío

| Estado        | Significado                                                                 |
|---------------|-----------------------------------------------------------------------------|
| `pending`     | **Borrador** — datos parciales, sin tracking ID. No ingresó al sistema logístico. |
| `in_progress` | **Confirmado** — todos los datos completos, tracking ID asignado, listo para despacho. |
| `in_transit`  | En camino hacia una sucursal                                                |
| `at_branch`   | Recibido en una sucursal intermedia o de destino                            |
| `delivering`        | En reparto de última milla hacia el destinatario                            |
| `delivered`         | Entregado al destinatario (estado final)                                    |
| `delivery_failed`   | Intento de entrega fallido. El supervisor decide el siguiente paso.         |
| `ready_for_pickup`  | El destinatario puede retirar el paquete en la sucursal actual.             |
| `ready_for_return`  | El remitente puede retirar el paquete en la sucursal de origen (solo válido en la sucursal receptora inicial). |
| `returned`          | El remitente retiró el paquete (estado final).                              |

---

## Flujos

### Flujo A — Crear envío directo (todos los datos disponibles)

```
POST /api/v1/shipments   (campos requeridos validados por el servidor)
→ status: in_progress
→ tracking_id: LT-XXXXXXXX
→ redirect a /shipments/{tracking_id}
```

### Flujo B — Guardar borrador y retomar después

```
POST /api/v1/shipments/draft   (sin validación de campos requeridos)
→ status: pending
→ tracking_id: DRAFT-XXXXXXXX (identificador temporario interno)
→ redirect a /shipments/DRAFT-XXXXXXXX

... más tarde ...

POST /api/v1/shipments/{draft_id}/confirm
→ valida campos requeridos
→ si válido: status: in_progress, tracking_id: LT-XXXXXXXX, redirect al nuevo tracking ID
→ si inválido: 400 con detalle de campos faltantes
```

---

## Permisos

| Acción                   | Roles habilitados                    |
|--------------------------|--------------------------------------|
| Guardar borrador         | operator, supervisor, admin          |
| Crear envío directo      | operator, supervisor, admin          |
| Confirmar borrador       | operator, supervisor, admin          |
| Ver detalle del envío    | todos los roles autenticados         |

---

## Escenarios

### CA1 — Crear envío con todos los campos válidos

- **Dado** que el usuario tiene rol `operator`, `supervisor` o `admin`
- **Cuando** hace `POST /shipments` con todos los campos requeridos completos
- **Entonces** el servidor responde `201 Created` con el envío creado
- **Y** el envío tiene `status: in_progress` y un `tracking_id` con formato `LT-XXXXXXXX`
- **Y** el frontend redirige a `/shipments/{tracking_id}`
- **Y** el tracking ID es visible en pantalla

### CA2 — Crear envío con campos faltantes (creación directa)

- **Dado** que el usuario hace `POST /shipments` sin un campo requerido (ej: `sender_name`)
- **Cuando** el servidor valida el payload
- **Entonces** responde `400 Bad Request` con detalle del error
- **Y** no se crea ningún envío

> Nota: `sender_dni` y `recipient_dni` también son campos requeridos para confirmar.

### CA3 — Guardar borrador con datos parciales

- **Dado** que el usuario tiene rol `operator`, `supervisor` o `admin`
- **Cuando** hace `POST /shipments/draft` con datos parciales (puede ser payload vacío)
- **Entonces** el servidor responde `201 Created` con el borrador
- **Y** el envío tiene `status: pending` y un `tracking_id` con formato `DRAFT-XXXXXXXX`
- **Y** el frontend redirige al detalle del borrador

### CA4 — Confirmar borrador con todos los datos completos

- **Dado** que existe un borrador (`status: pending`) con todos los campos requeridos completos
- **Cuando** el usuario hace `POST /shipments/{draft_id}/confirm`
- **Entonces** el servidor responde `200 OK` con el envío confirmado
- **Y** el envío tiene `status: in_progress` y un nuevo `tracking_id` con formato `LT-XXXXXXXX`
- **Y** el `DRAFT-XXXXXXXX` anterior deja de ser accesible
- **Y** el frontend redirige al nuevo tracking ID

### CA5 — Confirmar borrador con datos incompletos

- **Dado** que existe un borrador con campos requeridos faltantes
- **Cuando** el usuario intenta `POST /shipments/{draft_id}/confirm`
- **Entonces** el servidor responde `400 Bad Request`
- **Y** el mensaje de error indica qué campos faltan
- **Y** el borrador permanece en estado `pending`

### CA6 — Confirmar un envío que no es borrador

- **Dado** que un envío ya tiene `status: in_progress` (u otro posterior)
- **Cuando** se intenta `POST /shipments/{id}/confirm`
- **Entonces** el servidor responde `400 Bad Request` con mensaje `"only draft shipments can be confirmed"`

### CA7 — Visualización del borrador en la lista

- **Dado** que existen borradores guardados
- **Cuando** el usuario accede a la lista de envíos
- **Entonces** los borradores aparecen con badge "Draft" y sin tracking ID en la columna correspondiente
- **Y** el filtro "Draft" los muestra exclusivamente

### CA8 — Botón de confirmación en el detalle del borrador

- **Dado** que el usuario con rol `operator`, `supervisor` o `admin` abre el detalle de un borrador
- **Cuando** visualiza la pantalla
- **Entonces** ve un panel destacado con botón "Confirmar envío"
- **Y** el panel indica que debe verificar que los datos estén completos antes de confirmar
