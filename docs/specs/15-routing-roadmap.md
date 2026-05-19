# Roadmap — Ruteo Inteligente: de envío-aware a red-aware

> **Estado**: propuesto · **Horizonte**: 14–16 meses · **Owner**: TBD
> Este documento es el plan maestro de evolución del módulo de ruteo. **No es una User Story** — es la guía que produce las US futuras de cada fase. Cada fase tiene un *decision gate* explícito con métricas numéricas: si no se cumplen, **se para o se rehace, no se avanza**.

---

## 1. Contexto

El ruteo actual (US-089 a US-099) funciona a **nivel sucursal**: el operador de una sucursal genera un plan que solo conoce los envíos parados ahí y los vehículos disponibles ahí en ese momento. Tres limitaciones estructurales se acumularon:

1. **Cada envío conoce su destino final pero no su trayectoria**. Si va de CABA a Mendoza pasando por Córdoba, esa decisión emerge accidentalmente del piggyback en cada generación de plan, no está planificada.
2. **El algoritmo es ciego a la red de vehículos**. No sabe que un camión va a llegar a Córdoba a las 14 hs, ni que otro va a quedar vacío en Mendoza mañana. Cada plan ve solo el snapshot local.
3. **No hay coordinación entre sucursales**. CABA y Mendoza pueden estar mandando vehículos a Córdoba el mismo día sin saberlo. Cada sucursal optimiza localmente.

La consecuencia operativa es la que conoce el equipo: envíos a destinos lejanos quedan estancados, kilómetros vacíos no se aprovechan, y la "planificación" del día depende del criterio del operador de turno.

Este roadmap lleva el ruteo desde "envío-aware con vehículos locales" hasta "envío-aware + flota-aware en horizonte multi-día con forecasting".

---

## 2. Visión de fases

```
Phase 0  ─────────────────────────────────────────────────────►  (continuo)
         Observabilidad y captura de datos

Phase 1  ─►  Phase 2  ─►  Phase 3  ─►  Phase 4
   C         Stage 1       Stage 2        Stage 3
multi-hop   fleet fwd    multi-branch   rolling horizon
                          coordinado    + forecasting
```

| Fase | Concepto | Lo que aporta | Sprints |
|---|---|---|---|
| **0** | Observabilidad | Datos para medir cada fase. Sin esto, Phase 4 no existe. | continuo desde día 1 |
| **1** | Multi-hop (Approach C) | Cada envío arrastra `planned_path`. Algoritmo agrupa por next-hop. | 3 |
| **2** | Fleet forward-looking | Plan considera vehículos en tránsito como recursos futuros. Backhaul matching. | 2 |
| **3** | Multi-branch coordinado | Plan único de red, no N planes locales. Reposicionamiento sugerido. | 3 |
| **4** | Rolling horizon + forecasting | Plan multi-día con forecast de demanda + solver MIP. | 4 |

**Principio de secuenciación**: cada fase asume el modelo de datos y la confianza operativa de la anterior. **No se paralelizan** las fases principales. Phase 0 corre en paralelo a todas.

---

## 3. Decision gates — el corazón del roadmap

Cada fase termina en un **gate** con métricas numéricas. El gate decide:
- **GO**: avanzar a la siguiente fase.
- **NO-GO TEMPORAL**: la fase funciona pero la siguiente no se justifica todavía (típicamente por volumen / madurez operativa). Congelar y revisar en 3-6 meses.
- **REWORK**: la fase no logró sus objetivos. Volver atrás antes de continuar.

| Gate | Métrica primaria | Threshold GO | Threshold REWORK |
|---|---|---|---|
| Fin Phase 1 | `override_rate` post-aplicación | ≤ baseline + 10% | > baseline + 30% |
| Fin Phase 1 | `stale_shipment_rate` (envíos > 5 días en hub) | ≥ 30% reducción vs baseline | sin mejora |
| Fin Phase 2 | `km_vacios` / `km_totales` | ≥ 15% reducción a 6 semanas | sin mejora a 12 semanas |
| Fin Phase 2 | `backhaul_acceptance_rate` | ≥ 40% de backhauls sugeridos se aplican | < 15% |
| Fin Phase 3 | A/B network-plan vs per-branch-plan | gana en 2 de 4 métricas primarias | no gana en ninguna |
| Fin Phase 3 | Tiempo de generación del network plan | ≤ 60 seg en operación normal | > 3 min |
| Phase 4 pre-flight | `forecast_MAPE` con datos de Phase 0 | ≤ 30% | > 50% |
| Fin Phase 4 | Mejora vs Phase 3 en `costo_estimado` | ≥ 10% reducción a 8 semanas | < 5% |

