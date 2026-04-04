# US-074 — Exportar listado de envíos a CSV

**Estado:** Implementada

## Actor principal
Admin y gerente (`admin`, `manager`). El botón no es visible para otros roles.

## Descripción
Desde el listado de envíos, los usuarios con rol admin o gerente pueden descargar un archivo CSV con los envíos actualmente visibles, respetando todos los filtros activos (estado, sucursal, rango de fechas, búsqueda por texto). El principio es *"lo que ves es lo que exportás"*.

---

## Columnas del CSV

| Columna | Fuente |
|---------|--------|
| Tracking ID | `tracking_id` (vacío si es borrador) |
| Status | `status` |
| Priority | `priority` |
| Origin City | `corrections.origin_city` o `sender.address.city` |
| Origin Province | `sender.address.province` |
| Destination City | `corrections.destination_city` o `recipient.address.city` |
| Destination Province | `recipient.address.province` |
| Receiving Branch | nombre + ciudad de la sucursal (`receiving_branch_id`) |
| Shipment Type | `shipment_type` |
| Weight (kg) | `corrections.weight_kg` o `weight_kg` |
| Current Location | `current_location` |
| Created | `created_at` (formato DD/MM/AAAA) |
| Est. Delivery | `estimated_delivery_at` (formato DD/MM/AAAA) |

Los campos con correcciones usan el valor corregido cuando existe.

> Sender y Recipient (nombre) se excluyen deliberadamente por ser datos personales sensibles (Ley 25.326). El CSV no contiene DNI, email, teléfono ni dirección completa.

---

## Reglas de negocio

1. Solo los roles `admin` y `manager` ven el botón "Export CSV".
2. El export es **client-side**: opera sobre los datos ya filtrados en memoria, sin llamadas adicionales a la API.
3. El archivo se nombra `shipments_YYYY-MM-DD.csv` usando la fecha local del usuario.
4. Los valores que contengan comas, comillas o saltos de línea se encierran entre comillas dobles (RFC 4180).
5. Si no hay resultados con los filtros activos, el CSV se descarga igualmente con solo los encabezados.

---

## Escenarios

### CA01 — Exportar con filtros activos

**Dado** que el usuario tiene rol admin o manager
**Y** hay filtros aplicados (ej: estado = "At Branch", sucursal = "CORD-01")
**Cuando** hace clic en "Export CSV"
**Entonces** se descarga un archivo con exactamente los envíos visibles en pantalla
**Y** las columnas contienen los valores corregidos cuando aplica

---

### CA02 — Botón no visible para otros roles

**Dado** que el usuario tiene rol operator, supervisor o driver
**Entonces** el botón "Export CSV" no aparece en la interfaz

---

### CA03 — Valores con correcciones

**Dado** que un envío tiene una corrección sobre `sender_name`
**Cuando** se exporta el CSV
**Entonces** la columna Sender muestra el valor corregido, no el original

---

### CA04 — Nombre del archivo

**Cuando** el usuario descarga el CSV el día 2026-04-04
**Entonces** el archivo se llama `shipments_2026-04-04.csv`
