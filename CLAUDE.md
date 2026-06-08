# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All UI text (labels, error messages, placeholders, buttons, tooltips) must be in **Spanish (Argentina)**. No English strings in the frontend UI.

## Repository layout

| Folder | Stack | Purpose |
|--------|-------|---------|
| `logitrack_core/` | Go + Gin | REST API backend (port 8080) |
| `logitrack_web/` | React + Vite + TypeScript | Frontend SPA (port 5173) |

`VITE_API_URL` overrides the default API base URL (`http://localhost:8080/api/v1`).

## Backend (`logitrack_core/`)

### Commands

```bash
go run cmd/server/main.go        # dev server
go build ./...                   # build
go test ./...                    # tests (required before marking work done)
go mod tidy
swag init -g cmd/server/main.go -o ../docs && rm ../docs/docs.go ../docs/swagger.json
go run cmd/train/main.go         # train ML model → model.json
```

**Before marking work done**: run `go test ./...` — all tests must pass. `go build ./...` alone is not sufficient.

### Architecture

Standard layered architecture: `handler → service → repository`.

```
cmd/server/main.go     # entry point: wires repos, services, handlers, routes
internal/
  model/               # pure data structs: Shipment, ShipmentEvent, Branch, User, Route,
                       #   Customer, ShipmentComment, DomainEvent, Vehicle, MLConfig
  repository/          # interfaces + PostgreSQL implementations (shipment_es.go is active ES impl)
  projection/          # ShipmentProjection — write-through materialized view from DomainEvents
  service/             # business logic: shipment, branch, route, comment, ml_config
  handler/             # Gin HTTP handlers
  ml/                  # RandomForest priority prediction (config, dataset, train/predict)
  middleware/          # Bearer token auth + RequireRoles
  seed/                # LoadBranches, LoadVehicles, Load(EventStore, Projection, CustomerRepo)
cmd/train/main.go      # CLI: train and save model.json
```

**Adding a field to `model.Shipment` requires changes in four places — all four, every time:**
1. `internal/model/shipment.go` — the struct field
2. `internal/db/migrate.go` — `CREATE TABLE` column + `ALTER TABLE ADD COLUMN IF NOT EXISTS`
3. `internal/projection/postgres_shipment.go` — `upsertShipment` INSERT/UPDATE, all SELECT queries, both `Scan` calls
4. `internal/seed/seed.go` — set the field in `initialShipment` if meaningful at creation time

Skipping any of these means the field silently disappears at the DB boundary.

**In-memory repositories** (`internal/repository/inmemory.go`) implement every interface for unit tests only. Production uses PostgreSQL exclusively.

### Event sourcing — shipments

`DomainEvent` objects are the source of truth. Each write appends a domain event to `EventStore` and applies it to `ShipmentProjection`. Reads (List, Search, Stats, GetByTrackingID) are served from the projection.

**ShipmentRepository** uses command structs: `CreateShipmentCmd`, `SaveDraftCmd`, `UpdateDraftCmd`, `ConfirmDraftCmd`, `StatusUpdateCmd`, `CorrectCmd`, `CancelCmd`, `ExtendETACmd`.

**Domain event types**: `EventShipmentCreated`, `EventDraftSaved`, `EventDraftUpdated`, `EventDraftConfirmed`, `EventStatusChanged`, `EventShipmentCorrected`, `EventShipmentCancelled`, `EventIncidentReported`, `EventShipmentETAExtended` (emitido al iniciar un retorno — extiende `EstimatedDeliveryAt` en `ReturnETAExtraDays = 10` días).

### Auth & Users

UUID tokens in PostgreSQL `tokens` table. `Authorization: Bearer <token>` required on all routes except public/login. `NewPostgresAuthRepository` upserts seed users on every startup via `ON CONFLICT (username) DO UPDATE`.

### Seed users

| Username | Password | Role | Branch |
|---|---|---|---|
| `op_caba` | `op_caba123` | operator | caba |
| `sup_caba` | `sup_caba123` | supervisor | caba |
| `chofer_caba` | `chofer_caba123` | driver | caba |
| `op_cordoba` | `op_cordoba123` | operator | cordoba |
| `sup_cordoba` | `sup_cordoba123` | supervisor | cordoba |
| `chofer_cordoba` | `chofer_cordoba123` | driver | cordoba |
| `op_mendoza` | `op_mendoza123` | operator | mendoza |
| `sup_mendoza` | `sup_mendoza123` | supervisor | mendoza |
| `chofer_mendoza` | `chofer_mendoza123` | driver | mendoza |
| `op_posadas` | `op_posadas123` | operator | posadas |
| `chofer_posadas` | `chofer_posadas123` | driver | posadas |
| `sup_santa_cruz` | `sup_santacruz123` | supervisor | santa_cruz |
| `gerente` | `gerente123` | manager | — |
| `admin` | `admin123` | admin | — |

