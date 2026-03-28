# US-007 — Filtrado por fecha

**Como** Supervisor
**Quiero** filtrar envíos por fecha de creación
**Para** acotar los resultados a un período específico

---

## Criterios de aceptación

1. Aplicar un rango de fechas muestra solo los envíos creados en ese período (inclusive en ambos extremos).
2. Si no hay envíos en el rango, el sistema muestra un mensaje de sin resultados.

**Estado:** Implementada. El frontend tiene inputs de tipo `date` en la lista de envíos. El filtrado de fechas se realiza **client-side** para evitar problemas de zona horaria (ver Nota abajo).

---

## Reglas de negocio

1. El filtro aplica sobre el campo `created_at` del envío.
2. El rango es inclusivo: un envío creado exactamente en `date_from` o `date_to` debe aparecer.
3. Ambos extremos del rango son opcionales:
   - Solo `date_from`: envíos desde esa fecha hasta hoy.
   - Solo `date_to`: envíos hasta esa fecha (sin límite inferior).
   - Ambos: envíos dentro del rango.
   - Ninguno: todos los envíos (comportamiento actual).
4. El filtro por fecha es combinable con el filtro por estado y con la búsqueda por texto.
5. Los resultados se ordenan por `tracking_id` ascendente (consistente con el resto de la lista).
6. Si `date_to` es anterior a `date_from`, el filtro de fecha se deshabilita temporalmente, se muestra un mensaje de error y el campo `date_to` se resalta en rojo.

> **Nota de implementación — Zona horaria**: el filtrado de fechas se realiza en el frontend sobre el array de envíos ya cargado en memoria. El campo `created_at` es un timestamp UTC; la comparación se hace extrayendo la fecha local del usuario (`YYYY-MM-DD` en la zona horaria del navegador) en vez de enviar los parámetros al backend. Esto evita que envíos creados pasada la medianoche UTC pero antes de la medianoche local aparezcan en el día incorrecto.

---

## Comportamiento del frontend

1. En la lista de envíos (`/`), hay dos inputs de tipo `date` (From / To) junto al filtro de estado.
2. El filtro de fecha se aplica client-side sobre el array de envíos ya cargado; no dispara una nueva llamada a la API.
3. Si no hay resultados, se muestra "No shipments found."
4. El filtro de fecha coexiste con el filtro de estado (también client-side) y con la búsqueda por texto.
5. Cuando hay búsqueda activa, las fechas son ignoradas (la búsqueda usa `/search` y el resultado reemplaza la lista).
6. Si `date_to < date_from`, el campo `date_to` muestra borde rojo y aparece el mensaje `"To" date must be after "From"`. El filtro de fecha no se aplica hasta corregir el error.
7. Un botón "Clear dates" permite limpiar ambos campos a la vez.

---

## Escenarios

### CA1 — Filtro por rango con resultados

- **Dado** que existen envíos creados el 2026-03-01, 2026-03-15 y 2026-04-10
- **Cuando** el supervisor filtra con `date_from=2026-03-01&date_to=2026-03-31`
- **Entonces** solo aparecen los envíos del 1 y 15 de marzo

### CA2 — Rango inclusivo en los extremos

- **Dado** que existe un envío creado exactamente el 2026-03-01 a las 00:00:00 UTC
- **Cuando** el supervisor filtra con `date_from=2026-03-01`
- **Entonces** ese envío aparece en los resultados

### CA3 — Filtro sin resultados

- **Dado** que no hay envíos creados entre 2020-01-01 y 2020-12-31
- **Cuando** el supervisor filtra con ese rango
- **Entonces** el servidor responde `200 OK` con lista vacía `[]`
- **Y** el frontend muestra "No shipments found."

### CA4 — Solo date_from

- **Dado** que el supervisor ingresa solo `date_from=2026-03-15`
- **Cuando** se aplica el filtro
- **Entonces** aparecen todos los envíos creados desde el 15 de marzo en adelante

### CA5 — Solo date_to

- **Dado** que el supervisor ingresa solo `date_to=2026-02-28`
- **Cuando** se aplica el filtro
- **Entonces** aparecen todos los envíos creados hasta el 28 de febrero

### CA6 — Filtro combinado: fecha + estado

- **Dado** que el supervisor filtra con `date_from=2026-03-01` y estado `in_transit`
- **Cuando** se aplica el filtro
- **Entonces** solo aparecen envíos creados desde el 1 de marzo que están actualmente en tránsito

### CA7 — Fecha inválida en el input

- **Dado** que el usuario ingresa un valor no válido en el input de fecha
- **Cuando** el navegador no puede parsear la fecha
- **Entonces** el input no actualiza el estado y no se aplica ningún filtro

### CA8 — Rango invertido (To antes que From)

- **Dado** que el usuario ingresa `From = 2026-03-15` y `To = 2026-03-10`
- **Entonces** el campo `To` muestra borde rojo
- **Y** aparece el mensaje `"To" date must be after "From"`
- **Y** el filtro de fecha no se aplica (se muestran todos los envíos del período)
- **Y** al corregir `To` a `2026-03-20` el error desaparece y el filtro se aplica normalmente

### CA9 — Corrección de zona horaria

- **Dado** que existe un envío creado el `2026-03-20T02:00:00Z` (que en UTC-3 es el `19/03`)
- **Cuando** el usuario en UTC-3 filtra con `From = 2026-03-20`
- **Entonces** ese envío **no aparece** (su fecha local es 19/03, antes del filtro)
- **Y** si el usuario filtra con `From = 2026-03-19`
- **Entonces** ese envío **sí aparece**
