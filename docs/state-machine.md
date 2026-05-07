# Máquina de estados de envíos

## Estados

| Estado | Etiqueta UI | Descripción |
|--------|-------------|-------------|
| `draft` | Borrador | Borrador — datos parciales, sin tracking ID definitivo. Editable. No cancellable. |
| `at_origin_hub` | En sucursal de origen | Confirmado e ingresado a la sucursal de origen. Cancellable. |
| `loaded` | Enviar a sucursal | Cargado en vehículo, listo para partir. **Auto-activado** por `POST /vehicles/by-plate/:plate/assign` — no se envía manualmente vía `PATCH /status`. No cancellable. |
| `in_transit` | En tránsito | En movimiento entre sucursales. **Auto-activado** por `POST /vehicles/by-plate/:plate/start-trip` — no se envía manualmente vía `PATCH /status`. No cancellable. |
| `at_hub` | En sucursal / En sucursal de destino | En sucursal intermedia o de destino. Cuando `current_location == final_branch_id` se muestra como "En sucursal de destino". Cancellable. |
| `out_for_delivery` | Última milla | Salió para entrega a domicilio. No cancellable. |
| `delivered` | Entregado | Entregado exitosamente. **Estado terminal.** |
| `delivery_failed` | Entrega fallida | Intento de entrega fallido. |
| `redelivery_scheduled` | Reentrega agendada | Nueva entrega programada tras un fallo. |
| `rechazado` | Rechazado | El destinatario rechazó recibir el envío. |
| `ready_for_pickup` | Listo para retiro | El destinatario retira en sucursal. Cancellable. |
| `ready_for_return` | Listo para devolución | Listo para ser devuelto al remitente. `current_location` debe coincidir con la ciudad de la sucursal receptora. |
| `returned` | Devuelto | Devuelto al remitente. **Estado terminal.** |
| `cancelled` | Cancelado | Cancelado con motivo obligatorio. **Estado terminal.** |
| `lost` | Extraviado | Extraviado. **Estado terminal.** |
| `destroyed` | Destruido | Daño total irreversible. **Estado terminal.** |

---

## Diagrama de transiciones

[DIAGRAM](https://miro.com/app/board/uXjVGtApDew=/)

---

## Transiciones válidas

```
draft ──confirm──► at_origin_hub ──[assign vehicle]──► loaded ──[start-trip]──► in_transit
                       │                                  │                          │
                       │                           [unassign]                        ▼
                       │                        ◄──────────────            at_hub / at_origin_hub
                       │                                                             │
                       │                          ┌──────────────────────────────────┤
                       │                          │                                  │
                       │                          ▼                                  ▼
                       │                  out_for_delivery                   ready_for_pickup ──► delivered
                       │                          │                          │                └► [vehicle] loaded
                       │                          ├──► delivered             └► no entregado ──► at_hub / at_origin_hub
                       │                          ├──► delivery_failed
                       │                          │         │
                       │                          │         ├──► redelivery_scheduled ──► out_for_delivery (retry)
                       │                          │         ├──► ready_for_pickup ──► delivered
                       │                          │         │                     └─► no_entregado ──► at_hub / at_origin_hub
                       │                          │         └──► rechazado ──► at_hub / at_origin_hub
                       │                          ├──► lost        (terminal)
                       │                          └──► destroyed   (terminal)
                       │
                       └──► [is_returning=true] ──► ready_for_return ──► returned (terminal)

Desde cualquier hub (at_hub / at_origin_hub):
  → lost       (terminal)
  → destroyed  (terminal)
  → ready_for_return  (si is_returning=true, auto en at_origin_hub)
```

---

## Reglas de negocio

**Estados terminales** — ninguna transición posterior es posible:
`delivered`, `returned`, `cancelled`, `lost`, `destroyed`

**Cancellable únicamente desde**: `at_origin_hub`, `at_hub`, `ready_for_pickup`  
**No cancellable**: `draft`, `loaded`, `in_transit` y todos los estados terminales.

**Límite de reintentos de entrega**: configurable en `system_config.max_delivery_attempts` (default 3, rango 1–10).  
Cuando se alcanza el límite, desde `delivery_failed` solo se puede ir a `ready_for_pickup` o `rechazado`.

**Devolución automática**: cuando un envío llega a `at_origin_hub` con `is_returning=true`, el sistema lo promueve automáticamente a `ready_for_return`.

**`ready_for_return`**: el campo `current_location` debe coincidir con la ciudad de la sucursal receptora para poder efectuar la transición (validación server-side).

**Validación de DNI en entrega**:
- `→ delivered`: requiere `recipient_dni` que coincida con el del envío.
- `→ returned`: requiere `sender_dni` que coincida con el del envío.

**`in_transit` nunca va directo a `delivered`**: siempre pasa por `at_hub` o `at_origin_hub` antes.

**`out_for_delivery`** solo puede ir a: `delivered`, `delivery_failed`, `lost`, `destroyed`.

**`loaded`** revierte a `at_origin_hub` o `at_hub` si el envío es desasignado del vehículo.

---

## Quién puede cambiar cada estado

| Transición | Operador | Supervisor | Chofer |
|---|---|---|---|
| `draft → at_origin_hub` (confirmar) | ✅ | ✅ | ❌ |
| `at_origin_hub → loaded` (asignar vehículo) | ✅ | ✅ | ❌ |
| `loaded → in_transit` (start-trip) | ✅ | ✅* | ❌ |
| `in_transit → at_hub` (end-trip) | ✅ | ✅* | ❌ |
| `at_hub → out_for_delivery` | ❌ | ✅ | ❌ |
| `out_for_delivery → delivered / delivery_failed` | ❌ | ✅ | ✅** |
| `ready_for_pickup → delivered` | ✅ | ✅ | ❌ |
| Cancelar | ❌ | ✅ | ❌ |

\* Supervisor: solo en vehículos de su sucursal.  
\*\* Chofer: solo envíos en su ruta del día.
