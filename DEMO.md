# Demo runbook — LogiTrack Smart Routing

> Guion paso a paso para una demo de **14-17 minutos**. Probado contra DB real con seed enriquecido (incluye palletización).

---

## 0. Setup (3 minutos antes de empezar)

### 1. Levantar la DB
```bash
docker compose up -d db
# Esperá ~5 segundos a que el healthcheck pase
docker compose ps    # debe mostrar "healthy"
```

### 2. Levantar el backend
```bash
cd logitrack_core
DB_HOST=localhost DB_PORT=5432 DB_USER=logitrack DB_PASSWORD=localpass \
DB_NAME=logitrack DB_SSLMODE=disable \
go run cmd/server/main.go
```

**Verificá los logs de seed:**
```
[seed od_volume] 1078 días-pares poblados (90 días sintéticos para forecasting)
[seed branch_graph] 12 aristas inicializadas
[shipment_path] backfill: 35 envíos procesados, 0 ya tenían path
[seed pallets] armado PAL-DEMO-ARM**** creado (3 envíos CABA→Bariloche, 150.0kg)
[seed pallets] histórico PAL-HIST-CO**** creado (desarmado en CABA, 3 envíos trazabilidad)
Listening and serving HTTP on :8080
```

### 3. Levantar el frontend
```bash
cd logitrack_web
npm run dev
# abre http://localhost:5173
```

### 4. Si necesitás resetear todo
```bash
docker exec app-db-1 psql -U logitrack -d logitrack -c "TRUNCATE events, shipments, od_pair_daily_volume, branch_graph, routing_plans, vehicles, branches, routes, customers, pallets RESTART IDENTITY CASCADE;"
# después relanzá el backend
```

### 5. Credenciales útiles
| Usuario | Password | Para qué |
|---|---|---|
| `op_caba` | `op_caba123` | Vista operativa de CABA |
| `gerente` | `gerente123` | Vista de red (manager) |
| `admin` | `admin123` | Configuración + grafo |

---

## 1. Flow de demo (~14 min)

### Capítulo 1 — Operador de sucursal (3 min)

**Login**: `op_caba` / `op_caba123`

**1a. Abrir `/routing`** (link "Ruteo" en nav bar)

**Talking point:**
> "Esta es la pantalla del operador de CABA cada mañana. En lugar de asignar shipment por shipment a mano, hace un click."

**Acción**: clic en **"Generar plan"**.

**Qué señalar:**
- Sección **"Última milla"**: el chofer de CABA recibe los envíos del día, con paradas ordenadas y ETAs (VRP)
- Sección **"Despachos inter-sucursal"**: vehículo va a Córdoba con consolidación de 7 envíos
- En el card del despacho: badge **"↩ Retorno X% · Y kg"** → backhaul sugerido (Sprint 5)
- En el card del despacho: badge **"⏱ Salida ~HH:MM"** si depende de un vehículo en camino (Sprint 4)

**Acción**: clic en cualquier envío de la lista → abre `/shipments/LT-XXX`

**Qué señalar:**
- Sección **"Trayectoria planificada"** con stepper visual: `CABA ✅ → Córdoba 🚚 → Mendoza ⏳`
- "Esto es multi-hop: el envío sabe que pasa por Córdoba antes de llegar a Mendoza."

---

### Capítulo 2 — Manager: vista de red (5 min)

**Logout → login**: `gerente` / `gerente123`

**2a. Abrir `/network`** (link "Plan de red")

**Tab activo por defecto: "Hoy"**

**Qué señalar:**
- **Botón "Regenerar plan global"** (arriba a la derecha) — si la primera vez todo aparece en cero, hacer clic
- **6 KPIs**: vehículos despachados, asignados/sin asignar, util promedio, idle, déficit
- **Tarjeta amber "Reposicionamiento sugerido"**: 
  > "GH234IJ camión de 5000kg en CABA está idle. Posadas tiene 4 envíos sin atender porque sus vehículos están en mantenimiento. El sistema sugiere mover el camión 839km a Posadas."
