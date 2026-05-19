# Manual de usuario — LogiTrack Smart Routing

> Guía operativa de las nuevas funcionalidades de ruteo: multi-hop, vista de red, forecasting, plan multi-día y pallets.
>
> **Audiencia**: operadores, supervisores, gerentes, admins.
> Las features están segmentadas por rol — si no ves alguna sección en tu nav bar, es porque tu rol no la tiene asignada.

---

## ⚡ Guía rápida (cheatsheet de 1 página)

> **Imprimí y pegá en la pared del operador.** Cubre 80% del uso diario en 5-10 clicks por rol.

### 🚚 Operador / Supervisor — flujo diario

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Login en LogiTrack                                          │
│  2. Click "Ruteo" en nav bar (/routing)                         │
│  3. Click "Generar plan"        ← arma el plan del día           │
│  4. Revisar dispatches:                                          │
│       • Última milla → asignaciones a choferes                  │
│       • Inter-sucursal → vehículos + pallets agrupados          │
│       • Sin asignar → motivo (esperando consolidación, etc.)    │
│  5. (Opcional) Drag-and-drop si querés ajustar manualmente       │
│  6. Click "Aplicar plan"        ← confirma y persiste            │
│  7. Cuando lleguen vehículos en tránsito:                       │
│       → Ir a "Flota" → click "Finalizar viaje" en el camión     │
│       → Pallets se desarman automáticamente en este hub         │
└─────────────────────────────────────────────────────────────────┘

⚠ TIPS RÁPIDOS:
  • Si ves badge "⏱ Llega ~14:30" → ese vehículo no está disponible aún
  • Si ves "↩ Retorno X% · Y kg" → considerá aprovechar el viaje de vuelta
  • Si un envío tiene "📦 En pallet PAL-XXX" → viaja agrupado, no lo separes
  • Si Posadas/Bariloche tienen envíos pero sin vehículos → mirá /network
```

### 🌐 Gerente — flujo semanal

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Login → click "Plan de red" (/network)                       │
│  2. Tab "Hoy":                                                  │
│       • Revisar 6 KPIs (vehículos, asignados, idle, etc.)       │
│       • Tarjeta amber: ¿hay reposicionamiento sugerido?         │
│       • Tarjeta violeta: ¿hay consolidación cross-branch?       │
│  3. Tab "Próximos días":                                        │
│       • Mirar barras de volumen esperado (5-14 días)            │
│       • Identificar picos → planificar refuerzo de flota         │
│       • Identificar valles → ventana de mantenimiento            │
│  4. (Opcional) Click "Regenerar plan global" si la data cambió   │
└─────────────────────────────────────────────────────────────────┘

⚠ TIPS:
  • MAPE ≤30% = forecast confiable. >50% = ignorá las predicciones
  • Empty move = vehículo idle + sucursal con déficit → coordinar manualmente
  • Consolidation = oportunidad NO obligatoria; el operador decide
```

### ⚙️ Admin — flujo ocasional

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Login → click "Config. ruteo" (/admin/routing)               │
│  2. Tab "Parámetros":                                           │
│       • Tunear pesos: SLA horizon, fill rate, stale threshold... │
│       • Cambios entran en vigor inmediatamente                   │
│  3. Tab "Grafo de sucursales":                                  │
│       • Ver aristas (auto-derivadas del histórico)              │
│       • Click "Auto-derive ahora" para refrescar manualmente    │
│       • Click "Nueva arista manual" si falta una conexión       │
│       • Toggle ojo/ojo-tachado para deshabilitar arista          │
└─────────────────────────────────────────────────────────────────┘

⚠ TIPS:
  • Aristas "manual" no se sobreescriben en auto-derives
  • Si bajas min_fill_rate → más despachos vacíos pero menos esperas
  • Si subes stale_hub_threshold → tolerás más envíos esperando
