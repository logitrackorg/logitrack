# User Stories — Ruteo inteligente diario (US-089 a US-099)

## Contexto

El operador o supervisor de una sucursal arranca el día con N envíos acumulados, M vehículos disponibles y K choferes activos. Hasta hoy debía asignar cada envío a mano: decidir qué chofer cubre cada entrega de última milla, qué envíos cargar en cada vehículo y a qué sucursal mandarlo. Esta US suite agrega una pantalla **"Ruteo"** que genera un plan sugerido de un click usando un algoritmo greedy con tres reglas explícitas (SLA crítico, consolidación, espera) y soporta piggyback oportunístico, devoluciones y reasignación manual antes de aplicar.

El plan vive **solo en memoria del cliente** entre la generación y la aplicación. El backend no persiste planes intermedios. Al aplicar, hace validación per-item (no es transaccional — son tres stores distintos: shipment, vehicle, route).

---

## US-089 — Generar un plan de ruteo del día

**Como** operador o supervisor
**Quiero** generar de un click un plan sugerido con todos los envíos pendientes en mi sucursal
**Para** no tener que asignar uno por uno y empezar el día más rápido

### Criterios de aceptación

- CA-01 — En el menú principal veo el link "Ruteo" (operador y supervisor) que me lleva a una pantalla con un botón "Generar plan".
- CA-02 — Al apretar "Generar plan", el sistema arma una propuesta para mi sucursal y la muestra agrupada en tres secciones: última milla, despachos a otras sucursales y sin asignar.
- CA-03 — El plan se calcula con los envíos que están en mi sucursal en ese momento y no toca la base de datos hasta que apriete "Aplicar plan".

---

## US-090 — Asignar envíos de última milla a los choferes

**Como** operador o supervisor
**Quiero** que el sistema reparta automáticamente los envíos en mi sucursal a los choferes disponibles
**Para** que cada chofer arranque el día con su lista lista, sin pelearme con quién lleva qué

### Criterios de aceptación

- CA-01 — Los envíos que están en mi sucursal con destino final de última milla se distribuyen entre los choferes respetando los topes de cantidad y peso por chofer.
- CA-02 — El reparto prioriza primero los envíos con mayor prioridad y ventana horaria más restrictiva (Mañana antes que Tarde antes que Flexible).
- CA-03 — Si un envío no entra en ningún chofer porque se alcanzó el tope, aparece en "Sin asignar" con el motivo "Los choferes ya están al tope de su capacidad".

---

## US-091 — Consolidar envíos hacia otra sucursal

**Como** operador o supervisor
**Quiero** que el sistema agrupe envíos al mismo destino y los despache cuando se llegue a un volumen mínimo
**Para** evitar mandar vehículos medio vacíos a destinos lejanos

### Criterios de aceptación

- CA-01 — El sistema agrupa los envíos pendientes por sucursal destino y, si la suma de pesos supera un porcentaje mínimo de la capacidad del vehículo más grande disponible, arma un despacho.
- CA-02 — Para cada despacho elige el vehículo más chico que cubre la carga total y muestra patente, destino y porcentaje de ocupación.
- CA-03 — Si para un destino el peso acumulado no llega al mínimo, los envíos quedan en "Sin asignar" con el motivo "Esperando consolidación con otros envíos al mismo destino" y no se manda ningún vehículo.

---

## US-092 — Forzar el despacho de envíos urgentes

**Como** operador o supervisor
**Quiero** que el sistema despache un viaje aunque no haya llegado al mínimo cuando hay un envío urgente
**Para** no incumplir compromisos de entrega por esperar consolidación

### Criterios de aceptación

- CA-01 — Si entre los envíos pendientes a un destino hay alguno con fecha estimada dentro de las próximas horas (horizonte configurable) o con score de prioridad sobre el umbral, el sistema arma el despacho aunque la carga esté por debajo del mínimo.
- CA-02 — En el despacho que se arma por urgencia, la regla aparece visible como "SLA crítico" para entender por qué el viaje sale con poca carga.
- CA-03 — Las dos vías (SLA cercano y prioridad alta) se evalúan envío por envío: alcanza con que uno solo del grupo dispare la regla para forzar el despacho de todo ese destino.

---

## US-093 — Aprovechar viajes para acercar envíos huérfanos

**Como** operador o supervisor
**Quiero** que los envíos sin despacho propio suban a viajes que estén yendo más cerca de su destino final
**Para** no tener envíos parados esperando consolidación cuando hay un camión saliendo en buena dirección

### Criterios de aceptación

- CA-01 — Si un envío quedó sin asignar y hay un despacho ya armado cuyo destino está más cerca (en km) del destino final del envío que mi sucursal, el sistema lo suma a esa carga si hay capacidad disponible.
- CA-02 — Cuando hay varios despachos candidatos, el algoritmo elige el que más acerca el envío a su destino final.
- CA-03 — En la pantalla de ruteo, los envíos que viajan "de paso" muestran un badge "Tránsito parcial → [sucursal final]" para que entienda que ese vehículo no llega al destino final del paquete.

