# Ruteo inteligente — manual técnico

## Contexto y motivación

El ruteo del día es la decisión operativa más densa que toma una sucursal: con N envíos pendientes, K choferes y M vehículos, hay que decidir qué envío va con qué chofer, en qué orden lo entrega, qué envíos consolidar en cada vehículo inter-sucursal, y cuándo postergar un viaje hasta acumular más carga.

Históricamente esto se hacía a ojo: el supervisor leía la lista, pensaba qué tenía sentido, y armaba la operativa envío por envío. Funciona con volúmenes bajos pero no escala, y depende de la persona.

**Outcome buscado**: un sistema que tome todas esas decisiones automáticamente, las muestre como una propuesta, y le permita al operador ajustar lo necesario antes de aplicarla. La propuesta tiene que ser explicable (saber por qué cada envío fue asignado donde fue) y editable (no obligar a regenerar todo si el operador discrepa con una decisión).

## Arquitectura general

```
┌─────────────────────┐                      ┌──────────────────────┐
│  Frontend (React)   │  POST /routing/plan  │  Backend (Go + Gin)  │
│   /routing          │ ───────────────────► │   RoutingService     │
│                     │                      │                      │
│  - Generar plan     │  ◄───────────────── ─│   ┌──────────────┐   │
│  - Editar (D&D)     │     RoutingPlan{}    │   │  vrp.Solve   │   │
│  - Modal info       │                      │   │  (NN + 2-opt)│   │
│                     │                      │   └──────────────┘   │
│                     │  POST /routing/apply │   ┌──────────────┐   │
│                     │ ───────────────────► │   │ buildMatrix  │   │
│                     │                      │   │ (OSRM/Haver) │   │
│                     │  ◄─────────────────── │   └──────────────┘   │
│                     │   ApplyPlanResponse  │                      │
└─────────────────────┘                      └──────────────────────┘
                                                       │
                                              ┌────────┴────────┐
                                              ▼                 ▼
                                     ┌─────────────┐   ┌──────────────┐
                                     │  Postgres   │   │  OSRM Table  │
                                     │  (estado)   │   │  (opcional)  │
                                     └─────────────┘   └──────────────┘
```

**El plan vive en memoria del cliente** entre `Generate` y `Apply` (no se persiste en backend). Eso permite editar libremente sin afectar a otros operadores y sin acumular planes obsoletos en DB.

## Componentes

### Backend

| Paquete / archivo | Responsabilidad |
|---|---|
| `internal/osrm/client.go` | Cliente HTTP del OSRM Table API. Consulta tiempos/distancias reales por calle entre N puntos. |
| `internal/vrp/types.go` | Tipos del solver: `Problem`, `Solution`, `Route`, `Stop`, `Driver`, `Node`. |
| `internal/vrp/solver.go` | Algoritmo de optimización: Nearest Neighbor + 2-opt con ventanas hard. |
| `internal/service/routing.go` | Orquestador: `GeneratePlan`, `ApplyPlan`, `lastMileVRP`, `dispatchInterBranch`, `piggybackUnassigned`. |
| `internal/service/route.go` | `PendingLoad` / `PendingShipments`: cuánta carga real tiene cada chofer del día. |
| `internal/model/routing.go` | DTOs del plan: `RoutingPlan`, `LastMileAssignment`, `InterBranchAssignment`, `RouteStop`, `DriverLoad`, `VehicleLoad`. |
| `internal/handler/routing.go` | Handlers HTTP `POST /routing/plan` y `POST /routing/apply`. |

### Frontend

| Archivo | Responsabilidad |
|---|---|
| `pages/Routing.tsx` | Pantalla principal: carga el plan, render de las 3 secciones, drag & drop, validación cliente, botón Aplicar. |
| `components/ShipmentInfoModal.tsx` | Modal de solo lectura con detalle del envío (sin precio ni acciones). |
| `api/routing.ts` | Cliente axios + tipos compartidos del plan. |
| `utils/date.ts` | `fmtMinutesAsTime`, `fmtDuration` para mostrar horarios y duraciones. |

## Flujo end-to-end

### 1. `POST /routing/plan` (`GeneratePlan`)

