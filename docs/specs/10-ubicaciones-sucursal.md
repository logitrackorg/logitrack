# Ubicaciones en Sucursal (Branch Locations)

## Resumen

Permitir que una sucursal gestione físicamente los envíos dividiendo el espacio en 4 zonas con comportamientos de negocio bien definidos. Cada envío dentro de una sucursal registra su `current_zone`, y los movimientos entre zonas generan eventos de dominio trazables.

No hay subzonas dentro de Salida: el sistema determina automáticamente el tipo de despacho según el contexto del envío (sucursal intermedia → transferencia; sucursal final + `ultima_milla` → reparto; sucursal final + `retiro_sucursal` → mostrador).

### Zonas

| Zona | Tipo | Comportamiento |
|------|------|----------------|
| Entrada | `receiving` | Recepción automática al finalizar viaje. Requiere revisión del operador. |
| Salida | `dispatch` | Envíos listos para despachar. El tipo de despacho se resuelve al accionar: transferencia, última milla o mostrador. |
| Revisión | `inspection` | Envíos con incidencias. Solo supervisor puede mover. |
| Listo para devolución | `return` | Envíos clasificados formalmente para devolución (`status = ready_for_return`). |

### Mapa de transiciones entre zonas

```
┌──────────┐
│ Entrada  │ ──(operador, sin daños)──► Salida
│          │ ──(operador, con daños)──► Revisión
└──────────┘

┌──────────┐
│ Salida   │ ──(operador detecta daño)──► Revisión
│          │ 
└──────────┘

┌──────────┐
│ Revisión │ ──(supervisor aprueba)──► Salida
│          │ ──(supervisor clasifica pérdida total)──► lost / destroyed
│          │
└──────────┘

┌───────────────────┐
│ Listo para        │ ──(operador inicia retorno)──► [despacho: loaded/in_transit]
│ devolución        │
└───────────────────┘

┌──────────┐
│ Cancelado│ ──(sistema, al cancelar)──► Listo para devolución
│ / Fallido │
└──────────┘
```

### Determinación del tipo de despacho desde Salida

| Contexto del envío | Acción del sistema al despachar |
|---|---|
| `current_location ≠ final_branch_id` (sucursal intermedia) | Asignar a vehículo inter-sucursal → `loaded` / `in_transit` |
| `current_location == final_branch_id` + `ultima_milla` | Asignar a vehículo de reparto → `out_for_delivery` |
| `current_location == final_branch_id` + `retiro_sucursal` | Entregar en mostrador (verificar DNI) → `delivered` |

---

## US-01: Inicialización automática de zonas al crear sucursal

**Detalles clave**

Cada sucursal activa necesita 4 zonas predefinidas. Se crean automáticamente al activar la sucursal y se mantienen sincronizadas con su ciclo de vida.

**Descripción**

Como **administrador** quiero que al crear o activar una sucursal el sistema genere automáticamente sus zonas (Entrada, Salida, Revisión, Listo para devolución) para que los operadores puedan gestionar ubicaciones desde el primer día sin configuración manual.

**#: CA-01**
**Dado:** una sucursal nueva con `status = activo`
**Cuando:** el sistema completa la creación de la sucursal
**Entonces:** se crean 4 registros de zona (Entrada, Salida, Revisión, Listo para devolución), todas con `active = true`

**#: CA-02**
**Dado:** una sucursal existente con zonas activas
**Cuando:** un administrador cambia su `status` a `inactivo`
**Entonces:** todas las zonas de esa sucursal se marcan como `active = false` y ningún endpoint las incluye en resultados

**#: CA-03**
**Dado:** una sucursal inactiva con zonas archivadas
**Cuando:** un administrador reactiva la sucursal (`status = activo`)
**Entonces:** todas las zonas previamente archivadas se restauran a `active = true`

**#: CA-04**
**Dado:** tablas vacías en base de datos (primera ejecución)
**Cuando:** el seed de inicio se ejecuta
**Entonces:** se crean las 4 zonas para cada sucursal con `status = activo` de forma idempotente (no duplica si ya existen)

---

## US-02: Recepción automática en Entrada al finalizar viaje

**Detalles clave**

Cuando un vehículo completa un viaje (`end-trip`) todos sus envíos llegan a la sucursal de destino. El sistema registra automáticamente cada envío en la zona Entrada.