```

### 📦 Cuándo intervenir manualmente con pallets

El sistema **palletiza automáticamente** al hacer Apply. Solo necesitás API manual (`POST /pallets`) en:
- Envíos de baja demanda que no llegan a fill_rate (esperan consolidación) y querés pre-armar el pallet
- Casos donde un cliente corporativo exige preservar agrupación física
- Demo/testing

### 🆘 Resolución de problemas comunes

| Síntoma | Causa probable | Acción |
|---|---|---|
| Plan vacío en /routing | Cron de 08:00 no corrió | Click "Generar plan" manualmente |
| Pallets sin aparecer | No hiciste Apply aún | Aplicar el plan en /routing |
| Forecast en cero | DB sin histórico OD | Esperar el backfill o reseedar |
| Empty move no aparece | Sucursales con vehículos | Necesita una sucursal con déficit real |
| Vehículo no aparece en pool | Está en mantenimiento/inactivo | Cambiar status en /vehicles |

---

## 1. Operador y Supervisor — Pantalla `/routing`

Tu pantalla diaria. Sin cambios respecto a antes en su flujo principal (drag-and-drop, apply), pero con **información adicional** que el sistema ahora muestra.

### 1.1. Vehículos entrantes con ETA

En la sección **"Vehículos llegando"**, cada vehículo en tránsito hacia tu sucursal ahora muestra un badge:

```
🚚 En viaje   ⏱ Llega ~14:30
```

**Para qué te sirve**: saber a qué hora vas a tener disponible ese vehículo para el siguiente despacho. Si tenés un envío que querés sacar a las 15:00, el sistema te dice si llegará un camión a tiempo.

### 1.2. Sugerencia de carga de retorno (backhaul)

En despachos inter-sucursal, podés ver:

```
AB123CD → Córdoba    ↩ Retorno 64% · 320 kg
```

**Para qué te sirve**: el camión que despachás a Córdoba vuelve vacío en muchos casos. El sistema busca shipments en Córdoba con destino tu sucursal y te sugiere aprovechar el viaje de vuelta.

**Cómo accionarlo (manual)**: cuando el vehículo regrese, en Flota podés cargar esos envíos en la operación habitual. La sugerencia es **informativa** — el sistema no crea el despacho de vuelta automáticamente.

### 1.3. Trayectoria planificada en cada envío

Abriendo el detalle de un envío (`/shipments/LT-XXXX`) verás un stepper visual:

```
🟢 CABA → 🔵 Córdoba → ⚪ Mendoza
✓ pasó    actual    pendiente
```

**Para qué te sirve**: saber por qué un envío que aparece en tu sucursal "intermedia" no es un destino final, sino un paso del camino. Si un envío está en Córdoba con `final_branch_id = mendoza`, el stepper te lo aclara visualmente.

### 1.4. Tracking público con trayectoria

El cliente que entra a `/track?id=LT-XXXX` ahora ve el mismo stepper. Para soporte/atención al cliente: si el cliente pregunta "¿por qué mi envío pasa por Córdoba?", ya tiene la respuesta visual en la pantalla pública.

### 1.5. Pallets (unidad de carga inter-sucursal)

Para tránsitos entre sucursales, los envíos se agrupan en **pallets** — unidades atómicas de manipulación. Última milla NO usa pallets (entrega por dirección, no por agrupación).

#### Qué ves en el detalle del envío

Si un envío forma parte de un pallet, debajo del stepper aparece:
```
📦 En pallet PAL-DEMO-ARM3d84  (viaja agrupado con otros envíos)
```

**Para qué te sirve**:
- Saber que el envío no se manipula individualmente — se mueve junto con otros en su pallet
- Trazabilidad: si el pallet está en un vehículo, todos sus envíos viajan juntos
- En hubs intermedios: si su pallet sigue al próximo hub, el envío continúa sin re-handling

#### Ciclo de vida del pallet

| Estado | Significa | Operativa |
|---|---|---|
| `armado` | Operador agrupó envíos, esperando vehículo | Asignar a vehículo cuando esté listo |
| `en_vehiculo` | Cargado en un vehículo, listo para partir | Start-trip del vehículo |
| `en_transito` | Vehículo iniciando el viaje | Sin acción, llegará al next-hop |
| `en_destino` | Llegó al next-hop, listo para desarmar | Auto-desarmado al fin de viaje |
| `desarmado` | Envíos liberados en el hub destino | Trazabilidad histórica |

#### Palletización automática vs manual

**Automática (más común)**: al hacer Apply en `/routing` para un dispatch inter-sucursal, el sistema crea automáticamente un pallet con todos los envíos del dispatch (comparten next_hop) y lo asigna al vehículo. **No hay acción manual** requerida — los pallets aparecen.

**Manual (vía API)**: para escenarios especiales (e.g., envíos de baja demanda esperando consolidación), el operador puede armar un pallet via:
```
POST /pallets  body: {"shipments":["LT-XXX-001","LT-XXX-002"]}
```
Validaciones:
- Mínimo 1 envío
- Todos en la misma sucursal actual
- Todos comparten el mismo `next_hop`
- Ningún envío ya palletizado
- No última milla (next_hop ≠ sucursal actual)

#### Descarga parcial en hub intermedio

Cuando un vehículo lleva pallets con destinos distintos (ej. CABA→Córdoba→Mendoza con pallets para ambos), al hacer **end-trip** en Córdoba:
- Pallets cuyo `next_hop=Córdoba` → se desarman, sus envíos quedan sueltos `at_hub` en Córdoba
- Pallets cuyo `next_hop=Mendoza` → **siguen cargados** en el vehículo
- Vehículo queda en Córdoba en estado `en_carga` (no `disponible`), listo para próximo leg

**Reducción de handling**: 90% menos manipulación física en hubs intermedios vs. modelo loose (sin pallets).

---

## 2. Manager — Pantalla `/network` (Plan de red)

Vista nueva consolidada para gerentes y admins. Reemplaza la necesidad de abrir 3 pantallas para tener contexto cross-branch.

### 2.1. Tab "Hoy" — Plan operativo del día

#### KPIs (cards arriba)
- **Vehículos despachados**: cuántos vehículos salen hoy en toda la red
- **Envíos asignados**: total cubierto por el plan
- **Envíos sin asignar**: trabajo que el algoritmo no pudo despachar — siempre que sea > 0, revisar las razones
- **Utilización promedio**: % de capacidad usada en despachos inter-sucursal
- **Vehículos ociosos**: en el pool pero sin uso hoy
- **Sucursales con déficit**: con shipments sin atender por falta de vehículo

#### Tarjeta "Reposicionamiento sugerido"

> Aparece cuando una sucursal **A** tiene envíos sin atender Y otra **B** tiene vehículos idle.

```
🚛 GH234IJ (5000 kg)
   CABA → Posadas · 839 km
   4 envíos sin atender en Posadas
