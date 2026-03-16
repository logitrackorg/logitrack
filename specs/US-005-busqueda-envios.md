# US-005 — Búsqueda de envíos

**Como** Operador
**Quiero** buscar envíos por destinatario (y otros campos)
**Para** encontrarlos sin necesidad de conocer el tracking ID

---

## Criterios de aceptación

1. Ingresar el nombre de un destinatario existente muestra todos sus envíos asociados.
2. La búsqueda acepta coincidencias parciales.
3. Ingresar un término que no tiene resultados muestra un mensaje de sin resultados.

> **Alcance real de la implementación**
> La búsqueda no se limita al nombre del destinatario. El motor busca en cinco campos simultáneamente, todos con coincidencia parcial e insensible a mayúsculas. Ver sección "Campos de búsqueda".

---

## Campos de búsqueda

| Campo                | Ejemplos válidos                         |
|----------------------|------------------------------------------|
| `tracking_id`        | `LT-90`, `LT-A1B2`                       |
| `recipient_name`     | `juan`, `García`                         |
| `sender_name`        | `maria`, `López`                         |
| `destination.city`   | `córdoba`, `rosario`                     |
| `origin.city`        | `buenos`, `mendoza`                      |

Un envío aparece en los resultados si el término ingresado es una subcadena (case-insensitive) de **cualquiera** de esos cinco campos.

---

## Reglas de negocio

1. La búsqueda se realiza en el servidor — `GET /api/v1/search?q={término}`.
2. Si `q` está vacío o en blanco, el servicio devuelve todos los envíos (equivalente a `GET /api/v1/shipments`).
3. Los resultados se ordenan por `tracking_id` ascendente.
4. El filtro de estado de la lista se aplica **sobre** los resultados de búsqueda en el cliente. Es posible buscar y filtrar por estado al mismo tiempo.
5. Solo roles no-driver pueden acceder al endpoint de búsqueda (`403 Forbidden` para drivers).

---

## Comportamiento del frontend

1. El campo de búsqueda está en la parte superior de la lista de envíos (`/`), con placeholder `"Search by tracking ID, sender, recipient or city..."`.
2. La búsqueda se dispara al hacer submit del formulario (botón "Search" o tecla Enter), no en tiempo real.
3. Mientras la petición está en curso, la lista muestra "Loading...".
4. Si no hay resultados, se muestra "No shipments found."
5. Cuando hay un término activo, aparece el botón **"Clear"** que limpia el campo y recarga todos los envíos.
6. El filtro de estado permanece activo al buscar — si se busca "juan" con filtro "Active", solo aparecen los envíos de Juan que no estén en `delivered`, `pending` ni `returned`.

---

## Escenarios

### CA1 — Búsqueda por nombre de destinatario completo

- **Dado** que existe un envío con `recipient_name: "Juan García"`
- **Cuando** el usuario hace `GET /search?q=Juan García`
- **Entonces** el envío aparece en los resultados

### CA2 — Búsqueda por nombre de destinatario parcial

- **Dado** que existen envíos con `recipient_name: "Juan García"` y `recipient_name: "Juan López"`
- **Cuando** el usuario busca `q=juan`
- **Entonces** ambos envíos aparecen en los resultados (insensible a mayúsculas)

### CA3 — Búsqueda por nombre de remitente

- **Dado** que existe un envío con `sender_name: "María Fernández"`
- **Cuando** el usuario busca `q=fernández`
- **Entonces** el envío aparece en los resultados

### CA4 — Búsqueda por ciudad de destino

- **Dado** que existen envíos con `destination.city: "Córdoba"`
- **Cuando** el usuario busca `q=córdoba`
- **Entonces** todos los envíos con destino Córdoba aparecen

### CA5 — Búsqueda por tracking ID parcial

- **Dado** que existe el envío `LT-A1B2C3D4`
- **Cuando** el usuario busca `q=A1B2`
- **Entonces** el envío aparece en los resultados

### CA6 — Búsqueda sin resultados

- **Dado** que ningún envío coincide con el término ingresado
- **Cuando** el usuario busca `q=zzznoresults`
- **Entonces** el servidor responde `200 OK` con lista vacía `[]`
- **Y** el frontend muestra "No shipments found."

### CA7 — Búsqueda vacía devuelve todos los envíos

- **Dado** que el usuario envía el formulario con el campo de búsqueda vacío
- **Cuando** se procesa el submit
- **Entonces** el frontend llama a `GET /api/v1/shipments` (no al endpoint de búsqueda)
- **Y** se muestran todos los envíos según el filtro de estado activo

### CA8 — Búsqueda combinada con filtro de estado

- **Dado** que el usuario busca `q=juan` con filtro de estado "Active"
- **Cuando** el frontend recibe los resultados de búsqueda
- **Entonces** solo se muestran los envíos de Juan que tienen un estado activo (excluye `delivered`, `pending`, `returned`)

### CA9 — Driver no puede acceder al endpoint de búsqueda

- **Dado** que el driver tiene un token válido
- **Cuando** hace `GET /api/v1/search?q=juan`
- **Entonces** responde `403 Forbidden`