**Descripción**

Como **sistema** quiero asignar automáticamente la zona `Entrada` a un envío cuando llega a una sucursal al finalizar un viaje (`end-trip`) para que el operador sepa qué paquetes están pendientes de revisión física.

**#: CA-01**
**Dado:** un vehículo en tránsito con envíos asignados con destino a una sucursal
**Cuando:** el conductor finaliza el viaje (`end-trip`) y los envíos pasan a `at_hub` / `at_origin_hub`
**Entonces:** cada envío registra `current_zone = "entrada"` en la sucursal de destino

**#: CA-02**
**Dado:** un envío que llega a una sucursal intermedia
**Cuando:** el sistema le asigna `at_hub` al finalizar el viaje
**Entonces:** igualmente se asigna `current_zone = "entrada"` hasta que el operador lo mueva a Salida para su próxima transferencia

**#: CA-03**
**Dado:** un envío en zona Entrada
**Cuando:** un operador intenta despacharlo manualmente (asignarlo a vehículo, ponerlo `out_for_delivery`, etc.)
**Entonces:** el sistema bloquea con `"El envío debe ser movido a Salida antes de despacharlo"`

---

## US-03: Movimiento manual de envíos entre zonas

**Detalles clave**

El operador mueve físicamente los paquetes entre zonas: de Entrada a Salida (si está en buen estado), de Entrada a Revisión (si hay daños), de Salida a Revisión (control de calidad), y de Salida a Entrada (reingreso por mostrador no concretado). No se permite mover directamente a Listo para devolución desde Entrada o Salida sin pasar por Revisión.

**Descripción**

Como **operador** quiero mover un envío entre zonas (Entrada → Salida, Entrada → Revisión, Salida → Revisión, Salida → Entrada) para reflejar su ubicación física real en la sucursal.

**#: CA-01 — Entrada → Salida (reenvío normal)**
**Dado:** un envío en zona Entrada de la sucursal del operador, sin daños visibles
**Cuando:** el operador selecciona "Mover a Salida"
**Entonces:** el envío cambia a `current_zone = "salida"` y queda disponible para despacho

**#: CA-02 — Entrada → Revisión (incidencia)**
**Dado:** un envío en zona Entrada con el embalaje dañado (operador detecta incidencia)
**Cuando:** el operador selecciona "Mover a Revisión" y opcionalmente registra un comentario
**Entonces:** el envío cambia a `current_zone = "revision"` con estado "Pendiente de inspección"

**#: CA-03 — Salida → Revisión (control de calidad)**
**Dado:** un envío en zona Salida
**Cuando:** el operador detecta un problema (fuga, rotura, etc.) y selecciona "Mover a Revisión"
**Entonces:** el envío cambia a `current_zone = "revision"` y queda congelado hasta inspección de supervisor

**#: CA-05 — Bloqueo: Salida → Listo para devolución directo**
**Dado:** un envío en Entrada o Salida
**Cuando:** el operador intenta moverlo directamente a `Listo para devolución`
**Entonces:** el sistema rechaza con `"Debe pasar por Revisión antes de clasificar como devolución"`

**#: CA-06 — Branch scope**
**Dado:** un envío en zona de otra sucursal
**Cuando:** un operador de sucursal distinta intenta moverlo
**Entonces:** `403 FORBIDDEN`

---

## US-04: Inspección y resolución desde zona Revisión (solo supervisor)

**Detalles clave**

Los envíos en Revisión tienen incidencias. Solo un supervisor puede decidir su destino: aprobar y pasar a Salida, clasificar como pérdida total (`lost`/`destroyed`), o clasificar como devolución. Ningún operador puede mover envíos desde Revisión.

**Descripción**

Como **supervisor** quiero revisar los envíos en la zona Revisión y decidir su destino (Salida, lost/destroyed, o Listo para devolución) para resolver las incidencias reportadas.

**#: CA-01 — Aprobación y envío a Salida**
**Dado:** un envío en zona Revisión con una incidencia reportada
**Cuando:** el supervisor determina que el contenido está intacto y selecciona "Aprobar y enviar a Salida"
**Entonces:** el envío cambia a `current_zone = "salida"` y queda disponible para despacho