Las métricas primarias en A/B son: `km_vacios`, `envios_atrasados`, `override_rate`, `tiempo_a_aplicar`.

---

## 4. Phase 0 — Observabilidad (continuo)

### Objetivo

Capturar las métricas que cada fase posterior necesita para evaluar su gate. **Esto no es feature visible para el usuario final** — es infraestructura para que el roadmap sea evaluable.

### Métricas a instrumentar

#### Operativas del ruteo
| Métrica | Cómo se calcula | Granularidad |
|---|---|---|
| `plan.generation_time_ms` | wrap de `RoutingService.GeneratePlan` | por plan |
| `plan.window_coverage_pct` | salida del VRP de última milla | por plan, por chofer |
| `plan.manual_override_count` | diff entre plan generado y plan aplicado | por aplicación |
| `plan.drift_failures` | items con `failed` en `ApplyPlanResponse` | por aplicación |
| `plan.unassigned_count` por motivo | conteo de `Unassigned` agrupado por `Reason` | por plan |

#### Flota y red
| Métrica | Cómo se calcula | Granularidad |
|---|---|---|
| `vehicle.km_total` | suma de distancias por viaje, computada de eventos `start-trip` + `end-trip` | por vehículo, por día |
| `vehicle.km_vacios` | km recorridos con < 5% de capacidad ocupada | por vehículo, por día |
| `vehicle.idle_hours` | tiempo en `disponible` sin asignación | por vehículo, por día |
| `vehicle.utilization_pct` | `(suma_peso_asignado / capacity_kg) / km_total` | por viaje |

#### Envíos y demanda
| Métrica | Cómo se calcula | Granularidad |
|---|---|---|
| `shipment.hops_count` | conteo de eventos `at_hub` por envío | por envío |
| `shipment.time_per_hop` | delta entre eventos `at_hub` consecutivos | por envío, por leg |
| `shipment.stale_hours` | tiempo en `at_hub` sin avance | por envío |
| `od_pair.daily_volume` | conteo de envíos creados (origin_branch, final_branch, fecha) | por par, por día |
| `od_pair.weight_distribution` | histograma de peso por par O-D | por par, por mes |

### Stack técnico

- **Almacenamiento**: tabla `routing_metrics` (eventos crudos) + materialized views (agregados diarios/horarios). Postgres directo con índices BRIN por timestamp. **Sin** time-series DB dedicada hasta >10M filas.
- **Exposición**: `GET /admin/routing/metrics?metric=X&from=Y&to=Z`.
- **Dashboard**: Grafana / Metabase apuntando a Postgres (lo que ya use el equipo).
- **Backfill**: job one-shot que reconstruye métricas históricas desde `EventStore`. Se ejecuta al inicio y al cierre de Phase 0 inicial.

### Sprint inicial (1 sprint, semanas 1-2 del roadmap)

Sprint 0 — Instrumentación base:
- Tabla `routing_metrics` + migration
- Hooks en `RoutingService.GeneratePlan`, `RoutingService.ApplyPlan`, `VehicleRepo.Update`
- Backfill desde EventStore
- Endpoint admin + dashboard básico
- Documentación del esquema de métricas

### Output esperado

Al cerrar el primer sprint y antes de empezar Phase 1: **dashboard funcional con baseline de cada métrica de los últimos 90 días**. Sin esto, Phase 1 arranca a ciegas.

A los 3 meses: 90+ días de captura continua, suficiente para empezar a estimar forecasts en Phase 4.

---

## 5. Phase 1 — Multi-hop (Approach C) — 3 sprints

### Objetivo

Cada envío arrastra una trayectoria planeada (`planned_path`) explícita. El algoritmo de ruteo agrupa por **next-hop** en lugar de **destino final**. Operadores y clientes ven la trayectoria.

### Modelo de datos

#### Nueva entidad `BranchEdge`
```go
type BranchEdge struct {
    FromBranchID    string  // origen
    ToBranchID      string  // destino
    DistanceKm      float64 // Haversine fallback provincia
    AvgTransitHours float64 // observado del histórico
    Enabled         bool    // admin puede deshabilitar
    Source          string  // "auto" | "manual"
}
```

