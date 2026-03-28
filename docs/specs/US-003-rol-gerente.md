# US-003 — Rol Gerente

**Como** Administrador
**Quiero** definir el rol Gerente
**Para** que pueda consultar tableros y reportes sin operar envíos

---

## Descripción del rol

El Gerente (`manager`) es un rol de solo lectura orientado a visibilidad de negocio. Accede a métricas, estadísticas y tableros, pero no puede crear ni modificar ningún envío.

---

## Permisos

| Acción                              | Roles habilitados                              |
|-------------------------------------|------------------------------------------------|
| Ver lista de envíos                 | todos excepto driver                           |
| Ver detalle de un envío             | todos los roles autenticados                   |
| Buscar envíos                       | todos excepto driver                           |
| Ver sucursales                      | todos excepto driver                           |
| Ver estadísticas / dashboard        | supervisor, manager, admin                     |
| Crear envío (directo o borrador)    | operator, supervisor, admin — **no manager**  |
| Confirmar borrador                  | operator, supervisor, admin — **no manager**  |
| Cambiar estado de un envío          | supervisor, admin — **no manager**            |

---

## Reglas de negocio

1. El servidor rechaza con `403 Forbidden` cualquier intento del Gerente de invocar un endpoint de escritura (`POST /shipments`, `POST /shipments/draft`, `POST /shipments/:id/confirm`, `PATCH /shipments/:id/status`).
2. El Gerente puede autenticarse con `POST /api/v1/auth/login` exactamente igual que cualquier otro rol.
3. El token del Gerente es válido para todos los endpoints de solo lectura.

---

## Comportamiento del frontend

1. El botón **"+ Nuevo envío"** no se muestra para el Gerente.
2. El panel de actualización de estado en `ShipmentDetail` no se muestra para el Gerente.
3. El enlace **Dashboard** en la navegación sí se muestra para el Gerente.
4. Si el Gerente intenta acceder a `/new` directamente por URL, el frontend redirige a `/`.

---

## Escenarios

### CA1 — Login del Gerente

- **Dado** que existe el usuario `gerente / gerente123` con rol `manager`
- **Cuando** hace `POST /api/v1/auth/login` con esas credenciales
- **Entonces** el servidor responde `200 OK` con un token válido y `role: manager`

### CA2 — Gerente accede al dashboard

- **Dado** que el usuario tiene rol `manager` y está autenticado
- **Cuando** navega a `/dashboard`
- **Entonces** el frontend muestra el tablero con estadísticas y métricas
- **Y** el enlace Dashboard es visible en la navegación

### CA3 — Gerente intenta crear un envío desde el frontend

- **Dado** que el usuario tiene rol `manager` y está autenticado
- **Cuando** visualiza la lista de envíos
- **Entonces** el botón "+ Nuevo envío" no aparece en la pantalla

### CA4 — Gerente intenta acceder a `/new` por URL directa

- **Dado** que el usuario tiene rol `manager` y está autenticado
- **Cuando** navega directamente a `/new`
- **Entonces** el frontend redirige a `/`

### CA5 — Gerente intenta crear un envío vía API directamente

- **Dado** que el usuario tiene rol `manager` y un token válido
- **Cuando** hace `POST /api/v1/shipments` con payload válido
- **Entonces** el servidor responde `403 Forbidden`
- **Y** no se crea ningún envío

### CA6 — Gerente intenta cambiar estado de un envío vía API directamente

- **Dado** que el usuario tiene rol `manager` y un token válido
- **Cuando** hace `PATCH /api/v1/shipments/:id/status`
- **Entonces** el servidor responde `403 Forbidden`
- **Y** el estado del envío no cambia

### CA7 — Gerente ve la lista y el detalle de envíos

- **Dado** que el usuario tiene rol `manager` y está autenticado
- **Cuando** navega a `/` o a `/shipments/:trackingId`
- **Entonces** ve la lista y el detalle normalmente
- **Y** el panel de actualización de estado no aparece en el detalle