```
1. Filtrar envíos: solo los at_hub / at_origin_hub / redelivery_scheduled
   en la sucursal del request, excluyendo retiro_sucursal.
2. Particionar:
   - lastMileQ:    final_branch == sucursal && delivery_method == ultima_milla
   - interBranchQ[destino]: el resto, agrupado
   - returns:      destino = origin_branch (no final)
3. Última milla → lastMileVRP() → []LastMileAssignment + []UnassignedShipment
4. Inter-sucursal → dispatchInterBranch() → []InterBranchAssignment + []UnassignedShipment
5. Piggyback: para cada UnassignedShipment de inter-sucursal, ver si algún
   despacho ya armado lo "acerca" a su destino final. Si sí, sumarlo.
6. Devolver el plan completo en JSON.
```

### 2. Algoritmo VRP (`internal/vrp/solver.go`)

El núcleo es un **Vehicle Routing Problem with Time Windows (VRPTW)** simplificado. No es óptimo (NP-duro a escala), es heurístico. Para escalas chicas (<50 paradas, <10 choferes) la calidad es buena y el tiempo subsegundo.

**Construcción — Nearest Neighbor (round-robin balanceado):**

```
departure = max(8:00, now)
service_time = 10 min/parada
day_end = 18:00

drivers ordenados por carga existente ASC, luego por ID.

Loop hasta que no se asigne nada nuevo:
  Para cada driver d (en orden estable):
    Si d ya está al tope de capacidad → skip
    Para cada candidato sin asignar:
      travel = matrix[current(d)][candidato] / 60
      arrival_abs = departure + acumulado(d) + travel
      Si ventana(candidato) NO acepta arrival_abs → marcar como timeWindowFailed, skip
      Si peso(d) + peso(candidato) > MaxWeightKg → skip
      Si count(d) + 1 > MaxShipments → skip
      Quedarse con el de menor travel.
    Si encontró candidato → asignar al driver, avanzar current/time/peso.
```

Round-robin entre drivers da load-balancing natural: un driver toma su primer envío, después pasa al siguiente, después vuelve al primero. Sin esto el primer driver se llenaría primero y los demás quedarían vacíos.

**Mejora — 2-opt intra-ruta:**

Para cada ruta con ≥4 paradas:

```
improved = true
mientras improved:
  improved = false
  Para cada par (i, j) con i+1 < j:
    cand = ruta con segmento [i+1..j] revertido
    Si cand respeta ventanas Y reduce duración total → aplicar
    improved = true
    break (restart desde i=0)
```

2-opt es O(n²) por iteración y suele converger en 2-3 pasadas. Cubre ~80% del beneficio de optimización post-NN. **No** se incluyó Relocate (mover paradas entre rutas) porque agrega complejidad y puede romper ventanas que ya estaban bien construidas.

**Ventanas horarias hard:**

```
respectsWindow(tw, abs_arrival_min, day_end_min):
  si abs_arrival_min > day_end_min: false
  switch tw:
    morning:   abs_arrival_min <= 12:00
    afternoon: abs_arrival_min >= 12:00
    flexible:  true
```

Si una parada no se puede atender en su ventana, va a `Unassigned` con razón `ventana_horaria_inviable`. El alternativo (soft constraints con penalty) requiere afinar constantes arbitrarias y puede dar planes que prometen lo que no van a cumplir. La decisión hard se alinea con el flow operativo: el operador ve el conflicto y decide.

**Determinismo:**

Toda iteración sobre maps va por slice ordenado (driver/destino/tracking_id). A igual entrada, igual salida. Los maps de Go iteran en orden no determinístico, así que esto requiere disciplina en cada `range m`.

### 3. Construcción de la matriz de tiempos

`buildDurationMatrix(depot, deliveries) → [N+1][N+1]float64`:

```
1. all = [depot, ...deliveries]
2. Si osrmClient != nil y len(all) <= 80:
   Intentar GET {OSRM_URL}/table/v1/driving/lon,lat;...?annotations=duration,distance
   Si OK → usar la matriz devuelta
   Si error/timeout → log + caer a Haversine
3. Haversine fallback:
   dist[i][j] = haversine(coords[i], coords[j]) * 1.3 (factor de detour)
   dur[i][j]  = dist[i][j] / 25 (km/h promedio urbano) * 3600 (segundos)
```