Tabla `branch_graph`. Auto-derivada de eventos `at_hub` consecutivos por envío.

#### Campos nuevos en `Shipment`
```go
PlannedPath     []string // ["caba","cordoba","mendoza"]
NextHopBranchID string   // derivado de PlannedPath[HopIndex+1]
HopIndex        int      // 0..len(PlannedPath)-1
PathRevision    int      // incrementa en re-plans
```

Las **cuatro ubicaciones** requeridas por CLAUDE.md: `model/shipment.go`, `db/migrate.go`, `projection/postgres_shipment.go`, `seed/seed.go`.

#### Evento nuevo
```go
EventShipmentPathPlanned = "shipment_path_planned"
// Emitido en: Create, ConfirmDraft, cada at_hub no-final, stale-replan
// Payload: { planned_path, next_hop, hop_index, revision, reason }
```

### Cambios algorítmicos

- `GeneratePlan` particiona `interBranchQ` por `NextHopBranchID`, no por `FinalBranchID` (`routing.go:140`).
- Piggyback (`routing.go:968-1039`) queda como **mecanismo de salvataje** secundario.
- `GeneratePlan` invoca `RoutingService.RecomputeStalePaths()` antes de armar el plan (opcional, idempotente).

### Sprint breakdown

| Sprint | Entregable | Tests |
|---|---|---|
| **1** — Grafo + read paths | Modelo `BranchEdge` + migration + repo Postgres. Job auto-derive de EventStore (backfill + nightly). Endpoint `GET /admin/branches/graph`. UI `/admin/branch-graph` read-only. Dijkstra + tests. | Path computation, auto-derive de fixtures, edge enabled/disabled |
| **2** — Integración con shipments | Campos en `Shipment`. Evento `shipment_path_planned`. Cálculo de path en Create, ConfirmDraft, projection de `at_hub`. `GeneratePlan` agrupa por `next_hop`. UI stepper en `ShipmentDetail`. | End-to-end CABA → Córdoba → Mendoza. Drift al avanzar hop |
| **3** — Re-plan + UI completa | Stale-replan con `stale_hub_threshold_hours` config. Métricas: `hops_per_shipment`, `path_deviation_rate`, `replan_count`. UI admin editable. Tracking público con trayectoria. ETA recomputado por hop. | Re-plan idempotente, stale detection, ETA correcta |

### Decision gate Phase 1

**GO a Phase 2 si:**
- `override_rate` ≤ baseline + 10%
- `stale_shipment_rate` (envíos > 5 días en hub) ≥ 30% reducción vs baseline
- Sin regresiones críticas en producción durante 4 semanas post-deploy
- Operadores reportan que entienden la trayectoria (validación cualitativa con ≥ 3 sucursales)

**REWORK si:**
- `override_rate` > baseline + 30% — operadores rechazan el path planeado
- Bugs sistémicos en path computation (paths imposibles, loops)
- Performance: `GeneratePlan` lento > 2x baseline

### US derivadas

- US-100: Trayectoria planeada del envío (visible en detalle)
- US-101: Re-planificación automática de envíos estancados
- US-102: Grafo de sucursales editable por admin
- US-103: Tracking público con trayectoria visible al cliente

---

## 6. Phase 2 — Fleet forward-looking (Stage 1) — 2 sprints

### Objetivo

El plan considera vehículos en tránsito como **recursos proyectados**. El operador puede planificar despachos para más tarde en el día sabiendo qué flota va a estar disponible. El sistema sugiere backhauls.

### Modelo de datos

```go
type VehicleProjection struct {
    VehicleID         string
    AvailableAt       string    // branch_id donde estará disponible
    AvailableFromTime time.Time // momento estimado
    Capacity          float64
    Source            string    // "actual" | "projected"
}

type BackhaulSuggestion struct {
    VehicleID       string
    OutboundDispatchID string  // referencia al despacho de ida
    InboundShipments []string  // tracking IDs del retorno
    InboundWeightKg  float64
    FillRatePct      float64
}
```

`InterBranchAssignment` se extiende con `Backhaul *BackhaulSuggestion`.

### Cambios algorítmicos

- `filterAvailableVehicles` ahora retorna proyecciones, no solo actuales. `horizon_hours` configurable (default 8).
- Cada `InterBranchAssignment` tiene `SuggestedDepartureTime`. Si depende de un vehículo proyectado, se respeta su ETA.
- Segunda pasada en `GeneratePlan` post-armar dispatches: por cada vehículo que se va, buscar envíos en el destino que vuelvan al origen → sugerir backhaul.