`chofer_caba` has ID `"5"` — referenced by route seed (`ROUTE-SEED0001`). Do not change that ID.

### Tracking ID formats

- Confirmed shipments: `LT-XXXXXXXX`
- Drafts: `DRAFT-XXXXXXXX` (replaced by `LT-` on confirm)

### Shipment state machine

```
draft ──confirm──► at_origin_hub ──[vehicle]──► loaded ──[StartTrip]──► in_transit ──► at_hub ──► in_transit (next hop)
                       │                                                                        ├─► out_for_delivery ──► delivered
                       │                                                                        │                   └─► delivery_failed ──► redelivery_scheduled ──► out_for_delivery (retry)
                       │                                                                        │                                        ├─► ready_for_pickup ──► delivered
                       │                                                                        │                                        │                    └─► no_entregado ──► at_hub / at_origin_hub
                       │                                                                        │                                        └─► rechazado ──► at_hub / at_origin_hub
                       │                                                                        ├─► ready_for_pickup ──► delivered
                       │                                                                        │                    └─► loaded (transfer via vehicle)
                       │                                                                        └─► ready_for_return ──► returned
                       └─► ready_for_return (is_returning=true, auto on arrival)
```

Any hub transition can also go to `lost` or `destroyed` (terminal).

- `draft`: transitions only via `ConfirmDraft`, not `UpdateStatus`.
- `loaded`: reverts to `at_origin_hub` / `at_hub` if unassigned from vehicle.
- `in_transit` only goes to `at_hub` or `at_origin_hub` — never directly to `delivered`.
- `out_for_delivery` only goes to `delivered`, `delivery_failed`, `lost`, or `destroyed`.
- `at_origin_hub` + `is_returning=true` → auto-promoted to `ready_for_return`.
- Delivery retry limit: configurable via `system_config.max_delivery_attempts` (default 3, range 1–10).
  When limit reached: `delivery_failed` can only go to `ready_for_pickup` or `rechazado`.
- `ready_for_return`: `current_location` must equal the receiving branch's city (enforced server-side).
- Terminal states: `delivered`, `returned`, `cancelled`, `lost`, `destroyed` — no further transitions.
- Cancellable: `at_origin_hub`, `at_hub`, `ready_for_pickup`. NOT cancellable: `loaded`, `in_transit`, `draft`, terminal.

**UI labels for status codes** — los códigos internos no cambian; solo el texto mostrado al usuario operativo (badges, filtros, dashboard, detalle de envío). Definidos en `logitrack_web/src/components/StatusBadge.tsx`, `pages/ShipmentDetail.tsx`, `pages/ShipmentList.tsx` y `pages/Dashboard.tsx`:

| Código | Etiqueta UI |
|---|---|
| `loaded` | **Cargado en vehículo** |
| `out_for_delivery` | **Última milla** (antes "En reparto") |
| `at_hub` (genérico) | **En sucursal** |
| `at_hub` cuando `current_location == final_branch_id` | **En sucursal de destino** (override por envío) |

La página pública de tracking (`pages/PublicTracking.tsx`) mantiene su redacción amigable propia para clientes finales ("Cargado y listo para despachar", "En camino a domicilio") y no se rige por estas etiquetas operativas, salvo el override de "En sucursal de destino" que sí se aplica al badge.

**Override por envío** — cuando una etiqueta depende del estado del envío (no solo del código), se computa en `logitrack_web/src/utils/shipmentStatus.ts` (`shipmentStatusLabelOverride`) y se pasa al `StatusBadge` por prop `label`. Hoy solo aplica al caso `at_hub` arriba. Si en el futuro otra transición necesita un texto contextual, se agrega ahí — no duplicar la comparación en cada call site.

### Business rules

**DNI validation** (before any repo write in `service/shipment.go`):
- `→ delivered`: `recipient_dni` required and must match `shipment.recipient_dni`.
- `→ returned`: `sender_dni` required and must match `shipment.sender_dni`.

**Field format validation** (`Create`, `SaveDraft`, `UpdateDraft`, `ConfirmDraft`):
- DNI: digits only. In drafts, only when non-empty; required on `Create`/`ConfirmDraft`.
- Email: `user@domain.tld` format. Only when non-empty (optional).

**`location` field on status updates** — most transitions set it automatically:
- `→ loaded`: set by vehicle assignment
- `→ in_transit`: set by `StartTrip`
- `in_transit → at_hub`: auto-derived from last `in_transit` event
- `delivery_failed → at_hub`: auto-derived from last `at_hub` event
- All other transitions: not required

**`receiving_branch_id` lifecycle**: on `at_hub`, both projections update `receiving_branch_id` to the new branch, so operators/supervisors at the destination see the shipment in their filtered list.

