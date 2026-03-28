# US-015 — Ver historial completo de estados de un envío

**Estado:** Implementada

## Actor principal
Todos los roles autenticados (el historial es visible en `ShipmentDetail` para cualquier rol).

> La US dice "Como Supervisor", pero la implementación expone el historial a todos los roles. Ver US-006 CA01.

## Descripción
La pantalla de detalle de un envío muestra el historial completo de eventos de estado: cada transición registrada con su timestamp, usuario y observaciones. El evento de creación siempre está presente.

---

## Reglas de negocio

1. Los eventos se obtienen de `GET /shipments/:tracking_id/events`.
2. El historial se muestra del más reciente al más antiguo (orden cronológico inverso).
3. Siempre existe al menos un evento: el de creación del envío (`"Shipment created"` o `"Draft saved"`).
4. La sección "Event History" se muestra aunque haya un solo evento (el de creación).
5. Si el array de eventos estuviera vacío (caso defensivo), se muestra `"No events recorded."`.
6. Los eventos de edición de datos (`event_type: "edited"`) también aparecen en el historial con `from_status == to_status == "in_progress"`.

---

## Campos mostrados por evento

| Campo | Condición |
|---|---|
| Transición (`from → to`) | Siempre. Si no hay `from_status`, muestra solo el `to_status` (evento de creación). |
| Timestamp | Siempre |
| Usuario (`changed_by`) | Siempre. Si está vacío, muestra `"system"`. |
| Ubicación | Solo si el evento tiene `location` |
| Observaciones (`notes`) | Solo si el evento tiene `notes` |

---

## Escenarios

### CA01 — Historial con múltiples transiciones

**Dado** un envío con trayecto `in_progress → in_transit → at_branch → delivering → delivered`
**Cuando** cualquier usuario abre `ShipmentDetail`
**Entonces** el historial muestra los 5 eventos (incluyendo el de creación)
**Y** cada uno tiene timestamp, usuario y transición de estado
**Y** el evento más reciente aparece primero

---

### CA02 — Envío recién confirmado (sin transiciones posteriores)

**Dado** un envío en estado `in_progress` que acaba de ser confirmado desde borrador
**Cuando** el supervisor abre el detalle
**Entonces** el historial muestra únicamente el evento de creación (`pending → in_progress`, notas: `"Shipment confirmed"`)
**Y** la sección está visible (no hay mensaje de "sin eventos")

---

### CA03 — Evento de creación directa

**Dado** un envío creado directamente (sin pasar por borrador)
**Cuando** se consulta el historial
**Entonces** el primer evento (mostrado al final de la lista) tiene `from_status: ""` y `to_status: "in_progress"` con notas `"Shipment created"`

---

### CA04 — Observaciones visibles en cada evento

**Dado** un evento con `notes: "Destinatario ausente — timbre no responde"`
**Cuando** se muestra el historial
**Entonces** esa nota aparece bajo la entrada del evento correspondiente

---

### CA05 — Evento de edición de datos

**Dado** que un supervisor editó los datos del envío (nombre, peso, etc.)
**Cuando** se muestra el historial
**Entonces** aparece un evento con `from_status: "in_progress"` y `to_status: "in_progress"` y notas `"Shipment data edited"`