### Sprint breakdown

| Sprint | Entregable | Tests |
|---|---|---|
| **4** — Vehicle ETA + projection | `expected_arrival_at` computado en `start-trip`. `VehicleRepo.ListProjected()`. `GeneratePlan` considera proyectados. UI muestra "salida prevista 15:00". | Plan con vehículo proyectado, drift cuando llega tarde |
| **5** — Backhaul matching | `BackhaulSuggestion` en plan. Segunda pasada en `GeneratePlan`. UI muestra ida + vuelta en la card del despacho. Métrica `backhaul_acceptance_rate`. | Backhaul aceptado, rechazado, capacidad insuficiente |

### Decision gate Phase 2

**GO a Phase 3 si:**
- `km_vacios / km_totales` ≥ 15% reducción a 6 semanas post-deploy
- `backhaul_acceptance_rate` ≥ 40%
- `vehicle.idle_hours` reducidos ≥ 20%

**NO-GO TEMPORAL si:**
- Mejoras parciales pero volumen sigue siendo bajo (< 100 envíos/día) — no justifica complejidad de Phase 3 todavía. Congelar y revisar trimestralmente.

**REWORK si:**
- Backhauls aceptados < 15% — el modelo es operativamente inviable (choferes no aceptan, tiempos no cierran). Revisar antes de avanzar.

### US derivadas

- US-110: Plan considera vehículos llegando más tarde en el día
- US-111: Sugerencia automática de carga de retorno (backhaul)
- US-112: Operador puede aceptar o rechazar backhaul independiente de la ida

---

## 7. Phase 3 — Multi-branch coordinado (Stage 2) — 3 sprints

### Objetivo

El plan deja de ser per-sucursal. Se genera un **plan único de red** que coordina decisiones entre sucursales: consolida despachos cross-branch, sugiere reposicionamiento de vehículos vacíos, evita duplicaciones.

**Este es el salto más controvertido del roadmap.** Cambia el paradigma operativo, no solo el código.

### Modelo de datos

```go
type NetworkPlan struct {
    GeneratedAt    time.Time
    HorizonHours   int                              // 24 típicamente
    BranchPlans    map[string]model.RoutingPlan     // slice por sucursal
    NetworkMoves   []NetworkMove                    // cross-branch coordinados
    EmptyMoves     []EmptyMove                      // reposicionamiento sin carga
    GlobalMetrics  NetworkMetrics
}

type EmptyMove struct {
    VehicleID         string
    FromBranchID      string
    ToBranchID        string
    Reason            string  // "balanceo_demanda_futura"
    EstimatedCost     float64 // km × costo_por_km
    EstimatedBenefit  float64 // reducción esperada de envíos atrasados
}
```

### Cambios algorítmicos

El greedy actual se generaliza. Función objetivo explícita y editable:

```
minimize:  α · km_total + β · envios_atrasados + γ · vehiculos_ociosos

subject to:
    - ventanas horarias por envío
    - capacidad por vehículo
    - hops del path planeado (de Phase 1)
    - disponibilidad proyectada de vehículos (de Phase 2)
```

α, β, γ son configurables por admin desde `/admin/routing-config`.

Sigue siendo heurístico (no MIP todavía — eso es Phase 4). Pero la decisión se toma a nivel red.

### Cambio organizacional

**Quién dispara el plan de red.** Tres opciones a evaluar con producto/ops antes de Sprint 6:

| Opción | Pros | Contras |
|---|---|---|
| Rol nuevo `network_planner` | Responsabilidad clara | Requiere headcount o reasignación |
| Automation diaria 06:00 AM | Sin fricción operativa | Cambios manuales post-generación más complejos |
| Híbrido (automation + override de rol) | Mejor de los dos | Requiere ambas implementaciones |

**Recomendación**: **híbrido**. Automation default + rol `network_planner` puede regenerar manualmente.

### Sprint breakdown

