# US-080 — Precio del envío

## Contexto

Cada envío tiene un **precio** calculado de forma determinística a partir de un tarifario editable. El precio se fija una sola vez (en la creación o confirmación del borrador) y queda **inmutable**: las correcciones posteriores nunca lo alteran.

Para garantizar la inmutabilidad, los campos que entran al cálculo del precio quedan **lockeados** después de la confirmación: `weight_kg`, `package_type`, `is_fragile`, `shipment_type`. La `time_window` sí es corregible pero solo en sentido **descendente** (a una opción de igual o menor recargo).

## Modelo

### `Shipment` (campos nuevos)

| Campo | Tipo | Descripción |
|---|---|---|
| `price` | `*float64` | Total cobrado al confirmar el envío. `null` para borradores y envíos legacy. |
| `price_breakdown` | `*PriceBreakdown` | Desglose por componente para auditoría. |
| `price_currency` | `string` | Default `"ARS"`. |

### `PricingConfig` (singleton, tabla `pricing_config` id=1)

| Campo | Default | Descripción |
|---|---|---|
| `base_fare` | 1500 | Tarifa base en ARS. |
| `cost_per_km` | 25 | $/km. |
| `weight_surcharge_mid` | 500 | Recargo si `5 < weight_kg ≤ 25`. |
| `weight_surcharge_high` | 1500 | Recargo si `weight_kg > 25`. |
| `package_envelope_multiplier` | 0.7 | × subtotal cuando `package_type=envelope`. |
| `package_box_multiplier` | 1.0 | × subtotal cuando `package_type=box`. |
| `shipment_express_multiplier` | 1.5 | × subtotal cuando `shipment_type=express`. |
| `time_window_restrictive_surcharge` | 0.10 | +10% al subtotal cuando ventana es `morning` o `afternoon`. |
| `fragile_surcharge` | 0.20 | +20% al subtotal cuando `is_fragile=true`. |

## Fórmula

```
distance_km        = Haversine(origen, destino)   // fallback a provincias si faltan coords
distance_cost      = cost_per_km × distance_km
package_mult       = 0.7 (envelope) | 1.0 (box)
shipment_mult      = 1.5 (express) | 1.0 (normal)
weight_surcharge   = 0 si peso ≤ 5
                   = weight_surcharge_mid si 5 < peso ≤ 25
                   = weight_surcharge_high si peso > 25
subtotal           = (base_fare + distance_cost) × package_mult × shipment_mult + weight_surcharge
time_window_rate   = 0.10 si ventana ∈ {morning, afternoon}, 0 si flexible
fragile_rate       = 0.20 si is_fragile, 0 sino
total              = subtotal + subtotal × time_window_rate + subtotal × fragile_rate
```

## Reglas

- El precio se computa en `Create` y `ConfirmDraft`.
- Los borradores **no** tienen precio (campo `null`).
- Las correcciones **no** recalculan el precio. El precio cobrado es un dato contable inmutable.
- Los siguientes campos quedan no editables después de la confirmación:
  - `weight_kg`
  - `package_type`
  - `is_fragile`
  - `shipment_type`
- `time_window` se puede corregir solo si el recargo de la nueva ventana es ≤ al actual:
  - ✅ `morning ↔ afternoon` (mismo recargo)
  - ✅ `morning|afternoon → flexible`
  - ❌ `flexible → morning|afternoon` (subiría el precio comprometido)

## Endpoints

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| POST | `/api/v1/pricing/quote` | operator, supervisor | Cotización sin persistir. Usado por el form de Nuevo envío. |
| GET | `/api/v1/pricing/config` | admin | Devuelve la configuración activa. |
| PATCH | `/api/v1/pricing/config` | admin | Actualiza la configuración. Validaciones: importes ≥ 0, multiplicador express ≥ 1. |

> **Admin no participa en operaciones de envío.** No cotiza, no crea envíos, no ve listas ni detalles. Solo edita el tarifario desde `/pricing-config`.

## Visibilidad

- En `ShipmentDetail`: visible para operator, supervisor, manager y driver.
- En `/track` (público): **no** se muestra.
- En `NewShipment`: cotización en vivo con debounce de 400 ms cuando hay datos mínimos (peso, tipo de paquete, provincias).

## Escenarios

### CA-01 — Crear envío inicializa el precio

**Dado** un operador o supervisor autenticado en CABA
**Cuando** crea un envío con `weight_kg=3`, `package_type=box`, `shipment_type=normal`, `time_window=flexible`, sin frágil, origen CABA, destino Córdoba
**Entonces** el envío persiste con `price > 0`, `price_breakdown` poblado y `price_currency="ARS"`.

