# Manual de negocio — Smart Routing en LogiTrack

> **Audiencia**: stakeholders, dirección comercial, operaciones a nivel ejecutivo, sponsors del proyecto.
>
> **No es un manual de uso** — para "cómo se opera", ver `manual-usuario.md`.
> Acá explicamos **qué problema resuelve el sistema y por qué importa para el negocio.**

---

## 1. El problema que resolvemos

LogiTrack opera una red de 6 sucursales: CABA, Córdoba, Mendoza, Posadas, Jujuy, Bariloche. Los envíos viajan entre sucursales (inter-sucursal) y dentro de la ciudad (última milla).

Hasta ahora, **cada operador de sucursal armaba el plan del día de forma aislada**. Funcionaba, pero dejaba plata sobre la mesa:

| Síntoma | Causa raíz | Impacto |
|---|---|---|
| Camiones que vuelven vacíos | Operador A no sabe que sucursal B tiene carga para el retorno | km vacíos = costo puro |
| Vehículos ociosos en una sucursal mientras otra rechaza envíos | Cada sucursal solo ve sus propios recursos | Servicio degradado + flota infrautilizada |
| Envíos atascados días en hubs intermedios | Nadie monitorea el "estancamiento" cross-branch | Cliente molesto, SLAs no cumplidos |
| Decisiones de hoy sin saber qué pasa mañana | No hay forecast, todo es reactivo | Sub o sobre-aprovisionamiento de flota |
| Operador no sabe que un envío "está en su sucursal pero solo de paso" | El destino final no es visible en pantallas intermedias | Manipulación errónea, demoras |

---

## 2. Qué construimos

Cinco capas de inteligencia, agregadas progresivamente:

### Phase 0 — Observabilidad
Una base de datos de métricas históricas: qué planes se generaron, cuántos envíos hubo, cuántas reasignaciones manuales, cuánto tiempo tardó cada tránsito. **Sin esto, no se puede medir nada.**

### Phase 1 — Trayectoria explícita (multi-hop)
Cada envío sabe **por dónde va a pasar**, no solo su destino final. Ejemplo:
- **Antes**: envío de CABA a Mendoza → "destino: Mendoza". Operador de CABA decide aleatoriamente si lo manda directo o lo consolida.
- **Después**: envío de CABA a Mendoza → `planned_path: [CABA, Córdoba, Mendoza]`. Todas las sucursales saben que pasa por Córdoba.

**Valor concreto**:
- El cliente ve la trayectoria en `/track`.
- Operadores de hubs intermedios distinguen "envíos para entregar acá" vs "envíos de paso".
- Stale replan automático: si un envío lleva 48h estancado, el sistema re-planea su trayectoria.

### Phase 2 — Visión hacia adelante de la flota
El sistema sabe qué vehículos llegan y cuándo. Ya no decide solo con la foto del momento.

**Ejemplos**:
- "Va a llegar un camión a las 14:30 → puedo planear despacho a las 15:00 sin esperar al día siguiente"
- "Este vehículo viene vacío al volver de Córdoba → si hay carga en Córdoba para CABA, sugerimos backhaul"

### Phase 3 — Vista de red (insights cross-branch)
Una pantalla para el gerente que muestra **señales que ningún operador puede ver desde su sucursal**:
- Vehículos idle en una sucursal mientras otra rechaza envíos → sugerencia de reposicionar
- Despachos paralelos al mismo destino → oportunidad de consolidar
- KPIs agregados de la red

### Phase 4 — Forecasting + plan multi-día
Predicción estadística de demanda por par origen-destino para los próximos 5-14 días. Plan rolling: día 1 firme, días 2+ tentativos.

**Ejemplos**:
- "Esperamos 150 envíos a Córdoba el lunes → preparar 2 camiones"
- "El sábado bajará la demanda → ventana para mantenimiento de flota"

### Phase 5 — Palletización + descarga parcial multi-hop
Los envíos inter-sucursal se agrupan en **pallets** — unidad atómica de manipulación. Cada pallet tiene un `next_hop_branch_id` y se desarma solo en esa sucursal.

