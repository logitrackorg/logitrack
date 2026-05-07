# Manual de usuario — Ruteo inteligente

## Qué es y para qué sirve

El **Ruteo inteligente** es la pantalla donde, al comienzo del día, el sistema te propone cómo distribuir todos los envíos pendientes de tu sucursal entre tus choferes (entregas a domicilio) y tus vehículos (viajes a otras sucursales). En lugar de armar la operativa envío por envío, generás un plan completo en un click, lo revisás, lo ajustás si hace falta arrastrando envíos, y recién cuando aprobás se aplica.

Para los envíos de **última milla** (entregas en tu ciudad), el sistema además calcula la **secuencia óptima de paradas** de cada chofer, estima la hora de llegada a cada cliente y considera las ventanas horarias del envío (mañana / tarde / flexible).

Vos seguís siendo quien decide. El sistema te muestra una **propuesta** — vos podés mover envíos a mano antes de aplicar.

## Cómo se entra

1. Login como **operador** o **supervisor**.
2. En el menú, **"Ruteo"**.
3. Tocá **"Generar plan"**.

El plan se calcula en menos de un segundo. Aparecen 3 secciones (las que aplican):

- **Sin asignar** — envíos que no entraron en ningún chofer/vehículo.
- **Última milla** — un card por chofer de tu sucursal, con la secuencia ordenada de paradas.
- **Despachos a otras sucursales** — un card por vehículo de tu sucursal, con los envíos que viajan.

## Cómo arma el plan

### Paso 1 — Junta los envíos pendientes en tu sucursal

Solo entran al plan los envíos que están físicamente en tu sucursal (estado `at_hub`, `at_origin_hub` o `redelivery_scheduled`). Quedan afuera automáticamente:

- Los terminales (entregados, cancelados, devueltos, perdidos, destruidos).
- Los que ya están en algún vehículo o ruta de chofer.
- Los de **retiro en sucursal** (el cliente los pasa a buscar — no necesitan ruteo).

### Paso 2 — Separa última milla de inter-sucursal

- **Última milla**: envíos cuya sucursal final es la tuya y son entrega a domicilio. Se reparten entre tus choferes y se ordenan en una secuencia óptima.
- **Inter-sucursal**: envíos que tienen que viajar a otra sucursal. Se agrupan por destino y se asignan a vehículos.
- **Devoluciones** (envíos rechazados o no retirados que vuelven al remitente): siempre van por inter-sucursal con destino la sucursal de origen del envío original.

### Paso 3 — Última milla: VRP con secuencia óptima

Para los envíos de última milla, el sistema resuelve un **Vehicle Routing Problem** simplificado:

1. **Carga las coordenadas** del depósito (tu sucursal) y de cada dirección de entrega.
2. **Calcula tiempos de viaje** entre todos los puntos. Si está disponible OSRM (rutas reales por calle), lo usa; si no, usa distancia Haversine × 1.3 (factor de detour) con velocidad media de 25 km/h.
3. **Construye una ruta inicial por chofer** con un algoritmo de "vecino más cercano" — siempre elige la próxima parada más cercana que respete las ventanas horarias y la capacidad del chofer.
4. **Optimiza intercambiando segmentos** (algoritmo 2-opt) — prueba revertir tramos de la ruta para ver si reducen el tiempo total. Acepta el cambio solo si las ventanas siguen cumpliéndose.
5. **Devuelve cada ruta ordenada** con tiempos estimados de llegada por parada (calculados desde la hora de salida + tiempos de viaje + 10 min por parada para estacionar/entregar).

Reglas de capacidad por chofer (configurables):

- Tope de cantidad: 15 envíos por chofer.
- Tope de peso: 150 kg por chofer.
- Carga existente cuenta: si el chofer ya tiene 3 envíos en `out_for_delivery` de un Apply previo, esos se descuentan de su capacidad disponible.

Ventanas horarias **hard**: si un envío tiene ventana "Mañana" y el sistema no puede llegar antes del mediodía (por distancia o porque el plan se generó tarde), va a **Sin asignar** con motivo "No se puede cumplir la ventana horaria del envío".