| Sprint | Entregable | Tests |
|---|---|---|
| **6** — Modelo + algoritmo | `NetworkPlan` model. Algoritmo extendido. Endpoint `POST /routing/network-plan`. Función objetivo configurable. | Network plan funcional, comparado contra suma de planes per-branch |
| **7** — Permisos, UI, rol nuevo | Rol `network_planner` + permisos. UI `/network/plan` con vista global. UI `/routing` muestra slice de la sucursal del operador. Notificaciones cross-branch en overrides. | Permisos por rol, override notification |
| **8** — A/B en producción | Switch entre per-branch y network plan. Dashboard A/B. Tuning de α, β, γ basado en datos reales. | A/B framework, métricas comparativas |

### Decision gate Phase 3

**Post A/B de 4-6 semanas:**

**GO a Phase 4 si:**
- Network plan gana en ≥ 2 de 4 métricas primarias (`km_vacios`, `envios_atrasados`, `override_rate`, `tiempo_a_aplicar`)
- `tiempo_de_generación_network_plan` ≤ 60 seg
- Operadores del rol `network_planner` reportan que la herramienta es accionable

**NO-GO TEMPORAL si:**
- Network plan empata con per-branch. Mantener ambos modos, decidir según preferencia operativa. Congelar Phase 4.

**REWORK si:**
- Network plan pierde en > 2 métricas — el algoritmo está mal o el cambio organizacional no se completó. Investigar.

### Riesgo organizacional crítico

**Antes de Sprint 6**: alineación explícita con jefes de sucursal de las 6 sucursales. La pregunta "¿quién manda en mi sucursal?" debe estar resuelta con producto. Sin esto, el rollout va a fracasar por razones no técnicas.

### US derivadas

- US-120: Plan de red coordinado
- US-121: Reposicionamiento de vehículos vacíos sugerido
- US-122: Rol Network Planner
- US-123: Configuración de pesos α, β, γ de la función objetivo
- US-124: A/B entre plan de red y plan per-sucursal

---

## 8. Phase 4 — Rolling horizon + forecasting (Stage 3) — 4 sprints

### Objetivo

El plan deja de ser "hoy" y pasa a ser "los próximos N días". Solo el día 1 es **firme**; los días 2-N son tentativos y se re-planean cada noche. Decisiones de hoy consideran demanda esperada de mañana.

**Acá entramos en territorio operations research clásico.** El nivel de rigor sube.

### Modelo de datos

```go
type ODForecast struct {
    OriginBranch       string
    DestinationBranch  string
    Date               time.Time
    PredictedCount     float64
    PredictedWeightKg  float64
    ConfidenceInterval [2]float64
}

type RollingHorizonPlan struct {
    GeneratedAt  time.Time
    HorizonDays  int                          // 5-7 típicamente
    DayPlans     []NetworkPlan                // un NetworkPlan por día
    Commitments  []Commitment                 // día 1: firme
    Tentative    []TentativeDispatch          // días 2+: proyección
}
```

### Forecasting

**Modelo simple primero**: rolling average + ajuste estacional (día de semana, principio/fin de mes) + Fourier para estacionalidad anual si hay suficientes datos.

**No usar ML**. Para 6 sucursales × 6 destinos × días, exponential smoothing alcanza. ML necesita datos que no van a estar y agrega complejidad sin ROI a esta escala.

**Métrica de calidad del forecast**: MAPE (Mean Absolute Percentage Error). Threshold:
- MAPE ≤ 30%: usable.
- MAPE > 50%: descartar, demanda demasiado errática para predecir a este horizonte.

### Solver

**Decisión técnica clave**: qué solver usar. Recomendación: **OR-Tools vía servicio Python separado** (`logitrack_optimizer` nuevo repo). El backend Go envía el problema serializado, recibe la solución.

| Opción | Pros | Contras |
|---|---|---|
| OR-Tools (Google) | Open source, gratis, VRP-friendly, buena doc | Bindings Go limitados; servicio Python aparte |
| Gurobi | El mejor MIP solver del mercado | Comercial, ~$10k/año |
| HiGHS | Open source nativo Go | Más limitado en modelos complejos |
| Heurística custom | Cero deps externas | Pierde el punto de Phase 4 |

Latencia esperada para problemas de tamaño Logitrack (6 sucursales, 5-7 días, ~100 envíos/día): 5-30 seg. Aceptable para plan diario.

### Sprint breakdown

