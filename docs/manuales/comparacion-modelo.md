# Comparación: modelo anterior vs. modelo nuevo

> Side-by-side de qué se podía hacer antes vs. qué se puede hacer ahora.
>
> **Audiencia**: tech leads, decisores de producto, evaluadores de la propuesta.
> Lectura sugerida después del `manual-negocio.md` para entender el QUÉ cambió y antes del `manual-usuario.md` para entender el CÓMO se usa.

---

## 1. Resumen ejecutivo de la diferencia

| Eje | Modelo anterior | Modelo nuevo |
|---|---|---|
| **Inteligencia** | A nivel sucursal (cada operador decide aislado) | A nivel red (sucursales coordinan via insights cross-branch) |
| **Horizonte** | Solo "hoy" | Hoy firm + 5-14 días tentativos (rolling horizon) |
| **Decisión de trayectoria** | Implícita (emerge del piggyback ocasional) | Explícita (cada envío arrastra su `planned_path`) |
| **Vehículos considerados** | Solo los disponibles en el momento | Disponibles ahora + en tránsito que llegarán dentro del horizon |
| **Backhauls** | No considerados | Sugeridos sistemáticamente |
| **Detección de problemas** | Manual (operador nota o cliente reclama) | Automática (stale replan, déficit de demanda, etc.) |
| **Forecasting** | Inexistente | Statistical por día de semana, MAPE 12% en datos del POC |
| **Visibilidad cliente** | "En camino" | Stepper con trayectoria completa |
| **UI manager** | Múltiples pantallas dispersas | Hub consolidado `/network` con tabs |
| **Mediciones del sistema** | No había | 4 tablas de métricas, dashboard admin |
| **Unidad de manipulación** | Envíos individuales sueltos | **Pallets** (inter-sucursal) — agrupación atómica |
| **Descarga en hub intermedio** | Todo el cargo se descarga + reclasifica | **Descarga parcial**: solo pallets cuyo `next_hop == hub`; resto sigue intacto |
| **Handling físico promedio** | ~3-4 operaciones por envío por viaje | ~1 operación por pallet por hub (~90% reducción) |

---

## 2. Cambios por dimensión

### 2.1. Trayectoria del envío

**Antes** — un envío de CABA a Mendoza:
```
tracking_id:         LT-001
origin_branch_id:    caba
final_branch_id:     mendoza   ← única info de destino
receiving_branch_id: caba       ← se actualiza al avanzar
status:              at_origin_hub
```

Operador de CABA al verlo: "este va a Mendoza, lo despacho directo o consolido".

Si el envío llega a Córdoba como hub intermedio, los operadores de Córdoba lo ven igual que cualquier otro envío. No distinguen "para entregar en Córdoba" vs "de paso a Mendoza".

**Después** — mismo envío:
```
tracking_id:         LT-001
origin_branch_id:    caba
final_branch_id:     mendoza
receiving_branch_id: caba
status:              at_origin_hub
planned_path:        ["caba", "cordoba", "mendoza"]   ← NUEVO
next_hop_branch_id:  cordoba                          ← NUEVO
hop_index:           0                                ← NUEVO
path_revision:       1                                ← NUEVO
```

El envío sabe exactamente por dónde va a pasar. Esto desbloquea:

- **Consolidación más agresiva**: el algoritmo agrupa por `next_hop`, no por `final_branch`. Los envíos a Mendoza desde CABA cuentan para llenar el camión a Córdoba.
- **UI cliente con stepper visual**: el cliente ve `CABA → Córdoba → Mendoza`.
- **UI operativa diferenciada**: operadores de Córdoba ven el envío como "en tránsito a Mendoza", no como destino final.
- **Re-planificación automática (stale-replan)**: si un envío queda atascado en Córdoba, el sistema recomputa su path.

### 2.2. Algoritmo de consolidación

**Antes**:
```
para cada destino final:
  si peso_total ≥ min_fill_rate × capacidad_camión:
    dispatch
  si no:
    unassigned ("esperando_consolidacion")

post-paso: piggyback oportunístico  
  → para cada unassigned, ver si algún dispatch ya armado pasa cerca
```

Resultado: CABA tiene 20 kg a Mendoza y 400 kg a Córdoba. Mendoza no llega al fill rate → unassigned. Piggyback rescata los 20 kg sumándolos al camión que va a Córdoba (Córdoba es más cerca de Mendoza que CABA).

Esto funcionaba, pero era **una reacción a posteriori**, no una decisión planificada. Si no había despacho a Córdoba ese día, los 20 kg quedaban estancados indefinidamente.