Si un envío no tiene coordenadas (algo falló al geocodificar), se appendea al final de la ruta del chofer menos cargado con badge ámbar **"Sin coordenadas"** y arrival "—". El chofer decide el orden de esa parada en campo.

### Paso 4 — Inter-sucursal: 3 reglas para decidir si despachar o esperar

Para cada destino con envíos pendientes, el sistema evalúa en orden:

**Regla 1 — SLA crítico (forzar despacho)**

Si **alguno** de los envíos a ese destino cumple cualquiera de:

- Su fecha estimada de entrega cae dentro de las próximas 24 horas (configurable).
- Su `priority_score` supera 0.75 (configurable).

→ **Despacha** aunque el vehículo vaya casi vacío. Aparece como *"SLA crítico"* en el card.

**Regla 2 — Consolidación**

Si la suma de pesos al destino es **≥ 40%** de la capacidad del vehículo más grande disponible.

→ **Despacha**. Aparece como *"Consolidación"*.

**Regla 3 — Esperar**

Si no se cumple ninguna → **NO despacha**. Los envíos van a **Sin asignar** con motivo "Esperando consolidación con otros envíos al mismo destino".

### Paso 5 — Elige el vehículo óptimo

- **El vehículo más chico que cubra el peso total** (minimiza desperdicio de capacidad).
- Si **ninguno cubre todo**: usa el más grande disponible y bin-packea por prioridad. El sobrante va a **Sin asignar** con motivo "Excede capacidad del vehículo más grande".

### Paso 6 — Piggyback

Para cada envío que quedó **Sin asignar** por motivo inter-sucursal, el sistema mira los despachos ya armados. Si encuentra uno cuyo destino esté **estrictamente más cerca** del destino final del envío que tu sucursal actual, y el vehículo tiene capacidad → lo suma a esa carga. Si hay varios candidatos, elige el que más acerca el envío.

**Ejemplo (datos del seed)**: estás en CABA, tenés 2 envíos chicos a Mendoza (20 kg total) que solos no llegan al mínimo de consolidación. Pero tenés un despacho a Córdoba ya armado. Como Córdoba (~470 km de Mendoza) está más cerca de Mendoza que CABA (~1075 km), los envíos a Mendoza **se suben al camión que va a Córdoba**. Aparecen con badge naranja **"Tránsito parcial → MEND-01"**. Cuando el camión llega a Córdoba, los descargan y el operador local los reroutea al día siguiente.

## Cómo leer la pantalla del plan

**Resumen arriba** (4 chips): asignables, sin asignar, despachos, choferes.

### Sección "Sin asignar"

Card con borde ámbar. Envíos agrupados por motivo. Cada chip muestra peso, prioridad, badges (Frágil, Express, Devolución). Hacés click para abrir el modal de detalle del envío.

### Sección "Última milla"

Un card por chofer. El header muestra:

- Nombre del chofer.
- Hora de salida estimada.
- Duración total estimada de la ruta.
- Distancia total recorrida.
- Cantidad y peso totales (nuevos + ya en ruta).

Adentro, **lista numerada de paradas** en el orden óptimo:

- Número 1, 2, 3... (orden de visita).
- Tracking ID.
- Hora estimada de llegada (`HH:MM`).
- Badge de ventana horaria (Mañana cyan / Tarde violeta / Flexible gris).
- Peso, prioridad, badges de Frágil / Express si aplica.

Si el chofer ya tiene envíos en `out_for_delivery` de antes, abajo aparece una sección **"Ya en su ruta del día"** listándolos con badge celeste **"En ruta"**. Esos no son draggables — el chofer ya los tiene.

Choferes que todavía no tienen envíos asignados aparecen como **cards punteados** con sublabel "Sin envíos asignados" (o "X envíos en ruta · Y kg pendientes" si tiene carga previa).

### Sección "Despachos a otras sucursales"

Un card por vehículo. El header muestra:

- Patente → sucursal destino.
- Badge de la regla (*"SLA crítico"* en rojo o *"Consolidación"* en celeste).
- Carga: `380.0 / 800 kg (47%)`.

