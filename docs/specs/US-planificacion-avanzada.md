# User Stories — Planificación logística avanzada

---

## US-CAL01. Calendario de viajes aplicados por semana

**Descripción**
Como operador o supervisor
Quiero ver todos los viajes inter-sucursal y de última milla aplicados en una vista semanal tipo Google Calendar
Para tener una visión temporal de la operación de mi sucursal y navegar entre semanas.

**Priorización:** MUST

**Criterios de aceptación**

*Escenario: Visualización semanal de viajes aplicados*
- Given que existen viajes aplicados (`InterBranchTrip`) en la semana visible
- When el usuario accede a `/calendar` y selecciona la vista "Semana"
- Then debe ver un eje horizontal de días (lunes a domingo) con bloques posicionados por hora de salida y duración estimada
- And cada bloque debe mostrar la patente del vehículo, el recorrido (origen → paradas → destino) y el estado del viaje
- And los viajes de última milla deben distinguirse visualmente de los inter-sucursal (color distinto)

*Escenario: Viaje que cruza medianoche*
- Given que un viaje sale hoy a las 08:00 y llega mañana a las 06:32
- When se renderiza en el calendario semanal
- Then debe mostrarse un bloque que desciende hasta el borde inferior de la columna de hoy
- And debe mostrarse un bloque de continuación en la columna de mañana desde las 00:00 hasta las 06:32
- And hacer click en cualquiera de los dos segmentos debe abrir el mismo detalle del viaje

*Escenario: Detalle del viaje al hacer click*
- Given que el usuario hace click sobre un bloque del calendario
- When se abre el popover de detalle
- Then debe mostrar patente, tipo de viaje, estado, hora de salida planificada, llegada estimada, itinerario con ETAs por parada, chofer asignado y cantidad de envíos

---

## US-CAL02. Timeline de viajes por vehículo

**Descripción**
Como operador o supervisor
Quiero ver la ocupación diaria de cada vehículo en una vista tipo Gantt horizontal
Para responder rápidamente si un vehículo está libre, cuándo vuelve y si hay solapamientos.

**Priorización:** MUST

**Criterios de aceptación**

*Escenario: Visualización por vehículo del día seleccionado*
- Given que existen vehículos asignados a la sucursal del usuario
- When accede a `/calendar` con la vista "Por vehículo"
- Then debe ver una fila por cada vehículo activo, agrupadas en sección Inter-sucursal y sección Última milla
- And el eje horizontal debe representar 00:00 a 24:00 del día seleccionado
- And cada viaje aplicado debe mostrarse como un bloque posicionado según su hora de salida y duración real

*Escenario: Vehículo libre*
- Given que un vehículo no tiene viajes en el día seleccionado
- When se renderiza la fila correspondiente
- Then debe mostrar el indicador "Libre" sobre el fondo de la fila

*Escenario: Viaje que continúa desde el día anterior*
- Given que un viaje salió ayer y aún no llegó
- When el usuario navega al día de hoy en el timeline
- Then debe mostrarse un bloque de continuación (↓ hasta HH:MM) desde las 00:00 hasta la hora de llegada estimada
- And el bloque debe tener estilo visual distinto (borde punteado izquierdo)

*Escenario: Navegación entre días*
- Given que el usuario está viendo el timeline
- When hace click en "Anterior" o "Siguiente"
- Then debe cargar los viajes del día correspondiente
- And debe hacer scroll automático a la primera franja con actividad o a la hora actual si es hoy

---

## US-CAL03. Pronósticos de despacho en el calendario

**Descripción**
Como operador o supervisor
Quiero ver en el calendario los despachos proyectados para los próximos días
Para anticipar la ocupación de la flota con antelación.

**Priorización:** SHOULD

**Criterios de aceptación**

*Escenario: Despacho proyectado visible en vista semana*
- Given que el plan multi-día generó despachos para mañana (D+1) o pasado (D+2)
- When el usuario ve la vista Semana del calendario
- Then los despachos proyectados deben aparecer como bloques en sus columnas correspondientes con estilo rayado y borde punteado
- And deben indicar "pronóstico" visualmente

*Escenario: Despacho proyectado visible en timeline por vehículo*
- Given que el plan proyectado asigna un vehículo a un despacho en D+1
- When el usuario navega al día D+1 en el timeline
- Then debe verse un bloque de pronóstico en la fila de ese vehículo con estilo rayado

---

## US-SCH01. Hora de salida y llegada estimada por despacho inter-sucursal

