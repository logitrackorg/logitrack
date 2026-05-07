# Manual de usuario — Ruteo inteligente

## Qué es y para qué sirve

El **Ruteo inteligente** es una función que sugiere automáticamente cómo distribuir todos los envíos pendientes de tu sucursal entre los choferes (para entrega a domicilio) y los vehículos (para viajes a otras sucursales). Lo usás al **comienzo del día**, en vez de armar la operativa envío por envío.

Vos seguís siendo quien decide. El sistema te muestra una **propuesta**, vos la podés ajustar a mano y recién cuando aprobás todo, el plan se aplica.

## Cómo se entra

1. Login como **operador** o **supervisor**.
2. En el menú principal, hacé click en **"Ruteo"**.
3. Tocá **"Generar plan"**.

El plan se calcula en menos de un segundo y aparece dividido en 3 secciones:

- **Sin asignar** (si hay)
- **Última milla** (envíos para repartir hoy en tu ciudad)
- **Despachos a otras sucursales** (envíos que viajan)

## Cómo arma el plan: las decisiones que toma

### Paso 1 — Junta los envíos pendientes en tu sucursal

Solo entran al plan los envíos que están físicamente en tu sucursal (estado `at_hub` o `at_origin_hub`). Quedan afuera automáticamente:

- Los terminales (entregados, cancelados, devueltos, perdidos, destruidos).
- Los que ya están en algún vehículo o ruta de chofer.
- Los de **retiro en sucursal** (el cliente los pasa a buscar — no necesitan ruteo).

### Paso 2 — Separa última milla de inter-sucursal

- **Última milla**: envíos cuya sucursal final es la tuya y son entrega a domicilio. Acá se reparten entre tus choferes.
- **Inter-sucursal**: envíos que tienen que viajar a otra sucursal. Acá se agrupan por destino y se asignan a vehículos.
- **Devoluciones** (envíos rechazados o no retirados que vuelven al remitente): siempre van por inter-sucursal. Su destino es la sucursal de origen del envío original.

### Paso 3 — Última milla: bin-packing por chofer

Para cada chofer disponible en tu sucursal:

- Reparte los envíos respetando el **tope de cantidad** (default 15 por chofer) y el **tope de peso** (default 150 kg por chofer).
- Da prioridad a los envíos con mayor `priority_score` y ventana horaria más restrictiva (Mañana antes que Tarde antes que Flexible).
- Distribuye con **load-balancing**: el envío entra siempre al chofer que tiene menos peso acumulado, para nivelar las rutas.
- Si un envío no entra en ningún chofer (capacidad llena), va a **Sin asignar** con el motivo "Los choferes ya están al tope".

### Paso 4 — Inter-sucursal: 3 reglas para decidir si despachar o esperar

Para cada destino con envíos pendientes, el sistema evalúa en orden:

**Regla 1 — SLA crítico (forzar despacho)**

Si **alguno** de los envíos a ese destino cumple cualquiera de:

- Su fecha estimada de entrega cae dentro de las próximas 24 horas (configurable).
- Su `priority_score` supera 0.75 (configurable).

→ **Despacha** aunque el vehículo vaya casi vacío. La regla aparece como *"SLA crítico"* en el panel para que entiendas por qué sale el viaje con poca carga.

**Regla 2 — Consolidación**

Si la suma de pesos de los envíos al destino es **≥ 40%** de la capacidad del vehículo más grande disponible en tu sucursal (configurable).

→ **Despacha**. La regla aparece como *"Consolidación"*.

**Regla 3 — Esperar**

Si no se cumple ninguna de las anteriores → **NO despacha**. Los envíos van a **Sin asignar** con el motivo "Esperando consolidación con otros envíos al mismo destino".

### Paso 5 — Elige el vehículo óptimo

Una vez que decide despachar a un destino, el sistema elige el vehículo:

- Filtra los disponibles: estado `disponible` o `en_carga`, asignados a tu sucursal, sin destino conflictivo.
- Elige el **vehículo más chico que cubra el peso total**. Por ejemplo, si la carga es de 380 kg y tenés un auto de 300 kg y una furgoneta de 800 kg, elige la furgoneta (la más chica que cubre).
- Si **ningún vehículo cubre todo**: usa el más grande disponible y bin-packea por prioridad. Lo que no entra queda en **Sin asignar** con motivo "Excede capacidad del vehículo más grande".

### Paso 6 — Pasada de **piggyback** (aprovechar viajes)

Esta es la regla más sutil pero la más útil. Para cada envío que quedó **Sin asignar** por motivos de inter-sucursal:

- El sistema mira los despachos ya armados.
- Si encuentra uno cuyo destino esté **estrictamente más cerca** del destino final del envío que tu sucursal actual (medido en km), y el vehículo tiene capacidad → lo suma a esa carga.
- Si hay varios candidatos, elige el que **más acerca** el envío.

**Ejemplo real (datos del seed)**: estás en CABA, tenés 2 envíos chicos a Mendoza (20 kg total) que solos no llegan al mínimo de consolidación. Pero tenés un despacho a Córdoba ya armado (5 envíos, 400 kg). Como Córdoba (~470 km de Mendoza) está más cerca de Mendoza que CABA (~1075 km), los envíos a Mendoza **se suben al camión que va a Córdoba**. En la pantalla aparecen con un badge naranja **"Tránsito parcial → MEND-01"**. Cuando el camión llegue a Córdoba, los descargan ahí y el operador de Córdoba los reroutea al día siguiente.

## Cómo leer la pantalla del plan

Después de generar:

**Resumen arriba** (4 chips): asignables, sin asignar, despachos, choferes.

**Sección "Sin asignar"** (si hay): envíos agrupados por motivo. Cada chip muestra peso, prioridad, frágil/express si aplica, y el motivo en lenguaje claro.