**Después**:
```
para cada envío:
  next_hop = planned_path[hop_index + 1]
  
para cada next_hop:                          ← agrupación por NEXT HOP, no destino final
  si peso_total ≥ min_fill_rate × capacidad:
    dispatch
  si no:
    unassigned

post-paso: piggyback (mecanismo de salvataje secundario)
post-paso: stale-replan para envíos atascados > 48h
```

Resultado: CABA tiene 20 kg a Mendoza (`next_hop = cordoba`) y 400 kg a Córdoba (`next_hop = cordoba`). El grupo "Córdoba" suma 420 kg. Se despacha. Los 20 kg ya estaban planificados como parte del flujo CABA→Córdoba, no rescatados accidentalmente.

**Cambio conceptual**: el ruteo planifica la red, no reacciona a cada despacho aislado.

### 2.3. Visión de flota

**Antes**: `filterAvailableVehicles(branchID)` devolvía solo vehículos con status `disponible` o `en_carga` en esa sucursal **ahora**.

> "Tengo 2 furgonetas disponibles. Despacho lo que entre en ellas. Lo que no, espera mañana."

**Después**: el algoritmo conoce los vehículos **proyectados** — vehículos `en_transito` que llegarán a esta sucursal dentro del `fleet_projection_horizon_hours` (default 8h).

> "Tengo 2 furgonetas disponibles + 1 camión que llega a las 14:30. Si la carga es urgente, planifico salida a las 15:00."

**Datos nuevos en el plan**:
- `IncomingVehicles[].estimated_arrival_at`: ETA del vehículo en camino
- `InterBranchAssignment.suggested_departure_time`: horario sugerido de salida cuando depende de un vehículo proyectado

### 2.4. Backhauls

**Antes**: no existían en el sistema. Si un camión va de CABA a Córdoba, vuelve vacío. La carga de retorno se gestiona ad-hoc (operador de Córdoba carga lo que tenga cuando el camión llega).

**Después**: para cada despacho de A→B, el sistema busca shipments en B con destino A y propone:

```
InterBranchAssignment.backhaul: {
  shipments: ["LT-X", "LT-Y", "LT-Z"],
  total_weight_kg: 320,
  fill_rate_pct: 64
}
```

Aparece en la UI del despacho como badge `↩ Retorno 64% · 320 kg`.

**Importante**: la sugerencia es **informativa**, no automática. El operador decide.

### 2.5. Vista cross-branch (network plan)

**Antes**: cada sucursal opera aislada. El gerente que quiere ver "qué está pasando en toda la red" tenía que abrir el plan de cada sucursal una por una y consolidar mentalmente.

**Después**: pantalla `/network` con:
- **6 KPIs agregados**: vehículos despachados, asignados/sin asignar, util prom, idle, déficit
- **Empty moves sugeridos**: vehículos idle en una sucursal vs sucursales con déficit → propuestas de reposicionamiento
- **Consolidaciones identificadas**: pares de sucursales despachando al mismo destino
- **Tabla resumen** por sucursal

### 2.6. Forecasting

**Antes**: no existía. Las decisiones eran 100% reactivas.

**Después**: predicción estadística por día de semana sobre últimos 90 días.

- **Modelo**: media + desvío estándar de observaciones del mismo día de semana
- **Confianza**: alta (≥ 12 obs), media (4-11), baja (1-3), none (0)
- **Backtest MAPE**: ~12% en datos del POC (gate < 30%)
- **Salida**: predicción por par O-D, por día, hasta 14 días vista

### 2.7. Plan multi-día (rolling horizon)

**Antes**: el plan era de "hoy". No había noción de "mañana" ni "la semana que viene".

**Después**: 
- **Día 1 (firm)**: el plan global real del día, ya generado y aplicable
- **Días 2-N (tentative)**: proyección basada en forecast — cuánto volumen se espera por par O-D, cuántos vehículos serían necesarios
- **Rolling**: cada día se desplaza una posición

Útil para capacity planning, scheduling de mantenimiento, contrataciones temporales.

### 2.8. Stale replan

**Antes**: si un envío se quedaba 5 días en un hub intermedio sin moverse, nadie se enteraba hasta que el cliente reclamaba.

**Después**: cada vez que se genera el plan de una sucursal, se ejecuta `runStaleReplan`:

```
Para cada envío en at_hub/at_origin_hub que lleva > stale_hub_threshold_hours sin moverse:
  recomputar planned_path desde su ubicación actual
  emitir EventShipmentPathPlanned(reason="stale_replan")
  log warning
```

Si el envío no tiene camino disponible → cuenta como `stuck` en el plan. Señal accionable.

