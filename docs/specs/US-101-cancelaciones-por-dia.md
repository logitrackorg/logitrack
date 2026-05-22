# US-101 — Cancelaciones por día

**Como** Gerente
**Quiero** ver la cantidad de envíos cancelados por día
**Para** detectar anomalías o problemas en la operación

---

## Criterios de aceptación

1. Muestra un gráfico de línea con la evolución diaria de cancelaciones.
2. Muestra el motivo de cancelación más frecuente del período.
3. Permite filtrar por sucursal y período (date_from / date_to).
4. Los datos se cargan desde el backend consultando los eventos de cancelación.

---

## Dependencias

- **Endpoint `GET /api/v1/shipments/stats/cancellations`**: Devuelve cancelaciones agrupadas por día y por motivo.
- **US-100 — Dashboard Gerencial**: Define la navegación entre reportes.

---

## Modelo de datos

### Request — `GET /api/v1/stats/cancellations`

| Parámetro    | Tipo   | Obligatorio | Default        | Descripción                     |
|-------------|--------|-------------|----------------|----------------------------------|
| `date_from` | string | No          | 30 días atrás  | Inicio del período (YYYY-MM-DD) |
| `date_to`   | string | No          | Hoy            | Fin del período (YYYY-MM-DD)    |
| `branch_id` | string | No          | Todas          | Filtrar por sucursal            |

### Response — `200 OK`

```json
{
  "by_day": {
    "2026-04-01": 3,
    "2026-04-02": 1
  },
  "total": 4,
  "top_reason": "Cliente solicitó cancelación",
  "reasons_breakdown": {
    "Cliente solicitó cancelación": 3,
    "Error en dirección": 1
  }
}
```

---

## Diseño de UI

### Ruta

`/cancelaciones` — página independiente dentro del panel de reportes.

### Componentes

- **Line chart** con Recharts (mismo estilo que el dashboard).
- **Summary card** con total de cancelaciones y motivo más frecuente.
- **Period filter** (date_from / date_to) y **branch filter**.

---

## Escenarios

### Escenario feliz — datos disponibles

**Dado** que el usuario es gerente
**Cuando** accede a `/cancelaciones`
**Entonces** ve un gráfico de línea con la evolución diaria
**Y** ve "Total cancelaciones: N" y "Motivo más frecuente: X"

### Escenario vacío — sin cancelaciones

**Dado** que el usuario es gerente
**Cuando** filtra por un período sin cancelaciones
**Entonces** ve "No hay cancelaciones registradas en el período seleccionado"

### Escenario sin permisos

**Dado** que el usuario es operador
**Cuando** intenta acceder a `/cancelaciones`
**Entonces** no ve la opción en la navegación (solo visible para supervisor+manager)
