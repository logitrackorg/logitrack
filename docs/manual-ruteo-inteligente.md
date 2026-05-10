# Ruteo inteligente — Manual de usuario

## ¿Qué es el plan de ruteo?

Todos los días a las **08:00** el sistema genera automáticamente un plan de despacho para toda la
red. Cuando entrás a `/ruteo`, el plan ya está listo: no tenés que generarlo vos.

El plan decide:
- **Última milla**: qué envíos sale a entregar cada chofer hoy.
- **Inter-sucursal**: qué vehículo lleva qué envíos a qué sucursal destino.
- **Sin asignar**: envíos que quedan para otro día, con el motivo explicado.

---

## Pantalla de ruteo (`/ruteo`)

### Si hay plan generado

La pantalla muestra tres secciones:

| Sección | Qué muestra |
|---|---|
| **Última milla** | Una card por chofer con sus envíos ordenados, hora estimada por parada y peso total. |
| **Inter-sucursal** | Una card por vehículo con los envíos que va a llevar, destino y regla de despacho. |
| **Sin asignar** | Envíos que el algoritmo no pudo rutear hoy, con el motivo. |

El encabezado muestra cuándo se generó el plan y el resumen global (asignados / sin asignar).

### Si no hay plan todavía

Si el servidor estaba caído a las 08:00 o es un día sin actividad previa, la pantalla muestra:

> *"El plan del día aún no fue generado. Se genera automáticamente a las 08:00."*

Un manager o admin puede generarlo manualmente con el botón **Generar plan ahora**.

---

## Entender las cards de última milla

Cada card de chofer muestra:

- **Nombre del chofer** y total de envíos + kg nuevos.
- **Carga preexistente** (si el chofer ya tenía envíos en su ruta del día anterior).
- **Secuencia de paradas** numeradas con hora estimada de llegada.

### Badges en cada parada

| Badge | Significado |
|---|---|
| `🕐 09:45` | Hora estimada de llegada a esa dirección. |
| `Mañana` / `Tarde` / `Flexible` | Ventana horaria pedida por el destinatario. |
| `Sin coordenadas` | El envío no tiene dirección geolocalizada; el chofer lo atiende al final de la ruta. |
| `Asignado manualmente` | El operador lo movió de lugar con drag-and-drop. |
| `⚠ Fuera de ventana (+45 min)` | El envío llegará tarde a su ventana. Solo aparece cuando las ventanas están en **modo blando** (ver más abajo). |

---

## Ventanas horarias: modo duro vs modo blando

El admin configura si las ventanas son **duras** o **blandas** desde `/admin/config-ruteo`.

| Modo | Qué pasa con un envío fuera de ventana |
|---|---|
| **Duro** (default) | Queda en "Sin asignar" con motivo `ventana_horaria_inviable`. No sale en la ruta. |
| **Blando** | Sale en la ruta del chofer con el badge naranja `⚠ Fuera de ventana`. Vos decidís si lo sacás. |

### Cómo sacar un envío en modo blando

Si ves el badge naranja y querés sacarlo de la ruta:
1. Hacé **drag** del chip del envío desde la card del chofer.
2. Soltalo en la zona **Sin asignar** (aparece resaltada en azul mientras arrastrás).
3. El envío queda sin asignar por hoy y el cron lo reevalúa mañana a las 08:00.

---

## Editar el plan antes de aplicar

El plan que ves es una **sugerencia**. Podés ajustarlo con drag-and-drop antes de aplicar.

### Mover envíos entre choferes

1. Agarrá el chip del envío desde la card de un chofer.
2. Soltalo en la card de otro chofer.
3. El sistema valida capacidad y muestra un error si el chofer está al tope.

### Mover envíos entre vehículos

1. Agarrá el chip desde la card del vehículo.
2. Soltalo en otro vehículo.
3. Se valida que el peso total no exceda la capacidad del vehículo destino.