OSRM da tiempos reales por calle pero requiere infra. La instancia pública (`router.project-osrm.org`) está hardcodeada en `main.go`, sirve para dev y tolera caídas (fallback automático). Para producción conviene self-hostear.

Si una parada no tiene coordenadas, **no entra al solver**. Se appendea al final de la ruta del chofer menos cargado con `Unsequenced=true` y `ArrivalMin=-1`. El frontend la muestra con badge "Sin coordenadas — orden manual".

### 4. Despacho inter-sucursal

Para cada destino con envíos pendientes, evaluar en orden:

| Regla | Condición | Acción |
|---|---|---|
| **SLA crítico** | `EstimatedDeliveryAt - now < 24h` OR `priority_score >= 0.75` para algún envío del grupo | Despacha aunque vaya casi vacío |
| **Consolidación** | `sum(weight) >= 0.40 × largest_available_capacity` | Despacha |
| **Esperar** | Ninguna de las anteriores | Va a `unassigned` con razón `esperando_consolidacion` |

**Selección de vehículo**:
1. El más chico que cubra el peso total (minimiza desperdicio).
2. Si ninguno cubre → el más grande disponible + bin-pack por prioridad. Sobrante a `unassigned` con razón `sobrepeso_excede_vehiculo`.

**Piggyback**: para cada `unassigned` de inter-sucursal, busca un dispatch ya armado cuyo destino esté **estrictamente más cerca** del destino final del envío que la sucursal actual (Haversine entre branches con fallback a province coords). Si encuentra varios, elige el de mayor mejora. Mitiga el caso de envíos que no llegan a consolidar pero podrían viajar acompañados.

### 5. `POST /routing/apply` (`ApplyPlan`)

**Per-item best-effort, no transaccional** porque los stores (shipments, vehicles, routes) son distintos.

```
Para cada LastMileAssignment a:
  Si CanAssignToRoute(a.driver_id) falla → fallar todos los items con "ruta_ya_iniciada"
  Para cada tracking_id en a.shipments:
    Re-leer el shipment del repo
    Validar branch + estado (drift detection)
    UpdateStatus → out_for_delivery con driver_id
    AddShipmentToDriverRoute (en el orden del array, que = orden del VRP)

Para cada InterBranchAssignment a:
  Re-leer el vehículo
  Validar disponibilidad + destino compatible
  Setear destination_branch del vehículo si está vacío
  Para cada tracking_id en a.shipments:
    Validar capacidad acumulada
    AddShipment al vehículo
    UpdateStatus → loaded
  Si se cargó al menos uno y vehículo era "available" → promover a "en_carga"
```

Cada item tiene un resultado individual. La respuesta es `{applied_count, failed_count, items: [...]}`. El frontend lo muestra en un modal.

**Drift detection** evita que el operador pise cambios concurrentes. Razones típicas de fallo:

- `estado_cambio:<nuevo>` — el envío ya no está en at_hub/at_origin_hub
- `vehiculo_no_disponible` — alguien lo puso en mantenimiento o en transito
- `vehiculo_destino_diferente` — alguien le seteó otro destino primero
- `capacidad_excedida` — el vehículo se cargó más entre Generate y Apply
- `ruta_ya_iniciada` — el chofer arrancó la ruta entre Generate y Apply

### 6. Frontend — flujo

**Estado principal** en `Routing.tsx`:

```typescript
plan: RoutingPlan | null         // plan actual (mutable por edición)
originalPlan: RoutingPlan | null  // copia inmutable para "Descartar cambios"
shipments: Map<string, Shipment>  // hidratado desde shipmentApi.list
dragging: DragState | null        // info del drag activo
viewingTrackingId: string | null  // modal de info abierto
```

**Edición del plan**:

`executeMove(trackingId, source, target)` es la única función que muta el plan. La usa el handler de drop. Recibe el envío, su origen actual (driver/vehicle/unassigned) y el destino. Valida tipo (last-mile vs inter-sucursal), capacidad, no-op, y si todo OK aplica la mutación al plan en memoria.

