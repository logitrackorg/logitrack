# Manual del usuario — Precio de envíos

> Versión correspondiente al lanzamiento de la funcionalidad de **precio de envíos**.

---

## ¿Qué cambió?

A partir de esta versión, **cada envío tiene un precio**. El sistema lo calcula automáticamente cuando creás el envío, te lo muestra antes de confirmarlo, y lo deja registrado de forma permanente para que en cualquier momento puedas consultar cuánto se le cobró al cliente y de dónde sale ese monto.

Para que el precio cobrado siempre coincida con los datos del envío, **algunos campos quedan fijos** una vez creado el envío y ya no se pueden modificar. Otros sí se pueden ajustar, con ciertas reglas. Más abajo está el detalle.

Además, la administración del sistema tiene una pantalla nueva, **Tarifario**, donde se configuran los valores que usa el sistema para calcular los precios.

---

## Si sos operador o supervisor

### Cuando creás un nuevo envío

Vas a "Nuevo envío" como hasta ahora y completás los datos del envío.

A medida que vas cargando información, **una tarjeta de cotización aparece en pantalla**. La cotización empieza a calcularse cuando ya tenés:

- Peso del envío
- Tipo de paquete (sobre o caja)
- Direcciones de origen y destino (al menos con la provincia)

La tarjeta muestra:

- **El precio total estimado** en pesos argentinos
- **Un desglose por componente**: tarifa base, distancia recorrida en kilómetros y su costo, recargo por peso (si el paquete es pesado), efecto del tipo de paquete y del tipo de envío (normal o express), recargo si elegiste una ventana horaria restrictiva, recargo si marcaste el envío como frágil

Si modificás cualquier campo que afecta al precio (peso, dirección, tipo de paquete, tipo de envío, ventana horaria o frágil), **la cotización se actualiza sola** después de una pausa breve.

> **Tené en cuenta:** lo que ves es una **estimación**. El precio definitivo se confirma en el momento de crear el envío.

Cuando hacés clic en **"Crear envío"**, el sistema:

1. Calcula el precio definitivo con los datos finales que cargaste.
2. Crea el envío con ese precio asociado.
3. Te lleva al detalle, donde ya podés ver el monto cobrado.

### Si trabajás con borradores

- Mientras el envío está como **borrador**, todavía no tiene precio asignado: lo verás como tal en el detalle.
- Cuando retomás el borrador y lo **confirmás**, el sistema calcula el precio en ese momento y lo deja fijado al envío.

### Cuando consultás el detalle de un envío existente

En el detalle vas a ver una tarjeta nueva llamada **"Precio"** que muestra el total cobrado y, debajo, el desglose con cada componente que sumó al monto. Esto sirve para:

- Justificar el monto frente a un cliente que pregunta.
- Auditar que el cobro sea correcto.
- Entender qué parte del precio corresponde a la distancia, qué parte al peso, etc.

> Si abrís un envío muy viejo (anterior a esta funcionalidad), no aparecerá la tarjeta de precio, porque ese envío fue creado cuando el sistema todavía no calculaba precios.

### Cuando editás un envío ya confirmado

Acá hay un cambio importante. Para que el precio nunca quede desfasado de los datos del envío, **algunos campos ya no se pueden modificar después de la confirmación**:

| Campo | ¿Se puede editar después de confirmado? |
|---|---|
| Peso | ❌ No |
| Tipo de paquete (sobre/caja) | ❌ No |
| Frágil | ❌ No |
| Tipo de envío (normal/express) | ❌ No |
| Ventana horaria | ✅ Sí, con reglas |
| Datos del remitente y destinatario | ✅ Sí |
| Direcciones | ✅ Sí |
| Instrucciones especiales | ✅ Sí |

Cuando abras el modal de **"Editar envío"** ya no vas a ver los campos lockeados. En el modal hay una nota recordándote esta regla.

#### Regla de la ventana horaria

La ventana horaria define cuándo se entrega el envío:

- **Mañana** o **Tarde** son ventanas restrictivas (el repartidor tiene que pasar en un horario acotado) y tienen un recargo en el precio.
- **Flexible** significa que puede entregarse en cualquier momento del día y no tiene recargo.

Como el precio ya se cobró, **solo te dejamos cambiar la ventana hacia opciones de igual o menor precio**:

| Cambio | ¿Permitido? |
|---|---|
| Mañana → Tarde | ✅ Sí (mismo precio) |
| Tarde → Mañana | ✅ Sí (mismo precio) |
| Mañana o Tarde → Flexible | ✅ Sí (más barato, no hay problema) |
| Flexible → Mañana | ❌ No |
| Flexible → Tarde | ❌ No |

Si intentás un cambio prohibido, al guardar vas a recibir un mensaje claro explicando por qué no se puede.

### Cuando un envío sufre una corrección

Las correcciones a campos que **no** afectan al precio (teléfonos, calle, ciudad, etc.) **no cambian el precio**. El monto cobrado al cliente queda como está.

---

## Si sos gerente