### CA-02 — Confirmar borrador inicializa el precio

**Dado** un borrador con todos los campos requeridos
**Cuando** se confirma
**Entonces** el envío resultante (`LT-XXXXXXXX`) persiste con `price`, `price_breakdown` y `price_currency`.

### CA-03 — Distancia intra-ciudad da km=0

**Dado** un envío con origen y destino dentro de CABA (mismas coords)
**Cuando** se calcula el precio
**Entonces** `breakdown.distance_km = 0` y `breakdown.distance_cost = 0`. Solo se cobra la tarifa base más recargos opcionales.

### CA-04 — Express vale 1.5× lo que un normal equivalente

**Dado** dos envíos idénticos en todo, salvo que uno es express y el otro normal
**Entonces** el precio del express es exactamente 1.5× el del normal.

### CA-05 — Sobre cuesta menos que una caja

**Dado** dos envíos idénticos en todo, salvo el tipo de paquete
**Entonces** el del sobre cuesta 0.7× el de la caja.

### CA-06 — Frágil suma 20%

**Dado** dos envíos idénticos en todo, salvo `is_fragile`
**Entonces** el frágil cuesta 1.20× el no frágil.

### CA-07 — Ventana restrictiva suma 10%

**Dado** un envío con `time_window=flexible`
**Cuando** se compara contra el mismo envío con `time_window=morning` o `afternoon`
**Entonces** la versión restrictiva cuesta 1.10× la flexible. `morning` y `afternoon` cuestan exactamente lo mismo.

### CA-08 — El precio es inmutable

**Dado** un envío confirmado con precio `$P`
**Cuando** se aplica una corrección a la dirección del destinatario (campo no relacionado al precio)
**Entonces** `price` sigue siendo `$P`. La proyección no recomputa.

### CA-09 — Peso no editable

**Dado** un envío confirmado
**Cuando** un supervisor intenta corregir `weight_kg`
**Entonces** el backend rechaza la corrección (el campo no figura en `ShipmentCorrections`). El frontend no muestra el campo en el modal de edición.

### CA-10 — Tipo de paquete no editable

Igual a CA-09 para `package_type`.

### CA-11 — Frágil no editable

Igual a CA-09 para `is_fragile`.

### CA-12 — Tipo de envío no editable

Igual a CA-09 para `shipment_type`.

### CA-13 — Ventana horaria solo a opciones de igual o menor recargo

**Dado** un envío confirmado con `time_window=flexible`
**Cuando** un supervisor intenta corregir a `morning`
**Entonces** el backend responde 400 con: "no se puede cambiar la ventana horaria a una más restrictiva (el precio quedaría por debajo del compromiso ya cobrado)".

**Dado** un envío con `time_window=morning`
**Cuando** un supervisor corrige a `afternoon`
**Entonces** la corrección procede (mismo tier de precio).

**Dado** un envío con `time_window=morning`
**Cuando** un supervisor corrige a `flexible`
**Entonces** la corrección procede (downgrade permitido aunque el cliente ya pagó más).

### CA-14 — Cotización en vivo en NewShipment

**Dado** un operador completando el formulario de nuevo envío
**Cuando** completa peso > 0, tipo de paquete y direcciones (con provincias)
**Entonces** después de 400 ms aparece una card con el total estimado y el desglose por componente. Cualquier cambio en campos relevantes (peso, tipo de paquete, tipo de envío, ventana horaria, frágil, dirección) re-dispara el debounce.

### CA-15 — Configuración del tarifario (admin)

**Dado** un admin en `/pricing-config`
**Cuando** cambia `base_fare` y guarda
**Entonces** el cambio se persiste y se aplica a las cotizaciones y envíos siguientes. Los envíos anteriores no se modifican.

**Cuando** intenta guardar `shipment_express_multiplier=0.5`
**Entonces** el backend responde 400: "los multiplicadores deben ser positivos y el de express ≥ 1".

### CA-16 — Precio NO visible en tracking público

**Dado** un envío con precio
**Cuando** un cliente consulta `/track` con su tracking ID
**Entonces** la respuesta no incluye `price` ni `price_breakdown`.

> Nota: el endpoint público devuelve el shipment completo del backend, pero el frontend de `/track` no muestra los campos de precio. Si querés excluirlos también del payload, sanitizar la respuesta del handler público.