---

## US-094 — Reasignar envíos del plan antes de aplicar

**Como** operador o supervisor
**Quiero** mover envíos entre choferes y vehículos del plan sugerido antes de aplicarlo
**Para** ajustar manualmente lo que el algoritmo no pudo saber (un chofer enfermo, un cliente que llamó pidiendo cambio)

### Criterios de aceptación

- CA-01 — Cada envío del plan tiene un botón "Reasignar" que abre un modal con las opciones disponibles, y un botón global "Descartar cambios" que vuelve al plan original.
- CA-02 — Si muevo un envío a un chofer o vehículo que excedería su capacidad, el sistema rechaza el cambio y me explica el motivo (peso o cantidad excedida).
- CA-03 — Los cambios manuales viven en el plan en pantalla y recién impactan en la base de datos cuando aprieto "Aplicar plan".

---

## US-095 — Restringir reasignación por tipo de envío

**Como** operador o supervisor
**Quiero** que el sistema no me deje mover un envío de última milla a un vehículo inter-sucursal, ni viceversa
**Para** no mandar a otra ciudad un envío que ya estaba en su destino, ni cargar a un chofer un envío que tiene que viajar

### Criterios de aceptación

- CA-01 — Si abro el modal de reasignar para un envío de última milla, solo veo choferes como destino válido. No aparecen los vehículos inter-sucursal.
- CA-02 — Si abro el modal para un envío inter-sucursal o una devolución, solo veo vehículos. No aparecen los choferes.
- CA-03 — En ambos casos queda disponible la opción "Marcar como sin asignar" como salida manual cuando ninguno de los destinos válidos sirve.

---

## US-096 — Aplicar el plan y ver el resultado per-item

**Como** operador o supervisor
**Quiero** ver, después de aplicar el plan, qué envíos se aplicaron y cuáles fallaron con el motivo
**Para** saber si tengo que rehacer algo o puedo seguir con la operativa

### Criterios de aceptación

- CA-01 — Al apretar "Aplicar plan", el sistema procesa cada envío del plan y devuelve un resumen con cantidad de aplicados, cantidad de fallidos y la lista detallada.
- CA-02 — Para cada envío fallido veo el motivo en español (ej. "El estado del envío cambió a loaded", "El vehículo cambió de estado y no está disponible") para entender qué pasó.
- CA-03 — Después de cerrar el resumen, el plan se regenera automáticamente con el estado actualizado para retomar los pendientes desde ahí.

---

## US-097 — Rutear devoluciones al remitente

**Como** operador o supervisor
**Quiero** que el plan también incluya los envíos que están viniendo de regreso al remitente
**Para** que el contra-envío llegue a la sucursal de origen y se cierre el ciclo de devolución

### Criterios de aceptación

- CA-01 — Los envíos en mi sucursal con marca de devolución aparecen en el bucket inter-sucursal con destino la sucursal de origen del envío original (no la del destinatario fallido).
- CA-02 — En el chip del envío veo un badge "Devolución a remitente" para distinguirlos visualmente del resto.
- CA-03 — Las devoluciones nunca van a la sección de última milla: solo viajan en vehículos hasta llegar a su sucursal de origen, donde el operador local cierra el ciclo marcándolas como devueltas.

---

## US-098 — Extender la fecha estimada al iniciar un retorno

**Como** operador o supervisor
**Quiero** que cuando un envío empieza a volver al remitente, su fecha estimada de entrega se extienda automáticamente
**Para** que el sistema refleje el tiempo extra que va a tardar el viaje de regreso

### Criterios de aceptación

- CA-01 — Cuando un envío pasa a estado de retorno por rechazo del destinatario o por no retiro en sucursal, su fecha estimada se extiende 10 días.
- CA-02 — La extensión queda registrada en el historial de eventos del envío con la fecha vieja, la fecha nueva y el motivo, para auditar el cambio en cualquier momento.
- CA-03 — Cuando una cancelación genera un contra-envío, el contra-envío nace con su propia fecha estimada calculada (10 días desde la cancelación) y el envío original conserva la suya.

---

## US-099 — Configurar los parámetros del algoritmo de ruteo

**Como** admin
**Quiero** ajustar los parámetros que usa el algoritmo de ruteo desde una pantalla dedicada
**Para** afinar el equilibrio entre consolidación y velocidad sin necesidad de un deploy

### Criterios de aceptación

- CA-01 — En el menú veo el link "Config. ruteo" (solo admin) con todos los parámetros editables: horizonte SLA, umbral de prioridad, tasa mínima de carga, topes por chofer. Cada uno con descripción de qué hace y rangos válidos.
- CA-02 — El botón "Guardar" se habilita solo cuando hay cambios. Si cargo un valor fuera de rango (porcentaje negativo, horizonte mayor a 168 horas), el sistema rechaza el guardado y me muestra el motivo.
- CA-03 — Los cambios guardados se aplican a los planes generados a partir de ese momento. Los planes ya aplicados no se recalculan.