```

**Qué hacer con esto**:
1. Validá que tiene sentido operativamente (chofer disponible para 839km de viaje vacío, costo aceptable)
2. Si sí: coordiná con la sucursal B para iniciar el viaje vacío
3. Una vez que el vehículo llegue a Posadas, podrá despachar los envíos pendientes

**Importante**: el sistema **no ejecuta** el reposicionamiento automáticamente. Es una **sugerencia accionable**.

#### Tarjeta "Oportunidades de consolidación"

> Aparece cuando 2+ sucursales despachan al mismo destino el mismo día.

```
Destino: Mendoza · 2 despachos · 745 kg · util prom 61.8%
  CABA    → AB123CD (340/800 kg)
  Córdoba → ST123UV (405/500 kg)
```

**Qué hacer con esto**:
1. Evaluá si conviene consolidar — ej: mandar la carga de CABA via Córdoba para que un solo camión haga el último tramo
2. Si sí: ajustá manualmente en `/routing` de la sucursal correspondiente
3. Es una decisión de optimización **no urgente** — la consolidación reduce km totales pero requiere coordinación

#### Tabla "Resumen por sucursal"

Conteos compactos por branch para tener visión rápida: cuántas rutas de última milla, cuántos despachos inter-sucursal, cuántos sin asignar, cuántos vehículos en pool.

### 2.2. Tab "Próximos días" — Plan multi-día (rolling horizon)

Vista de planificación a 5-14 días con forecasting estadístico.

#### Banner de calidad del modelo
```
MAPE: 12.17% ✓ Usable (167 observaciones, 12 pares O-D)
```

**Cómo interpretarlo**:
- **≤ 30%**: forecast usable. Confiá en las predicciones.
- **30-50%**: usable con margen — la realidad puede desviar, no comprometas decisiones críticas.
- **> 50%**: el modelo no es confiable para tu caso. Ignorá las predicciones.

#### Días firm vs forecast

- **Día 1 (verde, badge "🔒 Firm")**: el plan real de hoy con vehículos asignados. Ya está decidido.
- **Días 2-N (gris, badge "👁 Forecast")**: proyecciones basadas en la demanda esperada. Tentativos.

#### Por cada día
- **Total envíos esperados** (barra horizontal con escala relativa)
- **Peso esperado**
- **Vehículos estimados** (peso / capacidad media de la flota)
- **Chips por par O-D** con conteo y color de confianza:
  - 🟢 Verde: confianza high (≥12 observaciones del mismo día de semana)
  - 🟡 Amarillo: medium (4-11 obs)
  - ⚪ Gris claro: low (1-3 obs)
  - ⚪ Gris oscuro: none (sin data)

**Para qué te sirve**:
- **Capacidad planning**: el martes esperamos 150 envíos, ¿tenemos vehículos? Si no, programar mantenimiento para el sábado (baja demanda).
- **Tendencias**: una sucursal que crece, una ruta que se desploma → señal temprana.
- **Negociación con clientes**: "los lunes saturamos a Córdoba, ofreceré martes con descuento."

#### Selector de horizonte
3 / 5 / 7 / 14 días según necesidad. **14 días** suele ser ruidoso porque los lunes/martes futuros son inciertos.

### 2.3. Tab "Métricas históricas" (solo admin)

Observabilidad del sistema. No se ve diariamente — se mira semanal/mensual para evaluar si el algoritmo mejora con el tiempo.

- **Override rate**: % de envíos que el operador reasignó manualmente. Si es > 30%, el algoritmo no convence.
- **Drift count**: cuántos applies fallaron porque el estado cambió entre Generate y Apply.
- **Cobertura de ventanas**: % de paradas de última milla dentro de la ventana horaria del cliente.
- **Tiempo de generación**: segundos que tarda el algoritmo. Si crece, investigar.

---

## 3. Admin — Pantalla `/admin/routing`

### 3.1. Tab "Parámetros"

Los pesos del algoritmo. Cambios entran en vigor inmediatamente.

| Parámetro | Rango | Qué controla |
|---|---|---|
| `sla_force_horizon_hours` | 1-168 | Despacha aunque no haya consolidación si el envío vence dentro de X horas |
| `priority_force_threshold` | 0-1 | Despacha forzado si algún envío tiene priority_score ≥ X |
| `min_fill_rate` | 0.1-1 | Consolida cuando el vehículo está al menos X% lleno |
| `stale_hub_threshold_hours` | 0-168 | Re-planea path si un envío lleva X horas en un hub sin moverse. 0 = deshabilitado. |
| `fleet_projection_horizon_hours` | 0-48 | Considera vehículos en tránsito que llegarán en X horas como recursos futuros. 0 = solo vehículos actuales. |
| `enforce_time_windows` | bool | Si TRUE, no asigna envíos a choferes que no pueden cumplir la ventana. Si FALSE, los asigna con aviso. |
| `service_time_minutes` | 1-60 | Tiempo por entrega de última milla (timbre + firma). |
| `avg_speed_kmh` | 5-120 | Velocidad promedio entre paradas para el VRP. |
| `last_mile_packing_strategy` | balanced/maximize_capacity | Reparte parejo entre choferes vs saturar el primero. |

**Reglas operativas comunes**:
- Aumentar `min_fill_rate` (más estricto) → menos viajes, mayor demora.
- Bajar `min_fill_rate` (más permisivo) → más viajes con vehículos vacíos.
- Aumentar `sla_force_horizon_hours` → menos urgencias forzadas, depende más de consolidación.
- `fleet_projection_horizon_hours = 0` → no considera vehículos futuros (modo simple).

### 3.2. Tab "Grafo de sucursales"

Las **aristas** del grafo definen qué pares de sucursales están conectadas y a qué distancia. El algoritmo multi-hop usa este grafo para calcular el `planned_path` de cada envío (Dijkstra).

#### Botones principales
- **"Auto-derive ahora"**: refresca las aristas analizando el historial de tránsitos. Corre también todas las noches automáticamente.
- **"Nueva arista manual"**: crear conexión manualmente cuando el histórico no la captó (sucursal nueva, ruta especial).

#### Cada arista muestra
- **Distancia (km)**: Haversine entre las coords del seed o fallback provincial.
- **Tránsito promedio (h)**: tiempo histórico observado entre las dos sucursales.
- **Usos**: cuántas veces se observó este tramo en el histórico.
- **Fuente**:
  - **"Auto"**: derivada del histórico, se actualiza con cada auto-derive.
  - **"Manual"**: creada/modificada por admin. **No se sobreescribe** en auto-derives futuros.
- **Estado** (toggle 👁 / 🙈): habilitada o deshabilitada. Una arista deshabilitada no se usa en el cálculo de paths.

**Cuándo deshabilitar una arista**: cuando un par sucursal-sucursal **no debería** ser parte del ruteo (camino peligroso, sin servicio, etc.) aunque el histórico la haya generado.

---

## 4. Preguntas frecuentes

**¿Qué pasa si el operador NO acciona una sugerencia de empty move o backhaul?**
Nada. Las sugerencias son **informativas**, no obligan. El día siguiente el sistema las recalcula y vuelve a sugerir si siguen vigentes.

**¿Puedo confiar en el forecast?**
Mirá el banner de MAPE. Si está < 30%, sí. Si está > 50%, no — los datos son insuficientes/erráticos.

**¿El plan se aplica automáticamente?**
No. El plan se **genera** automáticamente (cron a las 08:00 ART) pero se **aplica manualmente** por el operador en `/routing`. El sistema nunca toma decisiones que mueven mercadería sin acción humana.

**¿Qué pasa si modifico el grafo de sucursales mientras hay envíos en tránsito?**
Los envíos en tránsito no se ven afectados — su `planned_path` ya está fijado. La próxima vez que generen plan (o se ejecute stale-replan en sucursales intermedias) se usará el grafo actualizado.

**¿La predicción se ajusta sola con la demanda real?**
Sí — cada noche el backfill recalcula los promedios incluyendo los datos del día. No requiere intervención.

---

## 5. Glosario rápido

- **at_hub**: envío en una sucursal intermedia o de destino (no de origen).
- **at_origin_hub**: envío en su sucursal de origen, listo para despacho.
- **backhaul**: carga de retorno de un vehículo que vuelve vacío al origen.
- **empty move**: viaje sin carga de un vehículo idle hacia una sucursal con demanda.
- **fill rate**: % de capacidad usada en un despacho.
- **firm vs forecast**: día 1 firme (decidido) vs días futuros (tentativos del forecast).
- **MAPE**: error porcentual promedio del forecasting. < 30% es bueno.
- **multi-hop**: envío que pasa por uno o más hubs intermedios antes del destino.
- **next hop**: próxima sucursal del path planificado.
- **pallet**: unidad atómica de carga inter-sucursal. Agrupa N envíos con el mismo next_hop. Se carga/descarga entero en cada hub. Última milla NO usa pallets.
- **palletizar**: agrupar envíos en un pallet. Ocurre automáticamente al aplicar dispatches inter-sucursal.
- **descarga parcial**: en un hub intermedio, solo los pallets con next_hop=hub actual se desarman; el resto sigue en el vehículo. Reduce ~90% el handling.
- **desarmar pallet**: al llegar al next_hop, el pallet se "desarma" y sus envíos quedan sueltos en el hub destino, listos para entrega o próximo leg.
- **piggyback**: agregar shipments huérfanos a despachos ya armados que pasan cerca de su destino.
- **planned_path**: trayectoria completa que el envío recorrerá (ej: `[caba, cordoba, mendoza]`).
- **rolling horizon**: plan multi-día donde solo el día 1 es firm, los demás son proyección.
- **stale replan**: re-planificación automática de envíos que llevan demasiado tiempo en un hub sin avanzar.