### Role-based permissions (defined in `main.go`)

**Admin scope** is configuration-only. Admin does NOT participate in any operational shipment flow (no list, no detail, no create, no draft, no correct, no cancel, no status change, no comment, no incident report, no quote, no stats, no driver assignment). Admin manages: branches, fleet config (POST /vehicles, assign-branch), users, organization, system config, ML config, pricing config, access logs.

Middleware groups:
- `adminOnly`: admin only.
- `authenticated`: all roles (operator, supervisor, manager, admin, driver). Used only for `/auth/me`, `/users/me`, `/users/me/password`, `GET /organization`.
- `mgmtNonDriver`: operator + supervisor + manager + admin. Used for management screens (branches list/search/capacity, vehicles list, customers).
- `shipmentRead`: operator + supervisor + manager. Shipment list/search.
- `shipmentDetailRead`: operator + supervisor + manager + driver. Shipment detail, events, QR, comments/incidents read, vehicle-by-shipment.
- `shipmentWrite`: operator + supervisor. All shipment writes (create, draft, confirm, correct, cancel, comment, incident, bulk-status), pricing quote, vehicle operational ops (assign, start-trip, end-trip, unassign, status), customers autocomplete, drivers list, **daily routing plan generate/apply**.
- `canChangeStatus`: operator + supervisor + driver. Driver further restricted in handler.
- `driverOnly`: driver-specific routes.
- `canViewStats`: supervisor + manager.
- `canManageBranch`, `canCreateVehicle`: admin.

**Operator restrictions**: cannot update a shipment in `out_for_delivery` status (reserved for supervisor/driver). Can transition to `delivered` from other states (e.g. `ready_for_pickup`).

**Branch restrictions** (`branchForbidden` in handler):
- Operators + supervisors get 403 on writes for shipments whose `receiving_branch_id` ≠ their branch.
- Operators additionally get 403 on reads for out-of-branch shipments.
- Fleet: supervisors can only `/start-trip` vehicles where `assigned_branch` = their branch; only `/end-trip` where `destination_branch` = their branch.

**Driver restrictions** (`RouteService.ValidateDriverCanUpdateShipment`):
- Only shipments on their today's route; only `delivered` or `delivery_failed`.

### Route system

Routes link a driver to shipments for a date (`YYYY-MM-DD`). ID format: `ROUTE-XXXXXXXX`. When supervisor sets `→ delivering` with `driver_id`, shipment is auto-added to that driver's today route.

### Corrections (`PATCH /shipments/:tracking_id/correct` — supervisor + admin)

Non-destructive edits. Stored in `Shipment.Corrections` (typed struct, `*field` pointers); accumulate via `Merge()`. Blocked on `pending` and terminal states. Each correction auto-generates a `[Correction]` comment and an `"edited"` ShipmentEvent (status unchanged). When any ML-relevant field is corrected, priority is recomputed and persisted.

Correctable fields: all sender/recipient/address fields + `special_instructions` + `time_window`.

**Non-correctable fields** (locked at creation/confirmation): `weight_kg`, `package_type`, `is_fragile`, `shipment_type`. The price is immutable post-confirmation; editing these fields would create a mismatch between what was charged and what was committed. Note: `package_type` does not affect the price calculation but remains locked as part of the delivery contract.

**Directional restriction on `time_window` corrections**: only allowed when the new window has equal or lower restrictiveness/surcharge. `flexible → morning|afternoon` is rejected (would raise the underlying price commitment); `morning ↔ afternoon` is allowed (same tier, same price); anything `→ flexible` is allowed.

### Cancellation (`POST /shipments/:tracking_id/cancel` — operator + supervisor)

`reason` required (400 if empty). Blocked on `pending` and terminal states. Auto-adds `[Cancelación] <reason>` comment.

### Comments (`service/comment.go`)

Supervisor + admin only (write). Cannot add to `delivered` or `returned`. All authenticated users can read. `CommentHandler` holds a `ShipmentService` reference to enforce branch restrictions for operators.

### Customer autocomplete

`GET /customers?dni=XXXXX` — exact DNI match. Auto-upserted on shipment create. UI: ≥7 digits → 400ms debounce → suggestion popover → user must click "Use data" (no auto-fill).

### Fleet management

Vehicles: `license_plate` (unique), `type`, `capacity_kg`, `status`, `assigned_branch`, `destination_branch`, `assigned_shipments[]`.

Status flow: `disponible` → `en_carga` → `en_transito` → `disponible`. Also: `mantenimiento`, `inactivo` (require `force: true` if shipments assigned).

