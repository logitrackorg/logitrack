# US-019 — Rol Operador

**Como** Administrador
**Quiero** dar de alta usuarios con el rol Operador
**Para** limitar sus permisos a tareas operativas de registro y consulta de envíos

---

## Descripción del rol

El Operador es el rol de entrada de datos del sistema. Puede crear envíos (directos o borradores), confirmar borradores y consultar el estado de cualquier envío, pero **no puede cambiar el estado de un envío ya confirmado** — esa responsabilidad recae en el Supervisor o Admin.

> **Nota sobre "modificar estados"**
> Los criterios de aceptación mencionan que el Operador puede "modificar estados". En la implementación actual esto se interpreta como la transición `pending → in_progress` producida al confirmar un borrador (`POST /shipments/:id/confirm`). El Operador **no puede** ejecutar transiciones de tránsito (`PATCH /shipments/:id/status`); esas son exclusivas de Supervisor, Admin y Driver.

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
| Cambiar estado de un envío confirmado               | supervisor, admin, driver — **no operator** |
| Ver estadísticas / dashboard                        | supervisor, manager, admin — **no operator** |
| Ver lista de choferes                               | supervisor, admin — **no operator**  |
| Crear usuarios Operador                             | admin — **no implementado aún**      |

---

## Comportamiento del frontend

1. El botón **"+ New Shipment"** es visible para el Operador.
2. El panel de actualización de estado en `ShipmentDetail` **no se muestra** para el Operador.
3. El enlace **Dashboard** no aparece en la navegación del Operador.
4. El Operador puede ver el detalle de cualquier envío (lectura), incluyendo el historial de eventos.
5. Si el Operador intenta acceder a `/dashboard` por URL directa, el frontend redirige a `/`.
6. En el detalle de un borrador, el Operador ve el panel de confirmación con el botón **"Confirmar envío"**.

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
- **Y** en el frontend no aparece el panel de actualización de estado

### CA7 — Operador intenta cambiar estado de un envío

- **Dado** que el Operador tiene un token válido
- **Cuando** hace `PATCH /api/v1/shipments/:id/status`
- **Entonces** responde `403 Forbidden`
- **Y** el estado del envío no cambia

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