**Descripción**
Como operador o supervisor
Quiero que cada despacho inter-sucursal tenga hora de salida y llegada estimadas calculadas automáticamente
Para planificar la operación diaria y ver los viajes en el calendario con franjas horarias reales.

**Priorización:** MUST

**Criterios de aceptación**

*Escenario: Hora de salida calculada*
- Given que se genera el plan diario
- When el motor asigna un despacho inter-sucursal
- Then debe calcular la hora de salida en base al parámetro `inter_branch_dispatch_hour` (configurable, default 08:00)

*Escenario: Hora de llegada estimada por parada*
- Given que un despacho tiene una o más paradas
- When se calcula el schedule
- Then debe calcular la llegada a cada parada usando `AvgTransitHours` del grafo de sucursales como fuente primaria
- And si la arista no tiene datos históricos, debe usar `inter_branch_avg_speed_kmh` (configurable, default 60 km/h) con factor de detour 1.3
- And debe sumar `inter_branch_stop_minutes` (configurable, default 4 horas) en cada parada intermedia para el dwell de descarga y carga
- And solo la última parada no suma dwell

*Escenario: Hora de salida editable al aplicar*
- Given que el operador abre el modal "Revisar despacho"
- When cambia la hora de salida con el selector de tiempo
- Then las llegadas estimadas a cada parada deben recalcularse en tiempo real
- And al aplicar, el viaje debe persistir la hora de salida editada y las llegadas recalculadas

*Escenario: La hora de salida por defecto es ahora + 30 minutos*
- Given que el operador abre el modal "Revisar despacho" para aplicar
- When se abre el modal
- Then la hora de salida sugerida debe ser la hora actual + 30 minutos
- And el operador puede modificarla antes de aplicar

*Escenario: Persistencia de tiempos al aplicar*
- Given que el operador aplica un despacho
- When se crea el `InterBranchTrip`
- Then debe persistir `scheduled_departure_at` y `estimated_arrival_at` como timestamps absolutos
- And cada parada del viaje debe persistir su `estimated_arrival_at` individual

---

## US-HOR01. Plan multi-día con horizonte de 3 días

**Descripción**
Como operador o supervisor
Quiero que el plan de ruteo cubra los próximos 3 días
Para ver no solo lo que se despacha hoy sino cómo quedará la flota disponible mañana y pasado.

**Priorización:** MUST

**Criterios de aceptación**

*Escenario: Generación del horizonte*
- Given que el scheduler corre a las 08:00 o el admin regenera el plan global
- When se ejecuta la generación
- Then deben crearse 3 planes: hoy (D+0), mañana (D+1) y pasado (D+2)
- And D+0 tiene `is_forecast = false` (aplicable)
- And D+1 y D+2 tienen `is_forecast = true` (pronósticos, solo lectura)

*Escenario: Proyección de disponibilidad de flota*
- Given que un vehículo sale hoy hacia otra sucursal y tiene `estimated_arrival_at` conocido
- When se genera el plan de D+1
- Then ese vehículo debe estar disponible en su sucursal de destino a partir de la hora de llegada estimada
- And debe poder ser asignado a un nuevo despacho en D+1 si consolida

*Escenario: Cascada de envíos*
- Given que un envío llega a un hub intermedio en D+0 como transferencia
- When se genera el plan de D+1
- Then ese envío debe aparecer como candidato para despacho en ese hub al día siguiente

*Escenario: Planes no aplicables*
- Given que un operador intenta aplicar el plan de un día futuro
- When el backend recibe la solicitud
- Then debe rechazarla con error explícito `no_se_puede_aplicar_pronostico`
- And el frontend no debe mostrar el botón "Aplicar" en días de pronóstico
- And debe mostrar el banner "Pronóstico — no aplicable"

*Escenario: Selector de días en pantalla de ruteo*
- Given que existen planes generados para el horizonte
- When el operador accede a `/routing` o `/inter-sucursal`
- Then debe ver tabs "Hoy | Mañana DD/MM | Pasado DD/MM"
- And los días de pronóstico deben ser de solo lectura sin botones de acción

---

## US-HOR02. Diferimiento automático por ventana horaria vencida

**Descripción**
Como operador
Quiero que los envíos cuya ventana horaria ya venció no aparezcan en el plan de hoy
Para que el motor los planifique automáticamente para mañana sin intervención manual.

**Priorización:** MUST

**Criterios de aceptación**

*Escenario: Ventana mañana vencida*
- Given que un envío tiene `time_window = "morning"` y la hora actual superó `morning_window_end_hour` (default 14:00)
- And `enforce_time_windows = true`
- When se genera el plan del día
- Then el envío debe aparecer en Sin asignar con motivo "Ventana horaria vencida para hoy — programado para mañana"
- And no debe entrar a la cola de última milla del día actual