**Vehicle → Shipment lifecycle**:
1. `assign` → shipment `pre_transit`, vehicle `en_carga`
2. `DELETE shipment` → shipment `at_branch`, vehicle `disponible` if empty
3. `start-trip` → all shipments `in_transit`, vehicle `en_transito`
4. `end-trip` → all shipments `at_branch` at destination, vehicle `disponible` at destination branch

Assignment rules: vehicle must be `disponible`/`en_carga`; shipment must be `in_progress`, `at_branch`, or `ready_for_pickup`; branches must match; total weight ≤ `capacity_kg`.

### ML priority prediction

RandomForest (`github.com/malaschitz/randomForest`) in `internal/ml/`. Priority computed on Create, ConfirmDraft, and CorrectShipment (ML-relevant fields). Model stored as BYTEA in `ml_models` table. Fallback: DB blob → file (`ML_MODEL_PATH`, default `model.json`) → auto-train.

Priority fields: `priority` (alta/media/baja), `priority_score` (0–1), `priority_confidence` (0–1), `priority_factors` (JSONB).

Default factor weights (configurable 1.0–5.0 by admin):

| Factor | Weight | Normalization |
|--------|--------|--------------|
| `shipment_type` | 3.0 | express=1.0 / normal=0.0 |
| `distance_km` | 2.5 | Haversine / 2500 |
| `restrictions` | 2.0 | is_fragile (0/1) |
| `time_window` | 1.5 | morning=1.0 / afternoon=0.5 / flexible=0.0 |
| `volume_score` | 1.0 | (pkg_base + weight_kg/2) / 25 |
| `route_saturation` | 0.8 | FNV hash of "origin-dest" |

Default thresholds: alta > 0.65, media > 0.35. Province coords in `internal/ml/dataset.go ProvinceCoords`.

On `POST /ml/config/regenerate`: saves config, retrains, saves blob, hot-swaps model, recalculates all non-terminal shipment priorities.

### Pricing

Rule-based pricing engine with admin-editable config (singleton table `pricing_config`, fila `id=1`). Computed once on `Create` and `ConfirmDraft`; **never recalculated** afterwards (immutable). Persisted on `Shipment.Price` (`*float64`), `Shipment.PriceBreakdown` (JSONB), `Shipment.PriceCurrency` (default `"ARS"`).

Formula:
```
subtotal = (base_fare + cost_per_km × distance_km) × shipmentMultiplier + weight_surcharge + last_mile_surcharge
total    = subtotal × time_window_multiplier × fragile_multiplier
```

- `last_mile_surcharge` only applies when `delivery_method == ultima_milla`.
- `time_window_multiplier` applies to `morning` and `afternoon`; `flexible` uses 1.0 (no recargo).
- Package type (`envelope`/`box`) **no afecta el precio** — solo es un dato descriptivo del envío.
- All multipliers must be ≥ 1. All flat amounts must be ≥ 0.

Distance uses real lat/lng from `Address.Latitude/Longitude` via `ml.HaversineKm`, falling back to `ml.ComputeDistance` by province if either side lacks coords.

Default config (all editable from `/admin/pricing`):

| Param | Default |
|---|---|
| `base_fare` | 10000 |
| `cost_per_km` | 25 |
| `weight_surcharge_mid` (5–25 kg) | 5000 |
| `weight_surcharge_high` (>25 kg) | 25000 |
| `last_mile_surcharge` | 5000 |
| `shipment_express_multiplier` | 1.2 |
| `time_window_restrictive_multiplier` | 1.05 |
| `fragile_multiplier` | 1.20 |

**UI rule**: la ventana horaria (`time_window`) se oculta en el form de nuevo envío cuando el método de entrega es `retiro_sucursal`, y se resetea a `flexible` automáticamente. Solo aplica para `ultima_milla`.

Endpoints:
- `POST /pricing/quote` — operator/supervisor (used by the New Shipment form). Returns `{ total, currency, breakdown }` without persisting.
- `GET /pricing/config` — admin only.
- `PATCH /pricing/config` — admin only. Validates: flat amounts ≥ 0, all multipliers ≥ 1.

### Daily routing (intelligent dispatch)

Motor de ruteo en `internal/service/routing.go`. El plan es **global**: cubre todas las sucursales activas a la vez y se persiste en la tabla `routing_plans`. Se genera automáticamente a las 08:00 por un scheduler; también se puede regenerar manualmente. Los operadores/supervisores ven y editan el plan de su sucursal desde `/routing`; managers y admins ven el plan completo de la red.

**`RoutingConfig`** (singleton tabla `routing_config` id=1, admin-editable desde `/routing-config`):