### 2.9. Grafo de sucursales

**Antes**: implícito. La conectividad emergía del hecho de que un camión iba de A a B porque había un envío de A a B.

**Después**: tabla `branch_graph` con aristas explícitas:
- **Auto-derivadas**: del histórico de tránsitos observados
- **Manuales**: el admin puede agregar/deshabilitar aristas
- **Cada arista**: distancia, tránsito promedio, count de uso, estado

Permite a Dijkstra calcular shortest path entre cualquier par de sucursales para definir `planned_path`.

### 2.10. UI

**Antes** (estado intermedio del proyecto, antes de la consolidación):

Nav bar tenía 9+ links de ruteo:
- Ruteo
- Métricas ruteo
- Grafo sucursales
- Plan de red
- Rolling horizon
- Config. ruteo
- Config. ML
- ...

**Después**: nav bar consolidada a 3 links principales:
- **Ruteo** (operativa, sin cambios)
- **Plan de red** (3 tabs: Hoy / Próximos días / Métricas históricas)
- **Config. ruteo** (2 tabs: Parámetros / Grafo)

Reducción del ruido cognitivo del 67%. Tab activo en URL → bookmarkable.

---

## 3. Tabla feature-por-feature

| Feature | Modelo anterior | Modelo nuevo |
|---|---|---|
| Plan diario per-sucursal | ✅ Funcional | ✅ Mejorado (path-aware, projected fleet) |
| Última milla con VRP | ✅ | ✅ (sin cambios) |
| Drag-and-drop de reasignación | ✅ | ✅ (sin cambios) |
| Plan global de la red | 🟡 Concatenación de planes | ✅ Con insights cross-branch |
| `planned_path` en shipments | ❌ | ✅ |
| `next_hop_branch_id` para consolidación | ❌ | ✅ |
| ETA recomputado en cada hop | ❌ | ✅ |
| Stale replan automático | ❌ | ✅ |
| Vehículos proyectados | ❌ | ✅ |
| Backhaul matching | ❌ | ✅ Sugerencia (display) |
| Empty move suggestions | ❌ | ✅ |
| Consolidation opportunities | ❌ | ✅ |
| Forecasting de demanda | ❌ | ✅ |
| Rolling horizon multi-día | ❌ | ✅ |
| Grafo de sucursales editable | ❌ | ✅ |
| Tracking público con stepper | ❌ | ✅ |
| Métricas observabilidad | ❌ | ✅ 4 tablas + backfill |
| Manual override count | ❌ | ✅ (capturado en cada apply) |
| Pallets (agrupación atómica) | ❌ | ✅ Auto-creados al apply + manuales via API |
| Descarga parcial multi-hop | ❌ (todo se descargaba en cada hub) | ✅ Solo pallets cuyo next_hop = hub actual |
| Pallet con trazabilidad histórica | ❌ | ✅ `desarmado` persiste en DB para auditoría |

---

## 4. Lo que NO cambió (preservación intencional)

Decisiones tomadas para minimizar riesgo de regresión:

- **State machine de status del envío**: las transiciones (`at_origin_hub → loaded → in_transit → at_hub → out_for_delivery → delivered`) son las mismas
- **Pricing**: precio se congela al confirmar, sin cambios
- **Permisos por sucursal**: operator de CABA sigue viendo solo envíos `receiving_branch_id = caba`
- **Flota**: vehículos, status flow, asignación a vehículo
- **VRP de última milla**: sigue siendo el mismo solver con paradas ordenadas
- **Returns** (`is_returning = true`): el flujo de devoluciones funciona igual, solo que ahora el path también se calcula para el camino inverso

---

## 5. Limitaciones honestas del modelo nuevo

No vendo lo que no construí:

| Limitación | Por qué | Cuándo se resuelve |
|---|---|---|
| Backhaul es display-only | Sprint 5 quedó como sugerencia. El operador acciona manualmente. | Si producto pide accionable, +1 sprint |
| Empty move es display-only | Igual que backhaul. Sugerencia, no automático. | Idem |
| Forecast no incluye feriados | El modelo es estadístico simple. No conoce calendario argentino. | Phase 4+: agregar lookup de feriados |
| Rolling plan día 1 firm = 0 sin regenerar | Si el cron de las 08:00 no corrió, día 1 muestra cero. UX podría decir "plan no generado". | Refactor menor |
| Algoritmo es heurístico, no óptimo | MIP solver descartado para el POC. | Phase 4 stage 3 (cuando volumen lo justifique) |
| Forecasting es univariate | Solo mira el histórico del par O-D, no señales externas (clima, eventos). | Out of scope para POC |
| Sin re-routing en tiempo real | Un envío en tránsito mantiene su path. No se re-rutea si pasa algo. | Out of scope |
| Sin pinning manual de tentativos | El operador no puede "fijar" un dispatch del día 3. | Si producto lo pide, +1 día |
| Pallets no se usan en última milla | Por diseño — última milla entrega casa por casa, no agrupada. | No es limitación: es decisión de modelo |
| No hay UI dedicada para palletizar manualmente | Operador solo via API. Auto-palletize cubre el 95% de los casos. | Si hay demanda operativa: +1 sprint UI |
| Pallet capacity en slots no enforced en routing | El algoritmo de despacho usa solo kg como restricción de capacidad — slots de pallet no se cuentan. | Si la flota tiene restricción de slots: +1 sprint |