Adentro, lista de envíos. Los que viajan de paso (piggyback) muestran badge naranja **"Tránsito parcial → [sucursal final]"**.

Si el vehículo ya tiene envíos cargados (status `loaded`) de antes, abajo aparece sección **"Ya cargado en el vehículo"** con badge índigo **"Ya cargado"**.

Vehículos disponibles sin despacho aparecen como **cards punteados** con sublabel "Disponible · X / Y kg".

## Cómo ajustar el plan: drag & drop

Para mover un envío:

1. **Hacé click sostenido** sobre cualquier envío de cualquier sección.
2. **Arrastralo** sobre un chofer o vehículo del plan.
3. Mientras arrastrás:
   - Los **destinos válidos** se resaltan con borde **verde** y mensaje "Soltá acá para asignar".
   - Los **destinos inválidos** se atenúan al 60% (no aceptan).
4. **Soltá** sobre el destino verde y el envío se mueve.

### Reglas que el sistema valida automáticamente

| Caso | Resultado |
|---|---|
| Envío de última milla → chofer | OK si hay capacidad |
| Envío de última milla → vehículo inter-sucursal | Bloqueado (no tiene sentido) |
| Envío inter-sucursal → vehículo | OK si hay capacidad |
| Envío inter-sucursal → chofer | Bloqueado |
| Cualquier envío → "Sin asignar" | OK |
| Sobre el chofer/vehículo de origen | No-op |
| Excede peso o cantidad del destino | Bloqueado, aparece toast con el motivo |
| Chofer con ruta del día ya iniciada | Ni siquiera aparece como destino |
| Vehículo en viaje, en mantenimiento o inactivo | Ni siquiera aparece como destino |

Cuando un drop falla por validación, aparece un **toast rojo arriba del listado** durante 4 segundos con el motivo exacto.

### Drop a "Sin asignar"

Si la sección "Sin asignar" no existe en este plan (porque no había envíos sin asignar), apenas empezás a arrastrar aparece un placeholder ámbar punteado **"Soltá acá para mover el envío a Sin asignar"**.

### Si soltás sobre un chofer/vehículo del pool sin asignaciones previas

El card se "promueve" automáticamente: pasa de placeholder punteado a card normal con el envío adentro. Si el chofer/vehículo ya tenía envíos previos en su ruta/carga, los vas a ver listados abajo con badges "En ruta" / "Ya cargado".

### Para volver al plan original

Si hiciste cambios y querés descartarlos, tocá **"Descartar cambios"** arriba.

## Ver detalle de un envío

**Hacé click izquierdo** sobre cualquier envío para abrir un **modal de información** (solo lectura, sin acciones):

- Datos del envío: peso, tipo de paquete, frágil, tipo de envío (normal/express), ventana horaria, método de entrega, intentos.
- Datos del remitente: nombre, DNI, teléfono, dirección.
- Datos del destinatario: nombre, DNI, teléfono, email, dirección.
- Ruta: sucursal de origen, recepción, destino final, ubicación actual.
- Tiempos: creado, actualizado, ETA, entregado.
- Banners contextuales: si es devolución, tiene incidente reportado, o tiene instrucciones especiales.

Para cerrar: click fuera del modal o botón "Cerrar" abajo.

## Cómo se aplica el plan

Tocá **"Aplicar plan"**. Lo que pasa:

1. Por cada envío del plan, el sistema valida que su estado actual sigue siendo válido (puede haber cambiado mientras vos editabas — ej. otro operador lo asignó manualmente, el chofer arrancó la ruta, etc.).
2. **Última milla**: el envío pasa a `out_for_delivery` y se agrega a la ruta del chofer del día, **en el orden de la secuencia VRP**.
3. **Inter-sucursal**: el vehículo queda en estado `en_carga` con destino seteado. **El viaje no arranca todavía**.
4. Te muestra un resumen: **"X aplicados, Y fallidos"**. Cada fallo aparece con el motivo en español (ej. "El estado del envío cambió a loaded", "El vehículo cambió de estado y no está disponible").
5. Al cerrar el resumen, el plan se regenera con el estado actualizado.