| Param | Default | Rango | Descripción |
|---|---|---|---|
| `sla_force_horizon_hours` | 24 | 1–168 | SLA crítico fuerza despacho. |
| `priority_force_threshold` | 0.75 | 0–1 | Score que dispara despacho forzado. |
| `min_fill_rate` | 0.40 | 0.1–1 | % capacidad del vehículo más grande para consolidar. |
| `enforce_time_windows` | true | bool | Si true, envíos fuera de ventana quedan unassigned. Si false, se incluyen con warning. |
| `morning_window_start_hour` | 8 | 0–23 | Hora de inicio (24h) de la ventana "morning". |
| `morning_window_end_hour` | 14 | 1–24 | Hora de fin de la ventana "morning" (> start). |
| `afternoon_window_start_hour` | 12 | 0–23 | Hora de inicio de la ventana "afternoon". Puede solapar con morning. |
| `afternoon_window_end_hour` | 18 | 1–24 | Hora de fin de la ventana "afternoon" (> start). |
| `service_time_minutes` | 10 | 1–60 | Tiempo de entrega por parada de **última milla** (timbre + firma). No aplica a inter-sucursal. |
| `avg_speed_kmh` | 25 | 5–120 | Velocidad urbana de última milla entre paradas. **No** se usa para inter-sucursal. |
| `last_mile_packing_strategy` | `maximize_capacity` | `balanced` \| `maximize_capacity` | Estrategia de asignación a choferes. |
| `fleet_projection_horizon_hours` | 0 | ≥0 | WIP: ventana de horas para usar vehículos entrantes en despacho proyectado. 0 = deshabilitado. |
| `inter_branch_dispatch_hour` | 8 | 0–23 | Hora fija de salida (local ART) de todos los despachos inter-sucursal del día. Base del scheduling del calendario. |
| `inter_branch_avg_speed_kmh` | 60 | 20–120 | Velocidad de ruta inter-sucursal, usada como fallback cuando la arista del grafo no tiene `avg_transit_hours`. |
| `inter_branch_stop_minutes` | 240 | 0–1440 | Dwell (descarga + carga de pallets) en una parada intermedia inter-sucursal multi-hop. Independiente de `service_time_minutes`. |

Tope de peso por chofer: **150 kg hardcodeado** en `routing.go` (`MaxWeightKg`). No es configurable hoy.

### Scheduling inter-sucursal (calendario)

`scheduleInterBranchAssignments` (routing.go) calcula, para cada despacho inter-sucursal, la hora de salida (`EstimatedDepartureMin = inter_branch_dispatch_hour × 60`) y el arribo a cada parada. El tiempo de viaje por tramo prioriza `BranchEdge.AvgTransitHours` del grafo de sucursales (datos históricos reales o baseline 60 km/h del seed); si la arista no tiene dato, cae a `distancia × 1.3 / inter_branch_avg_speed_kmh`. En cada parada **intermedia** (todas salvo la última, incluida la primaria cuando es multi-hop) se suma `inter_branch_stop_minutes` como dwell de descarga + carga. Se ejecuta al final de `generatePlan` y se **re-ejecuta** al final de `GenerateGlobalPlan` (los pases globales mutan las paradas).

Al aplicar el plan, los tiempos se persisten en el `InterBranchTrip`: `ScheduledDepartureAt`, `EstimatedArrivalAt`, y `EstimatedArrivalAt` por `TripStop` (mapeado por `branch_id`, no por índice, porque las paradas se arman condicionalmente). Última milla persiste salida desde `SuggestedDepartureMin` del VRP y llegada = salida + último stop + `service_time_minutes`.

**Modos de vehículos**: cada vehículo tiene un `mode` que determina en qué pool participa:
- `ultima_milla`: solo asignado a rutas de última milla.
- `inter_sucursal`: solo asignado a despachos entre sucursales.

**Modos de ruta de última milla** (`RouteMode`, seleccionable por el operador por chofer):
- `ventanas` (default): maximiza entregas dentro de la franja horaria contratada.
- `segura`: igual a `ventanas` pero penaliza arcos que atraviesan polígonos de riesgo (usa ORS `avoid_polygons` si hay `ORS_API_KEY`, o fallback OSRM + waypoints).
- `costo`: minimiza distancia/duración total sin considerar franjas horarias. Las paradas fuera de ventana se marcan visualmente pero no se excluyen.

**Flujo del algoritmo** — por sucursal, luego pases globales:

**Por sucursal** (`generatePlan(branchID)`):

1. **Filtrar candidatos**: shipments con `receiving_branch_id == branchID && status ∈ {at_origin_hub, at_hub, redelivery_scheduled}`. Excluir `retiro_sucursal` solo si `final_branch_id == branchID`. Excluir shipments con `reserved_for_trip_id != nil` (reservados para cross-branch pickup de un viaje multi-hop en curso).
2. **Particionar**:
   - Última milla: `final_branch_id == branchID && delivery_method == ultima_milla && status ∈ {at_hub, redelivery_scheduled} && !is_returning`.
   - Inter-sucursal: el resto. Para `is_returning` el destino es `origin_branch_id`; para el resto, `final_branch_id`.