**Diferencia operativa concreta**:
- **Antes (envíos sueltos)**: 50 envíos × 3 hops = 150 operaciones de carga/descarga. Cada hub manipula cada envío individualmente.
- **Después (pallets)**: 3 pallets × 3 hops = 9 operaciones de carga/descarga. Cada hub maneja pallets enteros con montacargas.

**Reducción del handling físico: ~90%.**

**Descarga parcial automática**: cuando un vehículo llega a un hub intermedio, solo se desarman los pallets cuyo destino es ese hub. Los pallets que continúan a sucursales siguientes **quedan en el vehículo intactos** — no se reorganizan ni se vuelven a cargar.

**Casos donde habilita ahorros**:
- Tránsito CABA → Córdoba → Mendoza: el camión carga 2 pallets (uno para Córdoba, uno para Mendoza). En Córdoba descarga uno y sigue con el otro. Sin pallets, todo el cargo se reclasifica en Córdoba.
- Carga frágil consolidada: el pallet preserva el arreglo físico, evita re-acomodar en cada hub.

---

## 3. Valor para el negocio

### 3.1. Para Operaciones (Director / Gerente)

**Reducción de kilómetros vacíos**:
- Backhauls sugeridos cuando un camión vuelve sin carga
- Empty moves cuando hay desbalance entre demanda y flota
- *Referencia industria (FedEx Ground, UPS): 10-15% de reducción en km vacíos típico*

**Mejor utilización de flota**:
- Vehículos proyectados (en tránsito) cuentan como recursos del día
- Antes: vehículo idle hasta el siguiente día → ahora: planeable para tarde
- *Referencia: aumento ~20% en utilización de flota observado en redes LTL similares*

**Planning con anticipación**:
- Saber con días de antelación dónde y cuándo viene el pico
- Programar mantenimiento, rotaciones, contrataciones temporales
- *Antes: decisión "para esta semana". Ahora: plan a 14 días vista*

**Detección temprana de problemas**:
- Stale replan automático evita que un envío "se pierda" en un hub
- Sucursales con déficit de demanda salen en el dashboard

### 3.2. Para Comercial

**Tracking público enriquecido**:
- El cliente ve la trayectoria de su envío con stepper visual
- Comunica claridad sobre la red — "tu paquete pasa por Córdoba, ETA Mendoza el jueves"
- *Reduce ticketing de soporte: cliente entiende sin preguntar*

**Promesas más confiables al cliente**:
- ETA recomputado en cada hop con datos del grafo
- Cuando un envío se atrasa, el sistema avisa internamente (stale replan)
- *Menos overpromise → menos compensaciones*

### 3.3. Para Finanzas

**Forecasting de demanda permite**:
- Pricing dinámico por par O-D (futuro)
- Negociación de tarifas con clientes corporativos basada en patrones reales
- Inventory planning de embalaje, combustible, repuestos

**Métricas observables**:
- Override rate operativo: % de envíos que requieren intervención manual → si baja, el algoritmo está madurando
- Drift rate: cuántas decisiones se rompen entre plan y aplicación → indicador de coordinación
- Cobertura de ventanas horarias: % de entregas de última milla en tiempo

### 3.4. Para Dirección / Estrategia

**Visión 360 de la red operativa**:
- Una pantalla, todas las señales: empty moves, consolidaciones, métricas, forecast
- Antes: 5 informes de operaciones consolidados a mano

**Roadmap escalable**:
- Para 6 sucursales el sistema heurístico alcanza
- Para 50+ sucursales, el roadmap contempla MIP solver (Phase 4 stage 3)
- Cambio gradual, no big-bang

---

## 4. KPIs a monitorear post-implementación

Métrica | Threshold "bien" | Threshold "mal" | Acción si mal
--- | --- | --- | ---
% reducción km vacíos vs baseline | ≥ 15% | < 5% | Revisar adopción de backhauls
Utilización media de despachos | ≥ 70% | < 50% | Bajar `min_fill_rate` para menos viajes vacíos
Override rate manual | ≤ 10% | > 30% | El algoritmo no convence — revisar pesos
Drift rate (cambios entre plan y apply) | ≤ 5% | > 20% | Coordinación frágil — revisar timing
% envíos con planned_path computado | 100% | < 90% | Bug — el path planner está fallando
MAPE del forecast | ≤ 30% | > 50% | Datos insuficientes — esperar más histórico o re-evaluar modelo
Tiempo de generación del plan | ≤ 60 seg | > 3 min | Performance — investigar cuello
% envíos inter-sucursal palletizados | ≥ 90% | < 70% | Investigar qué bypassea el auto-palletize
Handling físico promedio por envío (operaciones de carga/descarga) | ≤ 3 por viaje | > 8 por viaje | Pallets no se están aprovechando — re-clasificación excesiva en hubs