| Sprint | Entregable | Tests |
|---|---|---|
| **9** — Demand forecasting | Modelo de forecast (exponential smoothing + estacionalidad). `ForecastService.Predict(horizonDays)`. Backfill con datos de Phase 0. Métrica MAPE. UI admin para ver forecasts. | Forecast vs real, MAPE acceptable |
| **10** — MIP solver integration | Servicio Python `logitrack_optimizer` con OR-Tools. Protocolo gRPC con backend Go. Modelo MIP simplificado funcional. Time limit + fallback a Phase 3 heurística. | Solver converge, fallback funciona, latencia |
| **11** — Multi-day plan model + UI | `RollingHorizonPlan` model. UI Gantt-style multi-día. "Commitments" vs "tentative" diferenciados. Capacidad de pin manual. | Re-planificación diaria, commitments respetados |
| **12** — Production rollout + tuning | A/B framework extendido (Phase 3 vs Phase 4). Dashboard de calidad de forecast vs decisiones. Re-tuning iterativo de pesos. | A/B comparativo, tuning automático |

### Decision gate pre-Phase 4

**Antes de empezar Sprint 9**:
- Phase 0 debe tener ≥ 90 días de datos limpios.
- `forecast_MAPE` calculado con backtesting sobre datos históricos ≤ 30%. Si > 50%, **no empezar Phase 4** — el forecasting no es viable a esta escala. Considerar congelar en Phase 3.

### Decision gate Phase 4

**Post A/B de 8 semanas:**

**GO operación normal si:**
- Phase 4 mejora `costo_estimado` ≥ 10% vs Phase 3
- `forecast_MAPE` se mantiene ≤ 30% en producción
- `tiempo_generación_rolling_plan` ≤ 5 min

**FREEZE si:**
- Phase 4 < 5% mejora vs Phase 3 — la complejidad agregada no se justifica. Mantener Phase 3 como producción.

**REWORK si:**
- Forecast accuracy se degrada con datos reales (drift) — el modelo simple no captura la realidad. Revisar antes de iterar.

### US derivadas

- US-130: Forecasting de demanda por par origen-destino
- US-131: Plan multi-día con commitments y tentativos
- US-132: Solver MIP para optimización de red
- US-133: Visualización Gantt del plan de los próximos N días
- US-134: Re-planificación nocturna automática

---

## 9. Riesgos consolidados

| Riesgo | Fase | Mitigación |
|---|---|---|
| Phase 0 se posterga porque "no es feature visible" | 0 | Owner explícito, métrica de "días de histórico capturados", reportar mensualmente |
| Operadores no confían en `planned_path` | 1 | UX research con 3 sucursales antes de cerrar Sprint 3. Override gate. |
| Backhauls no aceptados por choferes (cansancio, doble turno) | 2 | Validación con choferes antes de Sprint 5. Posible config "backhaul opt-in por chofer". |
| Cambio organizacional rebotado por jefes de sucursal | 3 | Antes de Sprint 6: alineación con jefes. Sin alineación, **no avanzar** aunque el código esté listo. |
| Network plan tarda demasiado | 3 | Cap de complejidad heurística + cache de grafo. Time limit explícito. |
| Forecast malo → MIP optimiza fantasía | 4 | MAPE gate pre-Sprint 9. Si no pasa, congelar Phase 4. |
| MIP solver no converge en problemas reales | 4 | Time limit + fallback automático a Phase 3. Monitoreo de `solver_timeout_rate`. |
| Operador no entiende decisiones del solver | 4 | Explicabilidad: cada decisión devuelve justificación ("este envío ahorra X km vs alternativa"). UI muestra rationale. |
| Override rate creep entre fases | 1-4 | Métrica primaria en todos los gates. Si sube, congelar y entender por qué. |

---

## 10. Kill criteria — cuándo NO avanzar

El roadmap debe ser **descartable** si los datos lo contradicen. Criterios de parada:

| Condición | Acción |
|---|---|
| Volumen estancado < 100 envíos/día durante 6 meses | Congelar en Phase 2. Phase 3-4 no se justifica. |
| Cantidad de sucursales se mantiene en 6 indefinidamente | Phase 4 sigue siendo viable pero Stage 4 (Service Network Design) jamás se justifica. Documentar como "no en alcance". |
| Override rate operativo > 50% en cualquier fase | Parar. La herramienta no se está usando como está pensada. Volver a UX research. |
| Costo de mantenimiento del optimizer Python > beneficio medible | Reemplazar por heurística avanzada en Go. Phase 4 deja de tener el solver. |
| Cultura operativa rechaza automation a nivel red | Phase 3 se congela permanentemente. Phase 1-2 son el final del roadmap. |

---

## 11. Lo que NO está en alcance