---

## 6. Riesgos del cambio

### 6.1. Adopción operativa

**Riesgo**: los operadores siguen aplicando criterios viejos e ignoran sugerencias del network plan.

**Mitigación**:
- Métrica `manual_override_count` capturada en cada apply
- Si > 30% sostenido, indicar que el algoritmo no convence → revisar parámetros
- Training/onboarding con los gerentes

### 6.2. Calidad del seed inicial del grafo

**Riesgo**: si el grafo no refleja la realidad operativa, los paths son malos.

**Mitigación**:
- Auto-derive nocturno actualiza las aristas con histórico real
- Admin puede crear aristas manuales si una conexión real no aparece en el histórico
- Toggle enabled/disabled sin destruir datos

### 6.3. Forecasting con poca data histórica

**Riesgo**: para pares O-D con poca demanda, el forecast da "low/none confidence" → poco valor.

**Mitigación**:
- Banner de MAPE indica calidad global del modelo
- Cada predicción individual muestra nivel de confianza
- El operador filtra ruido visualmente (chips de colores)

### 6.4. Performance con escala

**Riesgo**: heurístico con O(N² × días). Para 50+ sucursales podría volverse lento.

**Mitigación**:
- Profileo claro en métricas (`generation_time_ms`)
- Roadmap contempla migración a MIP solver
- Caching del grafo (refresca con auto-derive nocturno)

---

## 7. Decisiones de diseño explícitas

Decisiones que tomamos a propósito (no por accidente):

1. **Heurístico antes que MIP**: para 6 sucursales, MIP es bazoocas-vs-mosquitos.
2. **Statistical antes que ML**: para 90 días de histórico, exp smoothing alcanza.
3. **Display antes que action**: backhaul y empty moves son sugerencias, no se ejecutan solas. El humano decide.
4. **Auto-derive del grafo**: el sistema aprende su topología, el admin solo confirma.
5. **Tab consolidation en UI**: 6 pantallas → 3 con tabs. Bookmarkable via URL.
6. **Persistencia en projection**: el plan se persiste en `routing_plans` (JSONB), no se regenera en cada lectura.
7. **POC sin compat hacia atrás**: el sistema arranca con seed, no convive con data legacy.
8. **Sin LLM**: estabilidad y determinismo sobre "wow factor".

Cada una está fundamentada en discusión documentada en `docs/specs/15-routing-roadmap.md`.

---

## 8. Síntesis: ¿qué se ganó concretamente?

Si un evaluador pregunta "¿qué se obtuvo a cambio del esfuerzo?":

**Capacidades nuevas**:
- ✅ Multi-hop explícito con stepper visible
- ✅ Forecasting funcional con backtest validado
- ✅ Rolling horizon hasta 14 días
- ✅ Network insights (empty moves, consolidaciones)
- ✅ Backhaul detection
- ✅ Vehículos proyectados en el plan
- ✅ Stale replan automático
- ✅ Grafo de sucursales auto-derivado + editable

**Capacidades pre-existentes preservadas**:
- ✅ Plan diario per-sucursal con drag-and-drop
- ✅ VRP de última milla con paradas ordenadas
- ✅ State machine de status sin cambios
- ✅ Permisos por sucursal sin cambios
- ✅ Pricing sin cambios

**Capacidades de observabilidad nuevas**:
- ✅ Tracking de override rate, drift rate, generation time
- ✅ Backtest MAPE del forecast
- ✅ Métricas históricas accesibles via UI

**UX consolidada**:
- ✅ De 9 links de ruteo en nav bar → 3
- ✅ Tabs bookmarkables vía URL
- ✅ Tracking público enriquecido para el cliente final

**Costo**: ~3 meses de un eng senior, 0 dependencias externas adicionales, 0 servicios nuevos para deployar.