---

## Modelo y reglas técnicas

### `RoutingConfig` (singleton, tabla `routing_config` id=1)

| Campo | Default | Rango | Descripción |
|---|---|---|---|
| `sla_force_horizon_hours` | 24 | 1–168 | Horizonte para forzar despacho por SLA. |
| `priority_force_threshold` | 0.75 | 0–1 | Score de prioridad sobre el cual se fuerza despacho. |
| `min_fill_rate` | 0.40 | 0.1–1 | % mínimo de capacidad del vehículo más grande para consolidar. |
| `max_shipments_per_driver` | 15 | 1–100 | Tope de envíos en la ruta de un chofer. |
| `max_weight_kg_per_driver` | 150 | 1–5000 | Tope de peso en la ruta de un chofer. |

### Flujo del algoritmo (`GeneratePlan`)

1. **Cargar candidatos**: shipments con `receiving_branch_id == branch_id` y `status ∈ {at_origin_hub, at_hub}`. Excluir `delivery_method == retiro_sucursal`.
2. **Particionar**:
   - **Última milla**: `final_branch_id == branch_id && delivery_method == ultima_milla && status == at_hub && !is_returning`.
   - **Inter-sucursal**: el resto. Para devoluciones (`is_returning`) el destino es `origin_branch_id`; para el resto, `final_branch_id`.
3. **Bin-packing última milla**: ordenar por `priority_score DESC, time_window (morning>afternoon>flexible), created_at ASC`. Repartir entre choferes con load-balancing.
4. **Despacho inter-sucursal por destino**:
   - **Regla 1 — SLA forced**: alguno cumple `EstimatedDeliveryAt - now < sla_force_horizon_hours` o `priority_score >= priority_force_threshold`.
   - **Regla 2 — Consolidación**: `sum(peso) >= min_fill_rate × largest_vehicle_capacity_in_pool`.
   - **Si ninguna**: a `unassigned` con motivo `esperando_consolidacion`.
5. **Selección de vehículo**: el más chico que cubre el peso total. Si ninguno cubre, el más grande con bin-packing por prioridad (excedente a `unassigned`).
6. **Pasada piggyback**: para cada `unassigned` con motivo de inter-sucursal, buscar despacho cuyo destino esté **más cerca** del destino del envío que la sucursal actual. Cualquier mejora cuenta. Elegir la mayor.

### `ApplyPlan` — semántica per-item, no transaccional

- Re-fetcheo de cada shipment y vehicle antes de mutar.
- Drift detectado (estado del shipment cambió, vehículo no disponible, capacidad excedida) → item marcado `failed` con motivo en español, el resto continúa.
- Para inter-sucursal: setea `destination_branch` del vehículo + asigna shipments + transiciona shipment a `loaded` + promueve vehículo a `en_carga`. **NO** ejecuta `start-trip` (sigue siendo manual desde Flota).
- Para última milla: usa el flujo existente (`UpdateStatus(out_for_delivery, driver_id)` + `RouteService.AddShipmentToDriverRoute`).

### Evento `shipment_eta_extended`

Nuevo tipo de evento de dominio (`EventShipmentETAExtended`) emitido cuando:
- Un envío transiciona a `no_entregado` o `rechazado` (la proyección setea `is_returning = true`): se extiende su `EstimatedDeliveryAt` en `ReturnETAExtraDays = 10` días.

Payload `ShipmentETAExtendedPayload{OldETA, NewETA, AddedDays, Reason}`. La proyección actualiza `shipment.EstimatedDeliveryAt`.

Para contra-envíos generados por cancelación: la nueva `EstimatedDeliveryAt = max(now, parent.EstimatedDeliveryAt) + 10 días` se setea en el `shipment_created` del contra-envío (no requiere evento extra).

## Endpoints

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| POST | `/api/v1/routing/plan` | operator, supervisor (su sucursal) | Genera un plan en memoria. No persiste. |
| POST | `/api/v1/routing/apply` | operator, supervisor (su sucursal) | Aplica el plan editado. Devuelve resumen per-item. |
| GET | `/api/v1/routing/config` | admin | Devuelve configuración activa. |
| PATCH | `/api/v1/routing/config` | admin | Actualiza configuración con validación de rangos. |

> **Branch-scoped enforcement**: operator/supervisor solo pueden generar/aplicar planes para su propia sucursal. El backend valida `user.branch_id == req.branch_id` y devuelve 403 si no coincide.

## Limitación documentada (MVP)

El algoritmo rutea **un solo hop**, usando `final_branch_id` (o `origin_branch_id` para retornos) como destino directo. La máquina de estados soporta multi-hop (`at_hub → in_transit (next hop)`), pero hoy no hay un grafo de adyacencia entre sucursales. Si la sucursal actual no es vecina directa del destino, el operador puede igualmente aplicar el plan; el envío llegará al destino final que quizás no sea alcanzable en un viaje. La regla de **piggyback** mitiga este caso de manera oportunística cuando un despacho a una sucursal intermedia acerca el envío a su destino final.
