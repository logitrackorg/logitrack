# US-004 — Búsqueda por tracking ID

**Estado:** Implementada

## Actor principal
Todos los roles autenticados (excepto driver, que no tiene acceso al listado).

## Descripción
La barra de búsqueda del listado de envíos acepta texto libre y busca por tracking ID (entre otros campos). Soporta coincidencias parciales y es case-insensitive.

---

## Alcance de la búsqueda

El endpoint `GET /search?q=<texto>` busca coincidencias parciales (`strings.Contains`) en:
- Tracking ID
- Nombre del remitente
- Nombre del destinatario
- Ciudad de origen
- Ciudad de destino

---

## Reglas de negocio

1. La búsqueda es case-insensitive: `"lt-a1b2"` encuentra `"LT-A1B2C3D4"`.
2. Coincidencia parcial: `"A1B2"` encuentra `"LT-A1B2C3D4"`.
3. Si no hay resultados, el frontend muestra `"No shipments found."`.
4. Si el campo de búsqueda está vacío al hacer submit, se llama a `GET /shipments` (listado completo) en lugar de `/search`.
5. El filtro de estado se sigue aplicando client-side sobre los resultados de búsqueda.
6. El botón "Clear" vacía el query y recarga el listado completo.
7. La búsqueda no acepta parámetros de fecha (`date_from`/`date_to`) — usa el endpoint `/search`, no `/shipments`.

---

## Escenarios

### CA01 — Tracking ID existente muestra el envío

**Dado** que existe el envío `LT-A1B2C3D4`
**Cuando** el operador escribe `LT-A1B2C3D4` y hace clic en "Search"
**Entonces** la tabla muestra ese envío

---

### CA02 — Tracking ID inexistente muestra sin resultados

**Dado** que no existe ningún envío con tracking ID `LT-ZZZZZZZZ`
**Cuando** el operador busca `LT-ZZZZZZZZ`
**Entonces** la tabla muestra `"No shipments found."`

---

### CA03 — Coincidencia parcial

**Dado** que existe el envío `LT-A1B2C3D4`
**Cuando** el operador escribe `A1B2`
**Entonces** la tabla muestra `LT-A1B2C3D4` (y cualquier otro envío cuyo ID contenga `A1B2`)

---

### CA04 — Búsqueda case-insensitive

**Cuando** el operador escribe `lt-a1b2`
**Entonces** se encuentran los envíos que contienen `LT-A1B2` en su tracking ID

---

### CA05 — Búsqueda vacía recarga el listado

**Dado** que hay una búsqueda activa
**Cuando** el operador borra el texto y hace submit, o hace clic en "Clear"
**Entonces** se muestra el listado completo (con los filtros de fecha/estado activos)