Como gerente seguís teniendo acceso al detalle de envíos. Vas a ver la **tarjeta "Precio"** en cada envío que tenga monto registrado, igual que operador y supervisor.

No participás del flujo de creación de envíos ni de su corrección, así que no vas a ver la tarjeta de cotización (que es solo del formulario de alta).

---

## Si sos chofer

**El chofer no ve el precio del envío.** Tu pantalla de "Mi ruta" y el detalle de cada envío que tenés que entregar siguen mostrando solamente la información operativa: peso, fragilidad, dirección, método de entrega, instrucciones especiales.

El monto cobrado al cliente no es información que necesites para tu trabajo, así que se omite intencionalmente.

---

## Si sos cliente final (página pública de seguimiento)

Si te llega un código de seguimiento y entrás a la página pública para ver el estado de tu envío, **no se muestra el precio**. La información de seguimiento sigue mostrando estados, fechas y ubicaciones, pero el monto no aparece.

---

## Si sos administrador

El rol de administrador se enfoca exclusivamente en **configuración del sistema**. A partir de esta versión:

- Tu menú de navegación contiene únicamente pantallas de configuración: Tarifario, Config. sistema, Config. ML, Organización, Sucursales, Flota, Usuarios y Log de accesos.
- **No vas a ver "Envíos" en el menú**, ni podés crear, editar o consultar el detalle de envíos individuales. Si intentás entrar por una URL directa, el sistema te redirige a la pantalla principal de admin.

### Pantalla nueva: Tarifario

En el menú vas a encontrar el link **"Tarifario"** (visible solo para admin). Esta pantalla te permite ajustar todos los parámetros que el sistema usa para calcular el precio de los envíos.

Los parámetros editables son:

| Parámetro | Qué controla |
|---|---|
| **Tarifa base** | Precio inicial fijo que se aplica a todo envío. |
| **Costo por km** | Multiplicado por la distancia entre origen y destino. |
| **Recargo peso 5–25 kg** | Suma fija cuando el envío pesa entre 5 y 25 kg. |
| **Recargo peso > 25 kg** | Suma fija cuando el envío pesa más de 25 kg. |
| **Multiplicador sobre** | Factor aplicado cuando el paquete es un sobre (por defecto 0.7, es decir, los sobres son más baratos). |
| **Multiplicador caja** | Factor aplicado cuando el paquete es una caja (por defecto 1.0). |
| **Multiplicador express** | Factor aplicado cuando el envío es express (por defecto 1.5). |
| **Recargo ventana restrictiva** | Porcentaje extra cuando la ventana horaria es Mañana o Tarde (por defecto 10%). |
| **Recargo frágil** | Porcentaje extra cuando el envío está marcado como frágil (por defecto 20%). |

Cada campo tiene una descripción al lado y una indicación de cómo se interpreta (en pesos, como multiplicador, o como porcentaje).

#### Cómo guardar cambios

1. Editás los valores que quieras ajustar.
2. El botón **"Guardar cambios"** se habilita automáticamente cuando hay diferencias respecto al estado guardado.
3. Si querés volver atrás, hacés clic en **"Descartar"** y volvés al estado anterior sin recargar.
4. Al guardar, vas a ver un cartel verde de confirmación que desaparece solo.

#### Validaciones

- Los importes (tarifa base, $/km, recargos por peso) no pueden ser negativos.
- Los multiplicadores de paquete deben ser positivos.
- El multiplicador de express debe ser **mayor o igual a 1** (no puede ser más barato que un envío normal).
- Los porcentajes de recargo (ventana, frágil) no pueden ser negativos.

Si cargás un valor inválido, el sistema rechaza el guardado y te muestra el motivo. Tus cambios en pantalla no se pierden; podés ajustar y volver a intentar.

#### Efecto de los cambios

> **Importante:** los cambios al tarifario afectan **solo a las cotizaciones y envíos que se creen a partir del momento del guardado**. Los envíos ya creados conservan el precio que se les calculó originalmente — el monto cobrado al cliente nunca se recalcula retroactivamente.

Esto significa que podés ajustar el tarifario cuando cambien los costos operativos sin preocuparte por afectar la facturación de envíos en curso.

---

## Resumen rápido

| Quién | Qué puede hacer con el precio |
|---|---|
| **Operador / Supervisor** | Ve cotización al crear un envío, ve precio en el detalle, lo justifica al cliente, no puede modificarlo. |
| **Gerente** | Ve precio en el detalle de envíos. |
| **Chofer** | No ve el precio en ninguna pantalla. |
| **Cliente final (público)** | No ve el precio en la página de seguimiento. |
| **Admin** | Configura el tarifario. No interactúa con envíos. |

| Campo del envío | ¿Editable después de confirmar? |
|---|---|
| Peso, tipo de paquete, frágil, tipo de envío | ❌ No |
| Ventana horaria | ✅ Solo a una opción de igual o menor recargo |
| Datos de personas y direcciones, instrucciones | ✅ Sí |