---

## 5. Costos y ROI cualitativo

### Costos
- **Desarrollo**: ~3 meses de un eng senior (POC + features). Costo único.
- **Mantenimiento**: bajo. Heurístico determinístico, no requiere re-entrenamiento.
- **Compute**: negligible. Plan se genera en segundos sin GPU. Forecasting estadístico.
- **Storage**: 4 tablas chicas (~10k filas/mes a escala actual).

### ROI cualitativo
- **Inmediato (semana 1)**: visibilidad. El gerente ve la red completa por primera vez.
- **Corto (mes 1-3)**: reducción de errores operativos manuales (envíos perdidos, vehículos olvidados).
- **Mediano (mes 3-6)**: reducción medible de km vacíos cuando los operadores accionan sugerencias.
- **Largo (año 1+)**: el histórico mejora el forecasting → decisiones más informadas → ciclo virtuoso.

### Riesgos a gestionar
- **Adopción**: si los operadores ignoran las sugerencias (empty moves, backhauls), no se materializa el valor. Mitigación: medir override rate, capacitar.
- **Datos sucios**: si el seed de aristas del grafo no refleja la realidad, los paths son malos. Mitigación: auto-derive nocturno + override manual del admin.
- **Sobre-optimización**: cambiar `min_fill_rate` muy alto bloquea despachos urgentes. Mitigación: monitorear "envíos atrasados" y ajustar.

---

## 6. Casos de uso clave

### Caso 1: Sucursal con flota en mantenimiento (escenario empty move)

> Posadas tiene los 3 vehículos en taller. Llegan 4 envíos para mandar a CABA.

**Antes**: estos envíos esperan hasta que algún vehículo vuelve. Cliente molesto.

**Con Smart Routing**:
1. El sistema detecta: posadas tiene 4 envíos unassigned por motivo `sin_vehiculos_disponibles`.
2. El sistema detecta: CABA tiene 6 vehículos disponibles, 1 de ellos (camión de 5000kg) está idle hoy.
3. La vista `/network` del gerente muestra: "Reposicionar GH234IJ (5000kg) CABA → Posadas, 839 km, 4 envíos sin atender".
4. Gerente coordina con CABA: el camión viaja vacío a Posadas (decisión operativa con costo conocido).
5. Llega a Posadas, despacha los 4 envíos a CABA con carga llena.

**Valor**: 4 envíos despachados el mismo día en lugar de esperar 2-3 días. Costo del empty move: ~839km × tarifa. Ganancia: SLA cumplido + carga de retorno.

### Caso 2: Consolidación cross-branch

> CABA tiene 4 envíos a Mendoza (320kg). Córdoba tiene 4 envíos a Mendoza (405kg). Ambas sucursales despachan camiones separados.

**Antes**: dos camiones a Mendoza el mismo día, uno con 42% util y otro con 81%.

**Con Smart Routing**:
1. Plan de red muestra: "2 despachos a Mendoza desde sucursales distintas, util prom 61.8%".
2. Gerente evalúa: ¿conviene consolidar? Posibles caminos:
   - Que CABA mande su carga via Córdoba (multi-hop) → ahorra 1 camión-viaje
   - Que Mendoza espere a que ambas cargas se reúnan en Córdoba
3. Decisión coordinada → 1 camión menos en ruta.

**Valor**: ahorro de 1 viaje completo CABA-Mendoza (~990km × 1 camión).

### Caso 3: Planificación de capacidad para pico semanal

> Es jueves. El gerente abre `/network?tab=rolling`.

**Antes**: "vemos cómo viene el lunes el lunes mismo".

**Con Smart Routing**:
1. Forecast a 7 días muestra: lunes 18/05 → 153 envíos esperados, 2132kg, ~2 vehículos necesarios.
2. La flota habitual de lunes en CABA: 1 vehículo grande.
3. Acción: programar refuerzo para el lunes (chofer extra, vehículo prestado de Córdoba).