**#: CA-02 — Pérdida total**
**Dado:** un envío en zona Revisión con daño irreversible
**Cuando:** el supervisor selecciona `lost` o `destroyed`
**Entonces:** el envío pasa a estado terminal correspondiente y `current_zone` se limpia a `NULL`

**#: CA-03 — Operador no puede mover desde Revisión**
**Dado:** un envío en zona Revisión
**Cuando:** un operador (no supervisor) intenta moverlo
**Entonces:** `403 FORBIDDEN: "Solo un supervisor puede mover envíos desde la zona Revisión"`

---

## US-05: Despacho desde Salida

**Detalles clave**

El operador acciona "Despachar" sobre un envío en Salida. El sistema resuelve automáticamente el tipo de despacho según el contexto del envío. Si el envío viene de un plan de ruteo y está en Entrada, el sistema lo mueve a Salida automáticamente antes de despachar.

**Descripción**

Como **operador** quiero despachar un envío desde Salida y que el sistema ejecute la acción correcta (transferencia, reparto o mostrador) según el contexto del envío, sin tener que elegir el tipo manualmente.

**#: CA-01 — Despacho manual desde Salida**
**Dado:** un envío en `current_zone = "salida"`
**Cuando:** el operador selecciona "Despachar"
**Entonces:** el sistema determina el tipo de despacho según el contexto:
  - sucursal intermedia → transferencia (asignar vehículo inter-sucursal, `loaded`/`in_transit`)
  - sucursal final + `ultima_milla` → reparto (asignar vehículo última milla, `out_for_delivery`)
  - sucursal final + `retiro_sucursal` → mostrador (verificar DNI, `delivered`)

**#: CA-02 — Despacho automático vía ruteo inteligente**
**Dado:** un envío en `current_zone = "entrada"` incluido en un plan de ruteo generado
**Cuando:** el operador/supervisor ejecuta el plan (`POST /routing/apply`)
**Entonces:** el sistema mueve automáticamente el envío de `Entrada → Salida` y luego procede con el despacho según el plan


---

## Anexo técnico: Resumen de cambios necesarios

### Backend

| Archivo | Cambio |
|---------|--------|
| `internal/model/branch_zone.go` | **Nuevo**: structs `BranchZone`, enum `ZoneType` |
| `internal/model/shipment.go` | Agregar campo `CurrentZone *string` |
| `internal/db/migrate.go` | Nueva tabla `branch_zones`, columna `current_zone` en `shipments` |
| `internal/repository/zone_repository.go` | **Nuevo**: interfaz + Postgres impl |
| `internal/projection/postgres_shipment.go` | Manejar eventos de zona en `Apply()`, agregar `current_zone` en `upsertShipment()` y todos los SELECT/Scan |
| `internal/model/domain_event.go` | Nuevos eventos: `EventShipmentZoned`, `EventShipmentMoved`, `EventInspectionResolved`, `EventShipmentDispatched`, `EventCounterDelivery`, `EventReturnDispatched` |
| `internal/service/shipment.go` | Validar `current_zone` (bloquear despacho manual si está en Entrada o Revisión) |
| `internal/service/zone_service.go` | **Nuevo**: `MoveShipment()`, `InspectAndResolve()`, `DispatchFromSalida()` |
| `internal/service/routing.go` | En `ApplyPlan()`: si `current_zone = "entrada"`, auto-mover a `"salida"` antes de despachar |
| `internal/handler/shipment_handler.go` | `PATCH /shipments/:tracking_id/move-zone` |
| `internal/handler/zone_handler.go` | **Nuevo**: `POST /shipments/:id/inspect-resolve`, `POST /shipments/:id/dispatch` |
| `cmd/server/main.go` | Registrar nuevas rutas + middlewares |
| `internal/seed/seed.go` | Seed de `branch_zones` para cada sucursal activa |

### Frontend

| Archivo | Cambio |
|---------|--------|
| `src/api/shipments.ts` | Métodos `moveZone()`, `inspectResolve()`, `dispatchFromSalida()` |
| `src/components/ZoneBadge.tsx` | **Nuevo**: badge de zona |
| `src/pages/ShipmentDetail.tsx` | Sección de zona actual + botón "Mover" (role-gated) |
