# US-008 — Filtrado por estado

**Estado:** Implementada

## Actor principal
Todos los roles autenticados excepto driver (el listado de envíos no es accesible para drivers).

## Descripción
El listado de envíos tiene un selector de estado que filtra los resultados mostrados. El filtro por estado se aplica en el frontend sobre los resultados ya obtenidos del backend, lo que permite combinarlo con el filtro por fecha sin una segunda llamada a la API.

---

## Opciones de filtro disponibles

| Valor | Etiqueta | Comportamiento |
|---|---|---|
| `active` | Active | Excluye `pending`, `delivered`, `returned`, `cancelled`. Es el **filtro por defecto**. |
| `` (vacío) | All | Muestra todos los envíos sin filtrar por estado. |
| `pending` | Draft | Solo borradores |
| `in_progress` | In Progress | |
| `in_transit` | In Transit | |
| `at_branch` | At Branch | |
| `delivering` | Delivering | |
| `delivery_failed` | Delivery Failed | |
| `delivered` | Delivered | |
| `ready_for_pickup` | Ready for Pickup | |
| `ready_for_return` | Ready for Return | |
| `returned` | Returned | |
| `cancelled` | Cancelled | Solo envíos cancelados |

---

## Reglas de negocio

1. El filtro por estado es **client-side**: se aplica sobre el array de envíos ya cargado en memoria.
2. El filtro por fecha es también **client-side**: se aplica sobre `created_at` usando la fecha local del usuario (no query params al backend). Ver US-007 para la justificación de zona horaria.
3. Ambos filtros son **aditivos** y se aplican simultáneamente sobre la lista en memoria.
4. Al cargar la página, si existe el query param `?status=<valor>` en la URL, el filtro se inicializa con ese valor (ej: `/?status=pending` pre-selecciona "Draft"). El valor persiste en `sessionStorage`.
5. El filtro por defecto es `active` (excluye terminales `delivered`, `returned` y `cancelled`, y borradores `pending`).
6. Cuando hay una búsqueda por texto activa, la fecha es ignorada (la búsqueda usa un endpoint distinto); el filtro de estado sigue siendo aplicable.

---

## Escenarios

### CA01 — Filtrar por un estado específico

**Dado** que hay envíos en distintos estados
**Y** el usuario selecciona "In Transit" en el selector
**Entonces** la tabla muestra únicamente los envíos con `status: "in_transit"`
**Y** el contador de resultados refleja solo esos envíos

---

### CA02 — Filtro por estado combinado con filtro por fecha

**Dado** que el usuario seleccionó `date_from = 2026-03-19` y `date_to = 2026-03-21`
**Y** el backend devolvió los envíos creados en ese rango
**Cuando** el usuario selecciona el estado "At Branch"
**Entonces** la tabla muestra únicamente los envíos de ese rango de fechas que además están en `at_branch`
**Y** no se realiza una nueva llamada a la API (el filtro es client-side)

---

### CA03 — Filtro "Active" excluye terminales, borradores y cancelados

**Dado** que el filtro activo es "Active" (por defecto)
**Entonces** no se muestran envíos en estado `pending`, `delivered`, `returned` ni `cancelled`
**Y** sí se muestran envíos en cualquier estado intermedio (`in_progress`, `in_transit`, `at_branch`, `delivering`, `delivery_failed`, `ready_for_pickup`, `ready_for_return`)

---

### CA04 — Filtro "All" muestra todos

**Cuando** el usuario selecciona "All"
**Entonces** se muestran todos los envíos del período (o todos sin filtro de fecha si no hay fechas aplicadas)

---

### CA05 — Pre-selección por URL

**Dado** que el usuario navega a `/?status=pending`
**Entonces** el selector se inicializa en "Draft"
**Y** solo se muestran borradores (ej: tras confirmar un draft se redirige a `/?status=pending`)