**Sección "Última milla"**: tarjetas por chofer. Cada tarjeta muestra el nombre del chofer, cantidad de envíos asignados y peso total. Cada chip de envío muestra peso + prioridad + badges (frágil, express).

**Sección "Despachos a otras sucursales"**: tarjetas por despacho. Cada tarjeta muestra:

- **Patente del vehículo → sucursal destino**
- Badge de la regla (*"SLA crítico"* en rojo o *"Consolidación"* en celeste)
- Carga: `380.0 / 800 kg (47%)`
- Lista de envíos con sus chips. Los que viajan de paso (piggyback) muestran badge naranja **"Tránsito parcial → [sucursal final]"**.

## Cómo ajustar el plan a mano

Cada envío del plan tiene un botón **"Reasignar"** que abre un modal:

- **Si el envío es de última milla**: el modal solo te ofrece otros choferes como destino válido (no podés mandarlo a un vehículo inter-sucursal, no tendría sentido).
- **Si es inter-sucursal o devolución**: solo te ofrece vehículos.
- **En ambos casos**: tenés la opción "Marcar como sin asignar" como salida.

Si tu cambio excedería la capacidad del chofer/vehículo destino, el sistema te lo rechaza con un mensaje claro.

Si hiciste cambios y querés volver al plan original, tenés el botón **"Descartar cambios"** arriba.

## Cómo se aplica el plan

Tocá **"Aplicar plan"**. Lo que pasa:

1. Por cada envío del plan, el sistema valida que su estado actual sigue siendo válido (puede haber cambiado mientras vos editabas — ej. otro operador lo asignó manualmente).
2. **Última milla**: el envío pasa a `out_for_delivery` y se agrega a la ruta del chofer del día.
3. **Inter-sucursal**: el vehículo queda en estado `en_carga` con destino seteado. **El viaje no arranca todavía**.
4. Te muestra un resumen: **"X aplicados, Y fallidos"**. Cada fallo aparece con el motivo en español (ej. "El estado del envío cambió a loaded", "El vehículo cambió de estado y no está disponible").
5. Al cerrar el resumen, el plan se regenera con el estado actualizado.

## Cómo arrancar los viajes después

Aplicar el plan **no inicia los viajes** — solo deja todo cargado y listo. Cuando el chofer / vehículo está físicamente listo (combustible, conductor en planta, etc.), vas a **Flota** (`/vehicles`), seleccionás el vehículo y tocás **"Iniciar viaje"**. Como el destino ya quedó seteado por el plan, el modal te muestra solo una **confirmación** del destino (no tenés que volver a elegirlo) — solo confirmás y el viaje arranca.

## Cómo se manejan las devoluciones

Cuando un envío vuelve al remitente (porque el destinatario lo rechazó, no lo retiró del mostrador, o se canceló a mitad de viaje generando un contra-envío):

- El sistema **extiende su fecha estimada de entrega 10 días** automáticamente, para reflejar el viaje de regreso. La extensión queda en el historial del envío como un evento auditable.
- En el **plan de ruteo**, el envío aparece marcado con un badge naranja **"Devolución a remitente"** y se trata como inter-sucursal con destino la sucursal de **origen** del envío original (no la del destinatario fallido).
- Las devoluciones **no se asignan a choferes de última milla** — solo viajan en vehículos hasta llegar a su sucursal de origen, donde el operador local cierra el ciclo marcándolas como "devueltas" con DNI del remitente.

## Configuración (admin)

El admin puede ajustar los parámetros del algoritmo desde **Config. ruteo** (`/routing-config`):

| Parámetro | Default | Para qué sirve |
|---|---|---|
| Horizonte SLA (h) | 24 | Cuán cerca tiene que estar la fecha estimada para forzar despacho. Bajalo para ser más conservador, subilo para dejar más margen. |
| Umbral prioridad | 0.75 | Score sobre el cual se fuerza despacho. Bajalo para ser más permisivo. |
| Tasa mínima de carga | 40% | % del vehículo más grande que hay que llenar para consolidar. Subila para esperar más volumen, bajala para despachar más seguido. |
| Envíos máx. por chofer | 15 | Tope de cantidad por ruta de chofer. |
| Peso máx. por chofer (kg) | 150 | Tope de peso por ruta de chofer. |

Los cambios se aplican a partir del próximo plan generado. Los ya aplicados no se recalculan.

## Limitaciones a tener en cuenta

- **Un solo hop por defecto**: el algoritmo asume que un vehículo puede ir directo del origen al destino. Cuando geográficamente no es así (ej. CABA → Bariloche sin escala intermedia natural), la regla de piggyback es la que ayuda a encadenar tramos. Pero el operador siempre puede mover envíos a mano si conoce mejor la ruta real.
- **Capacidad por chofer es por número y peso, no por volumen ni distancia**: si tu operativa tiene zonas muy distantes que requieren rutas separadas, eso lo seguís decidiendo a mano.
- **No predice tráfico ni horarios**: el algoritmo asume que si un vehículo sale, llega. La estimación de tiempo de entrega usa distancia, no condiciones del tráfico.

## Resumen de lo nuevo en el sistema

| Cambio | Dónde lo ves |
|---|---|
| Pantalla "Ruteo" | Menú principal (operator + supervisor) |
| Pantalla "Config. ruteo" | Menú principal (admin) |
| Badge "Devolución a remitente" | Chips de envíos en /routing |
| Badge "Tránsito parcial → X" | Chips de envíos piggybackeados |
| Confirmación de destino al iniciar viaje | Modal de Iniciar viaje en /vehicles cuando viene del plan |
| Fecha estimada extendida +10 días | Detalle de envíos en retorno |
| Evento "ETA extendida" | Historial de eventos del envío |