Explícitamente fuera del roadmap (Stage 4 / "big leagues"):

- **Service Network Design completo** (lanes con frecuencia fija, optimización táctica mensual). Solo justificable con ≥ 20 sucursales y ≥ 1000 envíos/día.
- **ML para forecasting**. Modelo estadístico simple alcanza a esta escala. ML agrega complejidad sin ROI.
- **Solver propio**. Usar OR-Tools, no construir.
- **Real-time route adjustment**. Vehículos en tránsito no se re-rutean. Demasiado riesgo, poco beneficio a esta escala.
- **Integración con telemetría GPS en vivo**. Hasta tener Phase 3 estable, ETAs son suficientes.
- **Optimization de crew scheduling (HOS, turnos, descansos)**. Producto separado.
- **Cross-docking optimization**. Modelo de negocio distinto.

---

## 12. Timeline indicativo

Asumiendo **1 engineer senior al 70% en routing + 1 part-time PM/validador operativo**:

| Fase | Sprints | Calendar realista | Acumulado |
|---|---|---|---|
| 0 (inicial) | 1 | 2 semanas | 2 semanas |
| 1 (multi-hop) | 3 | 2 meses | 2.5 meses |
| 2 (fleet fwd) | 2 | 1.5 meses + 4 sem A/B | 5 meses |
| 3 (multi-branch) | 3 | 2.5 meses + 6-8 sem A/B | 9-10 meses |
| 4 (rolling horizon) | 4 | 3.5 meses + 8 sem A/B | 14-16 meses |

**Con 2 engineers al 70%**: baja a ~10-12 meses. Los A/B son tiempo calendario, no se aceleran con más personas.

---

## 13. Skills necesarios

| Fase | Skills | Equipo |
|---|---|---|
| 0, 1, 2 | Go + React + SQL | Equipo actual |
| 3 | + product/ops alignment + heurística | Equipo + jefes operaciones |
| 4 | + operations research + Python (optimizer service) + estadística aplicada | Hire, partner externo, o consulting interno (MELI LogTech) |

---

## 14. Glosario

- **Approach C / Multi-hop**: enfoque donde cada envío arrastra una trayectoria planeada explícita (`planned_path`).
- **Backhaul**: carga de retorno. Aprovechar el viaje de vuelta de un vehículo.
- **Decision gate**: punto de evaluación con métricas numéricas que decide GO / NO-GO / REWORK.
- **Drift**: divergencia entre el estado del plan al generarlo y al aplicarlo.
- **Fill rate**: porcentaje de capacidad utilizada en un despacho.
- **HOS**: Hours of Service. Regulaciones de horario laboral de choferes.
- **Lane**: par origen-destino con servicio regular en logística LTL.
- **LTL**: Less-than-Truckload. Cargas que comparten vehículo entre múltiples clientes/destinos.
- **MAPE**: Mean Absolute Percentage Error. Métrica de calidad de forecast.
- **MIP**: Mixed Integer Programming. Clase de problemas de optimización combinatoria.
- **Multi-hop**: envío que pasa por uno o más hubs intermedios entre origen y destino.
- **Piggyback**: agregar envíos huérfanos a despachos ya armados oportunísticamente.
- **Rolling horizon**: plan multi-día donde solo el día 1 es firme y se re-planea diariamente.
- **Service Network Design (SND)**: diseño de la red de servicios (lanes, frecuencias, capacidades) a nivel táctico.
- **Stale shipment**: envío que lleva demasiado tiempo en un hub sin avance.
- **VRP**: Vehicle Routing Problem. Familia clásica de problemas de optimización de rutas.

---

## 15. Próximos pasos inmediatos

1. **Aprobar este roadmap** con product, ops y engineering. Sin alineación, no arrancar.
2. **Asignar owners**: uno técnico (ingeniería), uno operativo (producto/ops).
3. **Empezar Phase 0 sprint inicial** — 2 semanas, instrumentación base.
4. **Calendarizar gate reviews** post cada fase como decisión formal (no implícita).
5. **Generar las US específicas** de Phase 1 (US-100 a US-103) como specs separadas siguiendo el formato del resto del directorio.

> **Recordatorio operativo**: los decision gates son reales. Este roadmap está diseñado para ser **detenible** en cualquier punto. La mejor versión de este producto puede ser Phase 2, Phase 3, o Phase 4 — eso lo dictan los datos, no este documento.
