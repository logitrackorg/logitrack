# US-006 — Detalle completo del envío

**Estado:** Implementada

## Actor principal
Operador (consulta). Supervisor y Admin (consulta + cambio de estado). Manager y Driver (consulta).

## Descripción
Cualquier usuario autenticado puede acceder al detalle completo de un envío. El detalle expone toda la información del envío y su historial de eventos.

---

## Datos mostrados

### Información del envío (todos los roles)
| Sección | Campos |
|---|---|
| Encabezado | Tracking ID, StatusBadge (estado actual), botón "✏️ Editar datos" (supervisor/admin, envíos no pendientes ni finalizados) |
| Remitente | Nombre, teléfono, email (si existe), DNI, dirección de origen completa |
| Destinatario | Nombre, teléfono, email (si existe), DNI, dirección de destino completa |
| Paquete | Tipo, peso (kg), instrucciones especiales (si existen) |
| Fechas y ubicación | Fecha de creación, fecha estimada de entrega, fecha de entrega real (si existe), ubicación actual |
| Ruta (timeline) | Nodos de tránsito con ciudad + provincia de cada sucursal |

Los campos con corrección activa (ver US-009) muestran el valor corregido con badge **"Modificado"** y el valor original tachado en gris.

### Comentarios (columna derecha)
Sección de comentarios internos ubicada en una columna a la derecha del contenido principal. Muestra todos los comentarios del envío (autor, timestamp, cuerpo). Supervisor y Admin pueden agregar comentarios en envíos no finalizados. Incluye los comentarios automáticos generados por correcciones de datos.

### Historial de eventos (todos los roles)
Cada evento muestra:
- Transición de estado (`from_status → to_status`), o `event_type: "edited"` para correcciones de datos
- Timestamp (fecha y hora)
- Usuario (`changed_by`)
- Ubicación (si aplica)
- Observaciones / notas (si aplica)

---

## Reglas de negocio

1. El endpoint `GET /shipments/:tracking_id` está disponible para todos los roles autenticados.
2. El endpoint `GET /shipments/:tracking_id/events` está disponible para todos los roles autenticados.
3. Si el envío no existe, el servidor responde 404.
4. El panel "Update Status" solo se renderiza para supervisor y admin (cuando hay transiciones disponibles).
5. Si el envío está en estado `pending` (borrador), se muestra el formulario de edición de borrador en lugar del detalle de solo lectura (para roles con permiso de creación).
6. El historial se ordena del más reciente al más antiguo en el frontend.
7. El botón "✏️ Editar datos" solo aparece para supervisor y admin, y solo en envíos que no son `pending`, `delivered` ni `returned`.
8. Los comentarios se muestran en una columna lateral derecha, separada del contenido principal.

---

## Escenarios

### CA01 — Operador ve el detalle completo

**Dado** un envío confirmado (`in_progress` o posterior)
**Y** el usuario es operador
**Cuando** accede a `/shipments/:tracking_id`
**Entonces** ve el tracking ID, remitente, destinatario, origen, destino, estado actual y fecha de creación
**Y** también ve el historial de eventos con timestamps y usuarios
**Y** **no** ve el panel "Update Status"

---

### CA02 — Supervisor ve el historial con observaciones

**Dado** un envío con eventos que incluyen notas (ej: intento fallido con motivo)
**Y** el usuario es supervisor
**Cuando** accede al detalle
**Entonces** el historial muestra cada evento con su transición, timestamp, usuario, ubicación y observaciones

---

### CA03 — Tracking ID no existe

**Dado** un `tracking_id` inexistente
**Cuando** cualquier usuario autenticado hace `GET /shipments/:tracking_id`
**Entonces** el servidor responde 404
**Y** el frontend muestra el mensaje de error y un botón "← Back to list"

---

### CA04 — Supervisor ve panel de cambio de estado

**Dado** un envío en estado `at_branch`
**Y** el usuario es supervisor
**Cuando** accede al detalle
**Entonces** ve el panel "Update Status" con los botones de transición válidos
**Y** no ve este panel para estados terminales (`delivered`, `returned`)

---

### CA05 — Manager y Driver solo pueden consultar

**Dado** un envío en cualquier estado
**Cuando** un usuario con rol `manager` o `driver` accede al detalle
**Entonces** puede ver toda la información y no ve el panel "Update Status"

> **Nota sobre el Driver**: a nivel API, el driver puede acceder a `GET /shipments/:id` y `GET /shipments/:id/events`. Sin embargo, en el frontend, `DriverShipmentDetail` (vista del driver) muestra únicamente datos del paquete y del destinatario — **no muestra el historial de eventos**. Ver US-004 CA23.