**Valor**: pico cubierto sin urgencia, sin operadores trabajando overtime, sin envíos atrasados.

### Caso 4: Descarga parcial en hub intermedio

> Vehículo va CABA → Córdoba → Mendoza con 2 pallets (uno para Córdoba, uno para Mendoza).

**Antes (modelo loose, sin pallets)**:
1. Vehículo llega a Córdoba con 50 envíos sueltos.
2. Operador descarga TODOS los 50, los clasifica uno por uno (¿este es para acá? ¿este sigue?).
3. Vuelve a cargar los 30 que siguen a Mendoza.
4. Tiempo: ~45 minutos de handling. Riesgo de error humano.

**Con Smart Routing + Pallets**:
1. Vehículo llega a Córdoba con 2 pallets.
2. Sistema indica: Pallet-A (next_hop=Córdoba) descarga; Pallet-B (next_hop=Mendoza) sigue.
3. Operador maneja 2 unidades con montacargas — Pallet-A baja, Pallet-B queda.
4. Tiempo: ~5 minutos. Cero re-clasificación de envíos individuales.

**Valor**:
- 40 minutos ahorrados por parada intermedia
- Cero errores de clasificación
- Pallet-B llega a Mendoza con el mismo arreglo físico que salió de CABA (importante para frágiles)

### Caso 5: Cliente final entiende el viaje de su paquete

> Cliente envía paquete CABA → Bariloche. Recibe el mail de tracking.

**Antes**: tracking dice "En camino" sin detalle. Cliente llama a soporte: "¿por qué pasa por Córdoba?".

**Con Smart Routing**:
1. Cliente abre `/track?id=LT-XXXX`
2. Ve el stepper: `CABA ✅ → Córdoba 🚚 → Bariloche ⏳`
3. Entiende sin preguntar: el paquete pasa por hubs intermedios.

**Valor**: -1 ticket de soporte. Transparencia que mejora NPS.

---

## 7. ¿Qué NO hace este sistema?

Importante alinearse:

- **No optimiza precios**: Smart Routing decide ruteo, no pricing. El módulo de pricing es separado.
- **No reemplaza al operador**: las sugerencias son accionables, no obligatorias. El humano decide.
- **No predice eventos extraordinarios**: feriados, huelgas, cortes de ruta — el forecast es estadístico, no contextual.
- **No es Service Network Design**: para 50+ sucursales y miles de envíos/día se necesita un MIP solver. Hoy estamos abajo de esa escala.
- **No es IA generativa**: usamos estadística clásica + heurísticos. Decisión consciente para mantener el sistema explicable y mantenible.

---

## 8. Roadmap a futuro

Documento de referencia: `docs/specs/15-routing-roadmap.md`.

El roadmap está dividido en 4 fases con **gates explícitos** entre cada una (métricas que deciden si seguir o congelar). Hoy estamos en POC con todas las fases implementadas funcionalmente. Para producción real:

| Próximos hitos | Cuándo | Esfuerzo |
|---|---|---|
| A/B test del plan de red vs per-branch en sucursal piloto | Semana 1 post-deploy | bajo |
| Captura real de métricas durante 90 días | Mes 1-3 | bajo (corre solo) |
| Evaluación de gates de cada phase con data real | Mes 3-4 | medio |
| Phase 5 si volumen crece a 50+ sucursales: MIP solver | Cuando aplique | alto |

---

## 9. Síntesis ejecutiva

**Qué construimos**: un sistema que optimiza la red logística no solo a nivel sucursal sino a nivel red, anticipando demanda y aprovechando recursos compartidos.

**Por qué importa**: reduce km vacíos, mejora utilización de flota, da visibilidad antes inexistente al gerente, mejora la experiencia del cliente.

**Cómo se mide el éxito**: 7 KPIs claros (sección 4) con thresholds definidos.

**Qué riesgo asumimos**: si los operadores no accionan sugerencias, el valor no se materializa. Mitigación: medición + capacitación + iteración del producto basada en data.

**Cuál es el siguiente paso**: piloto en 2 sucursales por 90 días, medir, iterar.