`removeFromSource` saca el envío del origen. Si era de un driver con `ordered_stops`, también lo saca del array y recompacta `sequence`.

Si el destino es un driver/vehicle sin asignación previa, **se crea la asignación on-the-fly** copiando la info de `driver_loads` / `vehicle_loads` (capacidad, carga existente, etc.). El envío movido manualmente se marca con `manual: true` (no `unsequenced: true` — ese es para envíos sin coords del backend).

**Drag & drop**:

HTML5 drag-and-drop nativo. Cada `ShipmentChip` y `RouteStopRow` setea `draggable={true}` y dispara `beginDrag(e, trackingId)` en `onDragStart`. Eso arma `dragging` con `{trackingId, source, isLastMile}`. Cada drop target chequea `canAcceptDrop(target)` cliente-side y se renderiza con borde verde (acepta) o atenuado (no acepta). Al `onDrop` válido llama `handleDrop` → `executeMove` → re-render.

**Modal de detalle**: cualquier click izquierdo sobre un envío abre `ShipmentInfoModal` con todos los datos relevantes excepto precio y factores técnicos. Click fuera del modal o botón "Cerrar" lo cierra.

## Modelos clave

```typescript
interface RoutingPlan {
  branch_id: string;
  generated_at: string;
  last_mile: LastMileAssignment[];
  inter_branch: InterBranchAssignment[];
  unassigned: UnassignedShipment[];
  blocked_drivers: BlockedDriver[];
  driver_loads: DriverLoad[];      // todos los drivers no bloqueados
  vehicle_loads: VehicleLoad[];    // todos los vehículos del pool
  config_snapshot: RoutingConfig;
}

interface LastMileAssignment {
  driver_id: string;
  driver_name: string;
  shipments: string[];                  // tracking IDs nuevos del plan
  total_weight_kg: number;
  existing_count: number;
  existing_weight_kg: number;
  existing_shipments: string[];         // tracking IDs ya en out_for_delivery
  ordered_stops?: RouteStop[];          // secuencia VRP, sequence 1..N
  total_distance_km?: number;
  total_duration_min?: number;
  departure_min?: number;               // base para arrival_min de cada stop
  optimized_by?: "vrp" | "greedy";
}

interface RouteStop {
  tracking_id: string;
  sequence: number;        // 1-based
  arrival_min: number;     // min desde departure_min; -1 si unsequenced/manual
  unsequenced?: boolean;   // backend: envío sin coords
  manual?: boolean;        // cliente: reasignación manual sin VRP
  time_window?: "morning" | "afternoon" | "flexible";
  weight_kg: number;
}
```

`existing_shipments` se popula en backend pero también se "hereda" cliente-side cuando el operador promueve un chofer/vehículo del pool: la card recién creada copia el campo del `driver_loads` / `vehicle_loads` correspondiente para mostrar los envíos previos.

## Decisiones de diseño y trade-offs

### Por qué heurístico y no exacto

VRP es NP-duro. Soluciones exactas (branch & cut con CPLEX/Gurobi/OR-Tools) tardan minutos para 50+ paradas y requieren licencias o microservicios externos. Para nuestra escala (típicamente 10-30 paradas por chofer, 1-5 choferes por sucursal), un heurístico bien construido da resultados a 5-15% del óptimo en milisegundos, sin dependencias externas. La diferencia operativa es despreciable y el costo de implementación / mantenimiento es muy bajo.

### Por qué OSRM hardcodeado y no env var

Para mantener simple el deploy. La instancia pública es válida para dev y demo. En producción se reemplaza la string por la URL del OSRM self-hosted. El cliente tolera fallos (timeout, 5xx) con fallback transparente a Haversine, así que no es crítico.

### Por qué ventanas hard

Soft requiere tunear constantes que no tienen una respuesta correcta universal (¿cuánto castigar 30 min de retraso vs 60? ¿igual una ventana corta que una larga?). Hard se alinea con el flujo operativo existente — el envío conflictivo va a "Sin asignar" con razón clara y el operador decide. Las pruebas muestran que en práctica el operador prefiere ver el conflicto explícito antes que un plan que promete lo que no va a cumplir.

### Por qué el plan no se persiste en backend