3. **Bin-packing última milla**: orden estable `priority_score DESC, time_window (morning>afternoon>flexible), created_at ASC`. Estrategia configurable: `balanced` o `maximize_capacity`.
4. **Scheduling con ventanas (última milla)**: para cada chofer asignado, probar horarios candidatos (cada hora entera entre `morning_window_start_hour` y `afternoon_window_end_hour - 1`). Por cada horario, ejecutar VRP con `departureMin` ajustado y ventanas blandas; elegir el horario con mejor score `(entregas_dentro_de_ventana DESC, espera_total ASC)`. Si ningún horario logra 100% en ventana, abrir un nuevo chofer (si hay disponible) y redistribuir según estrategia. Resultado: `SuggestedStartTime` por chofer + orden óptimo de paradas, persistidos en `Route` al hacer `Apply`.
5. **Despacho inter-sucursal por destino** (3 reglas):
   - **SLA forced**: alguno cumple `EstimatedDeliveryAt - now < sla_force_horizon_hours` o `priority_score >= priority_force_threshold`.
   - **Consolidación**: `sum(peso) >= min_fill_rate × largest_vehicle_capacity_in_pool`.
   - Sin regla → `unassigned` con motivo `esperando_consolidacion`.
6. **Selección de vehículo**: el más chico que cubre el peso total. Si ninguno cubre, el más grande con bin-packing por prioridad (excedente a `unassigned` con `sobrepeso_excede_vehiculo`).
7. **Multi-hop** (`addMultiHopStops`): agrega hasta `MaxTripStops = 3` paradas totales (incluyendo la primaria) a despachos inter-sucursal ya armados. Para cada despacho, busca envíos sin asignar cuyo shortest-path (grafo de sucursales via `BranchGraphService`) pase por el destino actual; los bin-packea en la capacidad restante. El fill-rate mínimo se aplica por tramo; envíos SLA-forzados pueden saltarlo.
8. **Piggyback**: para cada `unassigned` por motivo inter-sucursal, busca despacho ya armado cuyo destino esté **estrictamente más cerca** del destino final del envío (Haversine, fallback a distancia entre provincias). Cualquier mejora cuenta; elige la mayor mejora. Aplica encadenamiento de saltos: un piggyback puede crear el salto que habilita otro.
9. **Cross-branch pickups locales** (`addCrossBranchPickupsForBranch`): en paradas intermedias de viajes multi-hop, levanta envíos disponibles (`at_hub`/`at_origin_hub`) de esas sucursales cuyo destino final esté más adelante en el path del vehículo. Usa `reserved_for_trip_id` para evitar que esos envíos entren en otros planes.
10. **Despacho proyectado** (`tryProjectedDispatch`, WIP): si `fleet_projection_horizon_hours > 0`, usa vehículos `en_transito` con `estimated_arrival_at` conocido para rescatar envíos `sin_vehiculos_disponibles` o `sin_vehiculos_para_destino`.
11. **Backhauling** (`matchBackhauls`, WIP): identifica envíos en la sucursal de destino que necesitan volver al origen del viaje (`next_hop_branch_id == branchID`), los propone como carga de retorno en el mismo vehículo.

**Pases globales** (después de generar todas las sucursales, en `GenerateGlobalPlan`):

- **Cross-branch pickups globales** (`addCrossBranchPickups`): misma lógica que el paso local pero con visibilidad de toda la red — coordina pickups entre sucursales que el pase local no puede ver.
- **Consolidación cross-branch** (`consolidateCrossBranchDispatches`): absorbe despachos single-hop dentro de multi-hops que ya pasan por su sucursal de origen, cuando el dispatch B queda completamente vacío y puede cancelarse. **SLA safety**: si algún envío de B es SLA-crítico (`isSLACriticalETA`), la absorción solo procede si el ETA estimado vía la ruta de A (distancia × 1.3 / `avg_speed_kmh`) no supera el `EstimatedDeliveryAt` del envío — de lo contrario B se despacha de forma independiente.
- **Utilización mínima por tramo** (`enforceMinSegmentUtilization`): elimina paradas adicionales cuyo tramo no alcanza `min_fill_rate`, salvo que haya envíos SLA-forzados. Los envíos removidos vuelven a `unassigned` con motivo `tramo_subutilizado`.

**Vehículos en tránsito** — al leer el plan del día (`GetTodayPlan`):
- Vehículos ya `en_transito` se marcan como `InTransit=true`; sus envíos no aplicados pasan a `unassigned` con motivo `vehiculo_en_viaje`.
- La lista `IncomingVehicles` muestra los vehículos `en_transito` con destino a la sucursal (otra sucursal que viene hacia acá), con patente, origen, shipments a bordo y peso. Es informativo y base del despacho proyectado (WIP).