### Envíos de "Sin asignar" a chofer o vehículo

1. Agarrá el chip desde la lista "Sin asignar".
2. Soltalo en la card del chofer (si es última milla) o del vehículo (si es inter-sucursal).

### Descartar cambios

Si editaste y querés volver al plan original: botón **Descartar cambios** en el encabezado.

---

## Aplicar el plan

Una vez que el plan está como querés:

1. Clic en **Aplicar plan**.
2. El sistema procesa ítem por ítem. Si alguno tuvo un cambio de estado entre que se generó y se aplicó (drift), ese ítem falla y te muestra el motivo. El resto se aplica igual.
3. Al cerrar el resumen, la pantalla recarga el plan actualizado.

### Después de aplicar

- Los envíos de última milla pasan a `out_for_delivery` y aparecen en la ruta del chofer.
- Los envíos inter-sucursal pasan a `loaded` y el vehículo queda en `en_carga`.
- Los envíos que fallaron por drift quedan en su estado anterior — podés reasignarlos manualmente.

---

## Regenerar el plan (manager / admin)

Si necesitás volver a calcular el plan del día (por ejemplo, llegaron muchos envíos nuevos):

1. Hacé clic en **Regenerar plan** (visible solo para manager y admin).
2. El sistema recalcula usando los envíos y vehículos disponibles en ese momento.
3. **Importante**: si ya aplicaste parte del plan, el nuevo plan no deshace lo que ya se procesó —
   solo recalcula los envíos que todavía están pendientes.

---

## Configuración de ruteo (`/admin/config-ruteo`) — Admin

| Campo | Qué controla | Default |
|---|---|---|
| Horizonte SLA (h) | Si un envío vence en menos de N horas, fuerza despacho aunque el vehículo esté vacío. | 24 h |
| Umbral de prioridad | Si el score de prioridad supera este valor, fuerza despacho. | 0.75 |
| Tasa mínima de carga | % de capacidad del camión más grande que debe llenarse para consolidar. | 40% |
| Envíos máx. por chofer | Tope de nuevos envíos por chofer en última milla. | 15 |
| Peso máx. por chofer (kg) | Tope de peso total acumulable por chofer. | 150 kg |
| **Ventanas duras / blandas** | Si está activo: los envíos fuera de ventana no salen en ruta. Si no: salen con aviso. | Duras (activo) |
| Inicio / fin ventana mañana | Rango horario de entregas "mañana". | 08:00 – 14:00 |
| Inicio / fin ventana tarde | Rango horario de entregas "tarde". | 12:00 – 18:00 |
| Tiempo de servicio (min) | Minutos estimados por entrega (estacionar, entregar, firmar). | 10 min |
| Velocidad promedio (km/h) | Velocidad usada para estimar tiempos cuando no hay GPS en ruta. | 25 km/h |

---

## Preguntas frecuentes

**¿A qué hora se genera el plan?**
A las 08:00, hora de Argentina. Si el servidor estaba caído, el plan no se genera —
pedile a un manager que lo genere manualmente.

**¿Por qué un envío aparece en "Sin asignar"?**
El motivo está en la card. Los más comunes:
- `Esperando consolidación`: hay pocos kilos para ese destino. Si llegan más envíos o
  cambia la config, se despacha.
- `Ventana horaria inviable`: el envío no puede llegar a tiempo (modo duro).
- `Sin choferes disponibles`: todos los choferes de la sucursal ya iniciaron su ruta.
- `Sin vehículos disponibles`: no hay vehículos en estado disponible en la sucursal.

**¿Puedo aplicar el plan dos veces?**
Sí, pero el segundo apply solo procesa lo que todavía está pendiente. Lo que ya fue aplicado
no se modifica.

**¿Qué pasa si edito el plan y después lo aplico?**
Si editaste (hay cambios), el sistema envía tu versión editada. Si no editaste, lee la
versión guardada en el servidor.