- **Tarjeta violeta "Oportunidades de consolidación"**:
  > "Mendoza recibe despachos paralelos de CABA y Córdoba el mismo día. Total 745kg con 61% utilización promedio. Hay espacio para optimizar."
- **Tabla "Resumen por sucursal"**: contadores por branch

**2b. Cambiar a tab "Próximos días"**

**Talking point:**
> "Mismo dominio cognitivo pero proyección futura: planning multi-día basado en forecasting estadístico."

**Qué señalar:**
- **Banner de calidad**: "MAPE: 12.17% ✓ Usable (167 obs, 12 pares O-D)"
- **Día 1 firm (verde)**: 22 envíos, 1192 kg, 3 vehículos — esto es real, lo del plan global
- **Días 2-7 forecast (gris)**: predicciones con barras de volumen, badges por par O-D con confianza coloreada
- Notar el patrón día-de-semana: **lunes/martes con picos (~150 envíos), fin de semana valles (~40)**
- Cambiar el horizonte: 5 → 7 → 14 días con el selector

**Talking point:**
> "Esto le permite al supervisor anticiparse: el martes viene fuerte, hay que asegurar 2 vehículos disponibles. El sábado bajará, podemos hacer mantenimiento."

---

### Capítulo 3 — Admin: configuración (2 min)

**Logout → login**: `admin` / `admin123`

**3a. Abrir `/admin/routing`** (link "Config. ruteo")

**Tab "Parámetros"**:
- Mostrar los pesos del algoritmo: SLA horizon, fill rate, priority threshold, **stale hub threshold** (Phase 1), **fleet projection horizon** (Phase 2)
- Talking point: "El admin tunea estos pesos según el negocio. Cambios son inmediatos."

**Tab "Grafo de sucursales"**:
- 12 aristas bidireccionales auto-derivadas
- Mostrar cualquier arista: distancia (Haversine), tránsito promedio, observed count, fuente "Auto"
- Clic en **"Auto-derive ahora"** → muestra "X aristas procesadas"
- Mostrar **"Nueva arista manual"** (botón + form) — el admin puede agregar conexiones que el histórico no captó

---

### Capítulo 4 — Palletización + descarga parcial multi-hop (2 min)

**Login**: `op_caba` / `op_caba123` (si no estás ya como op_caba)

**4a. Pallets pre-existentes (sin haber hecho apply)**

Abrir directo en navegador (o vía curl):
```
GET /api/v1/pallets?branch_id=caba
```

**Talking point:**
> "Antes de cualquier dispatch, ya hay un pallet **armado** esperando: el operador agrupó 3 envíos para Bariloche pero todavía no asignó un vehículo. Estado: `armado`. Es la **unidad atómica** de manipulación inter-sucursal."

**Qué señalar**:
- `PAL-DEMO-ARM****`: 3 envíos, 150 kg, status `armado`, sin vehículo, next_hop=bariloche

**4b. Pallets creados automáticamente al hacer apply**

Si todavía no hiciste apply: ahora hacer apply en `/routing` para CABA. Después abrir nuevamente `GET /pallets?branch_id=caba`.

**Qué señalar:**
- Ahora hay 2-3 pallets más en estado `en_vehiculo`
- Cada despacho del plan creó un pallet agrupando los envíos por destino
- Status `en_vehiculo` = pallet cargado en el camión, listo para salir

**4c. Trazabilidad histórica**

Abrir un envío de última milla en CABA (ej. `/shipments/LT-LM00001`).

**Qué señalar:**
- El envío llegó desde Córdoba — viajó en un pallet que ya se desarmó al llegar
- En la DB: `SELECT * FROM pallets WHERE status='desarmado'` muestra `PAL-HIST-CO****` con la trazabilidad de los 3 envíos que viajaron juntos
- "El pallet sigue en la DB con su historia aunque ya no tenga shipments vinculados — auditoría completa"