**SLA risk check** (`RunSLARiskCheck` / `checkSLARisk`): evalúa todos los envíos activos de la sucursal en cada generación de plan y dispara/resetea notificaciones internas según riesgo de incumplimiento de SLA (LOGITRACK-404).

**`ApplyPlan`** — per-item best-effort (no transaccional, son 3 stores distintos):
- Re-fetcheo de cada shipment y vehicle antes de mutar.
- Drift detectado (estado del shipment cambió, vehículo no disponible, capacidad excedida) → item `failed` con motivo en español, el resto continúa.
- Inter-sucursal: setea `destination_branch` del vehículo + asigna shipments + transiciona shipment a `loaded` + promueve vehículo a `en_carga`. **NO** hace `start-trip` (sigue manual desde Flota; el modal precarga el destino seteado).
- Última milla: usa flujo existente `UpdateStatus(out_for_delivery, driver_id)` + `RouteService.AddShipmentToDriverRoute`. Persiste `SuggestedStartTime` y orden óptimo de paradas en la `Route` creada.

Endpoints:
- `GET /routing/plan/today` — operator/supervisor (su sucursal), manager/admin (toda la red). Devuelve el plan persistido del día.
- `POST /routing/regenerate` — operator/supervisor (su sucursal). Regenera el plan de la sucursal propia dentro del plan global y lo persiste.
- `POST /routing/regenerate/global` — admin only. Regenera el plan completo de toda la red.
- `POST /routing/apply` — operator/supervisor (su propia sucursal). Aplica plan editado, devuelve resumen per-item.
- `POST /routing/last-mile/recompute` — operator/supervisor. Recalcula el orden de paradas de un chofer específico con un `RouteMode` dado, sin aplicar.
- `GET /routing/config` — admin only.
- `PATCH /routing/config` — admin only. Valida rangos de cada parámetro.

### Adding a new endpoint

1. Add struct to `internal/model/` if needed
2. Add method to repository interface + Postgres implementation
3. Add method to service
4. Add handler method, register route in `handler/`
5. Apply role middleware in `main.go`

There are no in-memory repository implementations — all persistence is PostgreSQL.

---

## Frontend (`logitrack_web/`)

### Commands

```bash
npm run dev      # dev server (port 5173)
npm run build    # tsc -b + Vite build (TypeScript validation — required before marking work done)
npm run lint
```

### Architecture

```
src/
  api/          # Axios clients per domain. shipments.ts: Bearer interceptor + 401→/login redirect.
                # publicTracking.ts: no auth, no redirect (calls /api/v1/public/* endpoints)
  context/      # AuthContext: user + token in localStorage, login/logout/hasRole
  components/   # ProtectedRoute, StatusBadge, PriorityBadge
  pages/        # one file per screen
  utils/date.ts # fmtDate / fmtDateTime — always use these (DD/MM/AAAA format)
```

Routes are defined in `App.tsx`. `/track` is declared before `AppRoutes` — bypasses auth and Nav entirely.

### Role-gated UI (`hasRole()` from `useAuth()`)

- `+ New Shipment`: hidden from managers
- Status update panel / Edit / Cancel buttons in `ShipmentDetail`: hidden via `operatorOutOfBranch` for operators **and supervisors** outside their branch
- Dashboard nav: supervisor + manager + admin
- Fleet nav: all non-driver
- ML Config nav: admin only
- Users nav: admin only
- Branches nav: supervisor + manager + admin (not operator)
- `Export CSV`: admin + manager only; client-side, reflects all active filters

### Branch-scoped UI

- `ShipmentList` branch filter: operator = locked badge; supervisor = defaults to own, can switch; manager/admin = all
- `VehicleList` branch filter: same pattern. Matches `assigned_branch` **or** `destination_branch` (client-side)
- `NewShipment` receiving branch: locked for operator + supervisor; free select for admin
- `VehicleList` Start Trip: disabled for supervisors when `assigned_branch` ≠ their branch; End Trip: when `destination_branch` ≠ their branch

### Key frontend behaviors

**Branches**: always fetched from `GET /api/v1/branches` — never hardcoded. `branchLabel(city, branches)` maps city → display name. Use `branchApi.listActive()` for dropdowns. Branch dropdowns use `<optgroup>` by province, sorted alphabetically via `localeCompare`.

**ShipmentList**: `?status=` param pre-selects filter. Default = `active` (excludes `delivered`, `pending`, `returned`, `cancelled`). Date filtering is client-side (local timezone).

**Draft workflow**: create via `POST /shipments/draft`, edit via `PATCH /:id/draft`. After save, redirect to `/?status=pending`. Confirm via `POST /:id/confirm` → generates `LT-` ID → `in_progress`.

