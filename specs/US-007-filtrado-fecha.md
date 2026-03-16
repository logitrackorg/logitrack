# US-007 — Filtrado por fecha

**Como** Supervisor
**Quiero** filtrar envíos por fecha de creación
**Para** acotar los resultados a un período específico

---

## Criterios de aceptación

1. Aplicar un rango de fechas muestra solo los envíos creados en ese período (inclusive en ambos extremos).
2. Si no hay envíos en el rango, el sistema muestra un mensaje de sin resultados.

> **Estado de implementación**
> Esta funcionalidad **no está implementada**. El backend no acepta parámetros de fecha en ningún endpoint, y el frontend no tiene controles de rango de fechas. La spec define el comportamiento esperado para cuando se implemente.

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

---

## Diseño del endpoint

El filtro de fecha debe incorporarse como query params en `GET /api/v1/shipments`:

```
GET /api/v1/shipments?date_from=2026-01-01&date_to=2026-03-31
```

| Parámetro   | Tipo   | Formato      | Notas        |
|-------------|--------|--------------|--------------|
| `date_from` | string | `YYYY-MM-DD` | Opcional     |
| `date_to`   | string | `YYYY-MM-DD` | Opcional     |

> Alternativa: incorporar como params de `/search` para unificar el flujo. A definir en implementación.

---

## Comportamiento del frontend esperado

1. En la lista de envíos (`/`), agregar dos inputs de tipo `date` (desde / hasta) junto al filtro de estado.
2. Al cambiar cualquiera de los dos campos, re-ejecutar la carga con los parámetros actualizados.
3. Si no hay resultados, mostrar "No shipments found."
4. Un botón "Clear" o equivalente limpia el rango y vuelve a cargar sin filtro de fecha.
5. El filtro de fecha coexiste con el filtro de estado y la búsqueda por texto.

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

### CA7 — Fecha inválida

- **Dado** que se envía `date_from=not-a-date`
- **Cuando** el servidor procesa la petición
- **Entonces** responde `400 Bad Request` indicando formato de fecha inválido