- Concurrencia: dos operadores generando planes simultáneos no se pisan.
- Estado: no acumular planes obsoletos en DB.
- Iteración: editar libremente sin transacciones.
- Drift: el `Apply` re-valida cada item contra el estado actual, así que un plan "viejo" no causa daño — los items que no aplican fallan y el operador re-genera.

### Por qué solo NN + 2-opt (sin Relocate)

Probamos mentalmente Relocate y la complejidad post-construcción crece feo: hay que validar ventanas en ambas rutas, mantener consistencia de `Shipments[]` con `OrderedStops[]`, y el riesgo de loops es real. El beneficio incremental es marginal para los volúmenes que manejamos. Si en el futuro sucursales muy grandes lo justifican, se agrega.

### Por qué `existing_shipments` en lugar de hidratar todo en `shipments`

Mantener la separación es más segura para `Apply`: el handler itera `Shipments[]` y los transiciona a out_for_delivery. Si mezcláramos los existentes ahí, se intentaría re-transicionar envíos ya en out_for_delivery, lo cual fallaría con drift error o, peor, podría causar efectos no deseados.

### Por qué service time = 10 min hardcodeado

Es un promedio razonable para CABA con tipos mixtos de zona (microcentro lento + barrios rápidos). Se puede subir/bajar editando la constante en `routing.go:1060`. Hacerlo configurable por sucursal o por tipo de zona requiere agregar columnas a `routing_config` y campos al form de admin — no se hizo porque no había evidencia de necesidad real, pero es un cambio chico si se necesita.

## Limitaciones conocidas

- **Single-hop**: el algoritmo asume un viaje directo desde la sucursal. Para envíos que naturalmente requieren múltiples escalas (ej. CABA → Posadas), el piggyback ayuda pero no resuelve. Operativa real requiere intervención manual.
- **No considera tráfico en tiempo real**: incluso con OSRM, los tiempos son estáticos. No hay integración con APIs de tráfico (Waze, Google Maps).
- **No optimiza globalmente entre rutas**: cada ruta se optimiza individualmente con 2-opt. Un envío podría estar en la ruta del chofer 1 cuando geográficamente convendría más al chofer 2 — pero como NN ya distribuyó respetando carga, ese caso es minoritario.
- **Capacidad solo por peso y cantidad, no por volumen**: dos sobres ocupan menos lugar que dos cajas grandes pero pesan menos. El algoritmo no lo considera. Para flotas con mix de paquetería + electrónicos grandes habría que agregar una dimensión de volumen.
- **No predice demanda**: si la sucursal sabe que el día martes recibe siempre 50 envíos express después del mediodía, el algoritmo no lo anticipa. Cada plan se calcula con la foto actual.

## Observabilidad

Logs con prefijo `[routing]`:

- `[routing] OSRM falló, fallback a Haversine: <error>` — cuando falla el request a OSRM.
- `[routing] VRP devolvió solución vacía, fallback a greedy (branch=X, n=Y)` — cuando el solver falla y se cae al binPackLastMile clásico.

Métricas que vale la pena agregar (no implementadas hoy):

- Tiempo de cómputo de cada `GeneratePlan`.
- Hit rate de OSRM vs Haversine.
- Tasa de fallo de `Apply` por razón.
- Cantidad promedio de envíos por chofer y por vehículo en planes aplicados.

## Próximos pasos potenciales

En orden aproximado de retorno por esfuerzo:

1. **Configurabilidad de service time y velocidad media** desde `/routing-config`. Trivial, alto impacto operativo si las sucursales tienen perfiles muy distintos.
2. **Persistir el plan generado** para auditoría (snapshot in-time + apply log).
3. **Multi-day VRP / cola de diferidos**: envíos que quedaron sin asignar hoy se priorizan automáticamente mañana.
4. **OSRM self-hosted en producción**: cambiar la URL hardcoded por env var + container OSRM en infra.
5. **Soft time windows** opcional: permitir asignar con penalty si el operador prefiere "casi cumplir" a "rechazar".
6. **Optimización inter-ruta (Relocate / Or-opt)** cuando el volumen lo justifique.
7. **Predicción de tiempos con ML basado en historia**: usar trips reales para reemplazar la velocidad media constante.