## Cómo arrancar los viajes después

Aplicar el plan **no inicia los viajes** — solo deja todo cargado y listo. Cuando el chofer / vehículo está físicamente listo, vas a **Flota** (`/vehicles`), seleccionás el vehículo y tocás **"Iniciar viaje"**. Como el destino ya quedó seteado por el plan, el modal te muestra solo una **confirmación** del destino — confirmás y el viaje arranca.

## Cómo se manejan las devoluciones

Cuando un envío vuelve al remitente:

- El sistema **extiende su fecha estimada de entrega 10 días** automáticamente, para reflejar el viaje de regreso. Queda en el historial como evento auditable.
- En el plan, el envío aparece con badge naranja **"Devolución a remitente"** y se trata como inter-sucursal con destino la sucursal de **origen** del envío original.
- Las devoluciones **no se asignan a choferes de última milla** — solo viajan en vehículos hasta llegar a su sucursal de origen, donde el operador local cierra el ciclo marcándolas como "devueltas" con DNI del remitente.

## Casos especiales

### Generaste el plan tarde

Si tocás "Generar plan" a las 14:00, el sistema usa **la hora actual como hora de salida** (no las 8:00). Las horas estimadas de llegada parten de las 14:00. Si un envío tiene ventana "Mañana" y ya pasó el mediodía, queda en "Sin asignar" con motivo "ventana horaria inviable".

### Chofer con ruta iniciada

Si el chofer ya tocó "Iniciar ruta" en su app, no podés sumarle más envíos. El plan **lo excluye automáticamente** de los choferes elegibles y aparece como `blocked_driver` con motivo "Ruta ya iniciada". No vas a ver el card en la pantalla.

### Vehículo en viaje

Vehículos en estado `en_transito`, `mantenimiento` o `inactivo` no aparecen como destinos posibles. Solo `disponible` y `en_carga`.

### Ningún envío entra al VRP

Si el depósito o todos los envíos no tienen coordenadas, el sistema cae al algoritmo greedy clásico (mismo bin-packing pero sin secuencia ordenada). En la práctica esto no debería pasar porque el geocoder se ejecuta automáticamente al crear cada envío.

### Apply parcialmente exitoso

Si algunos envíos fallan al aplicarse (drift de estado), el modal te muestra cada falla con su motivo. Los que sí aplicaron se aplican; los demás se quedan como estaban. Después de cerrar el modal, el plan se regenera y vas a ver el estado actualizado.

## Configuración (admin)

El admin puede ajustar los parámetros del algoritmo desde **Config. ruteo** (`/routing-config`):

| Parámetro | Default | Para qué sirve |
|---|---|---|
| Horizonte SLA (h) | 24 | Cuán cerca tiene que estar la fecha estimada para forzar despacho. |
| Umbral prioridad | 0.75 | Score sobre el cual se fuerza despacho. |
| Tasa mínima de carga | 40% | % del vehículo más grande que hay que llenar para consolidar. |
| Envíos máx. por chofer | 15 | Tope de cantidad por ruta de chofer. |
| Peso máx. por chofer (kg) | 150 | Tope de peso por ruta de chofer. |

Los cambios se aplican a partir del próximo plan generado. Los ya aplicados no se recalculan.

## Limitaciones a tener en cuenta

- **Un solo hop por defecto**: el algoritmo asume que un vehículo va directo del origen al destino. Cuando geográficamente no es así, la regla de piggyback ayuda a encadenar tramos. Vos siempre podés mover envíos a mano si conocés mejor la ruta real.
- **Capacidad por chofer es por número y peso, no por volumen ni distancia**: si tu operativa tiene zonas muy distantes que requieren rutas separadas, eso lo seguís decidiendo a mano.
- **Tiempos estimados son aproximados**: con OSRM activo son tiempos reales por calle, sin OSRM son aproximaciones por distancia × velocidad media. En ningún caso predicen tráfico en tiempo real.
- **El service time (10 min/parada) es un promedio**: en zonas de edificios con porteros puede ser más; en barrios residenciales rápidos, menos.
