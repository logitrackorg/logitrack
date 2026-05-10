# Ruteo inteligente global — Explicación de negocio

## El problema que resuelve

Antes de esta funcionalidad, los operadores de cada sucursal tenían que entrar al sistema
y presionar "Generar plan" para ver sugerencias de despacho. Esto significaba:

- **Dependencia del operador**: si no lo hacía a tiempo, los envíos salían tarde o de forma
  desorganizada.
- **Vista fragmentada**: cada sucursal veía solo su propio contexto, sin visibilidad de lo
  que pasaba en el resto de la red.
- **Sin criterio de ventanas horarias**: los envíos con ventana "mañana" podían estar
  programados para la tarde sin que nadie lo notara.

---

## Qué hace el sistema ahora

### Generación automática a las 08:00

Todos los días a las 08:00 (hora Argentina), el sistema calcula automáticamente el plan de
ruteo para **todas las sucursales activas de la red**. Cuando el operador entra a la pantalla,
el plan ya está listo para revisar y aplicar.

El cálculo considera en un solo pasaje global:
- Todos los envíos pendientes (`at_hub`, `at_origin_hub`) en todas las sucursales.
- Todos los vehículos disponibles de toda la red.
- Todos los choferes disponibles en cada sucursal.

### El plan persiste en la base de datos

El plan no desaparece si se recarga la página ni si se cierra el navegador. Está guardado
hasta que se aplique o se genere uno nuevo. Esto permite que múltiples operadores (de la
misma sucursal) vean el mismo plan consistente.

---

## Cómo toma decisiones el algoritmo

### Última milla (entregas locales)

Para envíos que ya llegaron a su sucursal final y deben ser entregados a domicilio:

1. **Ordena** los envíos por ventana horaria (`mañana → tarde → flexible`), luego por
   prioridad (`alta → media → baja`), luego por fecha de creación. La ventana es lo
   primero porque es un compromiso contractual con el destinatario (y puede tener
   recargo); la prioridad ordena dentro de la misma ventana.
2. **Distribuye** entre los choferes disponibles, balanceando la carga por peso total.
3. **Respeta topes**: máximo de envíos por chofer y máximo de kg por chofer (configurables).
4. **Respeta ventanas horarias**: calcula la hora estimada de llegada a cada parada y verifica
   que caiga dentro de la ventana pedida (mañana 08:00–14:00, tarde 12:00–18:00).
5. **Inserta los flexibles**: los envíos sin ventana específica se colocan donde el desvío
   de distancia sea mínimo, sin perjudicar a los que sí tienen ventana.

### Inter-sucursal (transferencias entre hubs)

Para envíos que deben viajar de una sucursal a otra:

1. **Agrupa** los envíos por (sucursal de origen, sucursal de destino).
2. **Evalúa dos reglas** para decidir si despachar hoy:
   - **SLA crítico**: algún envío del grupo vence en menos de N horas (configurable, default 24h)
     o tiene prioridad muy alta (score ≥ 0.75).
   - **Consolidación**: el peso total del grupo supera el X% de la capacidad del vehículo más
     grande disponible (configurable, default 40%).
3. **Elige el vehículo** más pequeño que cubre el peso. Si ninguno alcanza, usa el más grande
   y deja el excedente sin asignar.
4. **Piggyback**: los envíos que no consiguieron despacho propio "se suben" a despachos ya
   armados si ese vehículo los acerca a su destino final (reduce distancia restante).

### Transparencia: por qué se tomó cada decisión

Cada item del plan muestra el motivo de la asignación:
- `SLA crítico`: el envío vencía en X horas.
- `Consolidación`: el grupo alcanzó el X% de capacidad del vehículo.
- `Piggyback`: el vehículo lo acercó Y km a su destino.
- `Esperando consolidación`: aún no hay suficiente carga — se muestra cuánto falta.

---

## Ventanas horarias de entrega

### El concepto

Un cliente puede pedir que su envío llegue "por la mañana" o "por la tarde". El sistema
respeta esa restricción al armar la ruta del chofer.

Las ventanas configurables son:
- **Mañana**: 08:00 – 14:00 (se solapan con la tarde — refleja la realidad operativa argentina).
- **Tarde**: 12:00 – 18:00
- **Flexible**: sin restricción horaria.

### Modo duro vs modo blando

El admin puede elegir qué pasa cuando un envío no puede entrar en su ventana:

| Modo | Comportamiento | Cuándo usarlo |
|---|---|---|
| **Duro** (default) | El envío no sale en la ruta de hoy. Queda "sin asignar" con el motivo. | Cuando el cliente pagó un extra por la ventana (típico en express con `time_window_multiplier`). |
| **Blando** | Sale en la ruta con un aviso naranja. El operador decide si lo saca o lo deja. | Cuando la ventana es orientativa y el cliente puede aceptar una pequeña demora. |

---

## Roles y visibilidad

| Rol | Qué ve | Qué puede hacer |
|---|---|---|
| **Operador / Supervisor** | Solo los items de su propia sucursal. | Editar y aplicar el plan de su sucursal. |
| **Manager** | Métricas globales (asignados, sin asignar, todas las sucursales). | Regenerar el plan del día. |
| **Admin** | Igual que manager. | Regenerar el plan + editar la configuración. |

---

## Flujo operativo típico de un día

```
08:00  Sistema genera el plan automáticamente.
       ↓
08:05  Operador de CABA entra a /ruteo.
       Ve el plan: 6 envíos para chofer_caba, 5 envíos para despacho a Córdoba.
       Ajusta: arrastra un envío del chofer A al chofer B porque A ya tiene mucha carga.
       ↓
08:15  Hace clic en "Aplicar plan".
       Los 6 envíos pasan a out_for_delivery, la ruta del chofer se arma.
       El camión a Córdoba queda en en_carga, listo para que el supervisor haga Start Trip.
       ↓
10:00  Llegan 3 envíos nuevos a CABA que no estaban en el plan original.
       Manager regenera el plan desde /ruteo → aparecen los 3 nuevos en "Sin asignar"
       porque no hay consolidación suficiente para Córdoba.
       Operador los asigna manualmente a un vehículo que ya estaba cargando parcialmente.
```

---

## Métricas de negocio que habilita esta feature

| Métrica | Cómo se obtiene |
|---|---|
| % de envíos ruteados automáticamente vs manual | `total_assigned / total_candidates` en el log del plan. |
| Envíos bloqueados por ventana horaria | Razón `ventana_horaria_inviable` en la lista "Sin asignar". |
| Tasa de consolidación inter-sucursal | Dispatches con regla `consolidation` vs `sla_forced`. |
| Cobertura del plan | Si el plan cubre todas las sucursales activas o algunas fallaron. |

---

## Limitaciones del MVP actual

| Limitación | Impacto | Iteración futura |
|---|---|---|
| Los vehículos inter-sucursal solo se asignan desde la sucursal donde están asignados, no desde toda la red. | Un camión en CABA no puede ser propuesto para un despacho desde Córdoba. | Optimización cross-branch con costo de "deadhead" (viaje vacío para reposicionarse). |
| El plan multi-hop (Bariloche → Córdoba → Posadas) se resuelve de a un salto por día. | Un envío de 3 hops tarda 3 días en ser planeado de punta a punta. | Ya funciona via piggyback; la mejora es planificar la cadena completa de antemano. |
| La regeneración sobreescribe el plan existente. Si ya se aplicó parte, el nuevo plan no deshace lo aplicado. | El operador puede confundirse si aplica y después regenera. | Agregar un estado "parcialmente aplicado" y mostrar qué ya está ejecutado. |