*Escenario: Reincorporación al día siguiente*
- Given que un envío fue diferido por ventana vencida en D+0
- When se genera el plan de D+1
- Then el envío debe aparecer como candidato de última milla para el día siguiente

*Escenario: Envíos flexible no diferidos*
- Given que un envío tiene `time_window = "flexible"`
- When la hora actual es cualquiera
- Then nunca debe diferirse por motivo de ventana horaria

*Escenario: Modo blando sin diferimiento*
- Given que `enforce_time_windows = false`
- When la ventana ya venció
- Then el envío debe seguir en la cola de última milla y el VRP lo incluye con penalización

---

## US-BCK01. Backhauling inter-sucursal (round-trip)

**Descripción**
Como operador o supervisor
Quiero que el motor detecte oportunidades de carga de retorno en los viajes inter-sucursal
Para que el mismo vehículo vuelva cargado en lugar de hacerlo en vacío.

**Priorización:** MUST

**Criterios de aceptación**

*Escenario: Round-trip generado cuando ambas direcciones consolidan*
- Given que la sucursal A tiene carga suficiente para B (≥ `min_fill_inter_branch_rate` × capacidad)
- And la sucursal B tiene carga suficiente para A (misma regla)
- When se genera el plan global
- Then el motor debe detectar el par de dispatches opuestos
- And debe elegir el vehículo con mayor fill rate combinado `(outbound + return) / (2 × capacidad)` para hacer el round-trip
- And el dispatch del vehículo perdedor debe disolverse, absorbiendo su carga como parada de retorno del ganador

*Escenario: Carga levantada en la parada correcta*
- Given que un round-trip A → B → A tiene carga de retorno
- When se aplica el plan
- Then el pickup (recolección) de la carga de retorno debe registrarse en la parada B
- And el dropoff (entrega) debe registrarse en la parada A final
- And en el mapa del modal "Revisar despacho", B debe mostrarse con marcador numerado y A con el símbolo ↩

*Escenario: Backhaul no se genera sin consolidación ni SLA*
- Given que en el destino hay carga de retorno insuficiente
- And ningún envío es SLA-forzado
- When se evalúa el backhaul
- Then el vehículo no debe volver con carga (queda disponible en destino)
- And los envíos de retorno quedan como candidatos para un despacho futuro

*Escenario: Backhaul forzado por SLA*
- Given que en el destino hay al menos un envío con SLA próximo a vencer
- When se evalúa el backhaul
- Then el retorno debe armarse aunque no alcance el mínimo de consolidación

*Escenario: Badge de backhaul visible en el plan*
- Given que un despacho tiene carga de retorno
- When el operador ve la card del despacho en `/inter-sucursal`
- Then debe ver el badge "↩ Backhaul · N env."
- And en el modal "Revisar despacho" debe ver el panel "Backhaul (retorno al origen)" con peso y fill rate

*Escenario: Backhaul activable/desactivable por configuración*
- Given que el admin accede a `/routing-config`
- When desactiva el toggle "Backhauling (round-trip)"
- Then el motor no debe generar ningún round-trip en los planes siguientes

---

## US-BCK02. Balanceo de flota blando

**Descripción**
Como operador o supervisor
Quiero que el motor evite dejar una sucursal sin vehículos disponibles
Para asegurar cobertura operativa mínima en todas las sucursales activas.

**Priorización:** SHOULD

**Criterios de aceptación**

*Escenario: Retención del último vehículo*
- Given que todos los dispatches de una sucursal son one-way (sin retorno) y no hay vehículos inbound
- And ninguno de los dispatches es SLA-forzado
- When se genera el plan global
- Then el motor debe retener el dispatch de menor prioridad
- And sus envíos deben aparecer en Sin asignar con motivo "Se retiene el último vehículo de la sucursal (balanceo de flota)"

*Escenario: SLA supera al balanceo*
- Given que el único dispatch de una sucursal es SLA-forzado
- When se evalúa el balanceo
- Then el dispatch debe salir igualmente aunque deje la sucursal sin vehículos

*Escenario: Round-trip no activa la retención*
- Given que el único dispatch de una sucursal es un round-trip (vuelve al origen)
- When se evalúa el balanceo
- Then no debe retenerse ningún dispatch (el vehículo retorna)

*Escenario: Balanceo activable/desactivable*
- Given que el admin accede a `/routing-config`
- When desactiva el toggle "Balanceo de flota"
- Then el motor no debe retener ningún dispatch por este motivo