**Shipment list ordering**: backend returns ascending by tracking ID.

**`location` field on `ShipmentEvent`** is inconsistent: seed events store branch ID (e.g. `"caba"`); runtime events store `address.city` (e.g. `"Ciudad de Buenos Aires"`). Any resolution must try both: `branches.find(b => b.address.city === loc) ?? branches.find(b => b.id === loc)`.

**Public tracking page** (`/track`): uses `publicTracking.ts` (no token). Event history translated to user-friendly language. Deep-linking via `?id=LT-XXXX`.

**CSV export**: client-side, all active filters applied. Corrected values take precedence. File: `shipments_YYYY-MM-DD.csv`. No personal data exported (Ley 25.326).

**Customer autocomplete** in `NewShipment`: ≥7 digits → 400ms debounce → lookup → suggestion popover → user must click "Use data".

**DriverRoute** (`/driver/route`): search filters by tracking ID or recipient name (including corrected values).

**VehicleList** Load Shipments modal: type trailing part of tracking ID (e.g. `A1B2C3D4` → `LT-A1B2C3D4`), calls `POST /vehicles/by-plate/:plate/assign` per shipment.

---

## Git workflow

Base: `develop`. Production: `main` (auto-deploys to Amplify).

```
feature/<description>   fix/<description>   chore/<description>
hotfix/<description>    # branch from main, merge back to main AND develop
```

Conventional Commits: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `ci`. PRs require one review (hotfixes excepted).

---

## Production infrastructure

| Layer | Service |
|-------|---------|
| Frontend | AWS Amplify (auto-deploy on push to `main`) |
| HTTPS proxy | AWS CloudFront (TLS termination in front of EC2) |
| Backend | EC2 port 8080 |
| Database | RDS PostgreSQL 17.4 |

---

## Specs

`docs/specs/` — functional specs by domain, Given/When/Then format. New features should have a spec first. See `docs/specs/00-indice.md`.

---

## Seed data (startup)

`seed.Load()` populates on every restart (idempotent):

- **6 branches**: caba, cordoba, mendoza, posadas (`activo`); jujuy (`inactivo`); bariloche (`fuera_de_servicio`). All branches have `MaxCapacity: 200`. Name format: `XXXX-NN` (e.g. `CDBA-01`, `CORD-01`).
- **Escenario de ruteo en CABA** (al loguearse `op_caba` y tocar "Generar plan" en `/routing`):
  - 6 envíos `at_hub` en CABA con destino final CABA → última milla.
  - 5 envíos `at_origin_hub` en CABA con destino Córdoba (sum 400 kg) → consolida.
  - 2 envíos `at_origin_hub` en CABA con destino Mendoza (sum 20 kg) → no consolida solos, pero piggybackean en el camión a Córdoba (Córdoba está más cerca de Mendoza que CABA).
  - 1 envío `retiro_sucursal` en CABA → silenciosamente excluido del ruteo.
- **3 sample vehicles**: `AB123CD` furgoneta/caba, `EF456GH` camion/cordoba, `IJ789KL` motocicleta/caba (mantenimiento).
- Otros envíos para variedad de dashboard: 1 entregado, 1 cancelado, 1 en `at_hub` Córdoba, 1 en `at_hub` Mendoza, 1 `out_for_delivery` con chofer caba.
- Customers auto-upserted from all shipments.

## API reference

Full route list is in `cmd/server/main.go`. Key public endpoints:

| Method | Path | Notes |
|--------|------|-------|
| GET | /api/v1/public/track/:id | no auth |
| GET | /api/v1/public/track/:id/events | no auth |
| GET | /api/v1/public/branches | no auth |
| POST | /api/v1/auth/login | returns token + user |
| GET | /api/v1/routing/plan/today | operator/supervisor (su sucursal), manager/admin (toda la red). Plan persistido del día. |
| POST | /api/v1/routing/regenerate | operator/supervisor (su sucursal). Regenera plan de la sucursal dentro del global. |
| POST | /api/v1/routing/regenerate/global | admin only. Regenera el plan completo de toda la red. |
| POST | /api/v1/routing/apply | operator/supervisor (su sucursal). Aplica plan editado, devuelve resumen per-item. |
| POST | /api/v1/routing/last-mile/recompute | operator/supervisor. Recalcula orden de paradas de un chofer con un RouteMode dado. |
| GET | /api/v1/routing/config | admin only. |
| PATCH | /api/v1/routing/config | admin only. Valida rangos. |
| GET | /api/v1/inter-branch-trips/calendar | operator/supervisor (su sucursal), manager (toda la red). `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Viajes (ambos kinds) para el calendario. |
| GET | /health | health check |