**4d. Descarga parcial (concepto)**

**Talking point** (sin demo de runtime — feature está implementada pero requiere multi-hop completo):
> "Cuando un vehículo lleva pallets con destinos distintos (ej. CABA→Córdoba→Mendoza), al llegar a Córdoba **solo se descargan los pallets cuyo next_hop es Córdoba**. Los pallets con next_hop=Mendoza siguen cargados en el camión. La descarga es a nivel pallet, no por shipment individual — reduce ~90% el handling en hubs intermedios."

**Cómo se ve esto en el código:**
- `palletSvc.UnloadAtBranch(vehicleID, branchID)` separa pallets que descargan vs. continúan
- El `end-trip` lo usa: si quedan pallets, vehículo pasa a `en_carga` (no `disponible`)
- Tests `TestUnloadAtBranch_PartialUnload` validan el flujo

---

### Capítulo 5 — Cliente final: tracking público (1 min)

**Logout** y abrir directo `/track?id=LT-LM00001` (sin login)

**Qué señalar:**
- Stepper visual mostrando la trayectoria al cliente: `CABA → Córdoba → Mendoza`
- "El cliente ve por dónde pasa su envío, no solo el destino final"

---

## 2. Talking points generales

Si te preguntan por **Phase 4 / forecasting**:
> "Estadística pura — promedio por día de semana sobre últimos 90 días. Sin ML porque no necesitamos a esta escala. El MAPE backtest está en 12%, muy debajo del threshold de 30%."

Si te preguntan por **escalabilidad**:
> "6 sucursales hoy. El algoritmo es heurístico, complejidad O(N²×D) — manejable hasta ~50 sucursales. Para más necesitaríamos un MIP solver."

Si te preguntan por **costo de la feature**:
> "Backend Go, sin servicios externos. Storage: 4 tablas chicas. Compute: predicciones se generan on-demand (~50ms). Negligible."

Si te preguntan por **comparado con la competencia**:
> "FedEx/UPS hacen esto mismo a escala mayor con MIP solvers. Para volúmenes regionales como el nuestro, el heurístico + LLM contextual da el 90% del valor con 5% del costo."

---

## 3. Recovery plan

### "No aparece el plan en /network"
- Hacer clic en **"Regenerar plan global"** arriba a la derecha
- Esperar ~3-5 segundos
- La página se recarga automáticamente con el plan nuevo

### "El stepper de trayectoria no aparece en un envío"
- Es un envío sin `planned_path` (raro tras backfill)
- Saltar al siguiente envío

### "El forecast muestra todo en cero"
- Verificar que en startup salió: `[seed od_volume] 1078 días-pares poblados`
- Si no salió: la DB tiene data vieja sin truncar. Resetear con el comando de la sección 0.4.

### "Error 500 en algún endpoint"
- Ver `/tmp/logitrack-server.log` o consola del backend
- Reiniciar backend (sin reiniciar DB — los datos persisten)

### "El frontend no carga"
- Verificar `VITE_API_URL` apunta a `http://localhost:8080/api/v1`
- Hard refresh: `Cmd+Shift+R`

---

## 4. Cierre de demo (1 min)

> "Lo que vieron es un POC funcional, pero el modelo es real. Las decisiones (heurístico vs MIP, estadística vs ML, hubs consolidados, etc.) están tomadas con criterio operativo. El roadmap para llevar esto a producción está documentado en `docs/specs/15-routing-roadmap.md` — son 4 fases identificadas con gates explícitos para decidir si seguir o congelar en cada paso."

**Preguntas finales** (anticipá estas):
- ¿Cuánto tomaría a producción? **3-6 meses con un eng senior** (depende de qué fases priorizan)
- ¿Cuánto cambia el negocio? **Reducción ~15% en km vacíos según referencia industria** (no medido todavía en LogiTrack)
- ¿Se puede demoar contra datos reales? **Sí, el seed se reemplaza por el backfill de eventos históricos reales**
