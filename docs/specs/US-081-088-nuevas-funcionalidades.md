# User Stories — Nuevas funcionalidades (US-081 a US-088)

---

## US-081 — Autocompletar la dirección mientras escribo

**Como** operador o supervisor
**Quiero** que el formulario me sugiera direcciones mientras escribo la calle
**Para** no tener que completar todos los campos de dirección uno por uno y reducir errores de tipeo

### Criterios de aceptación

- CA-01 — Cuando escribo al menos 5 caracteres en el campo "Calle" y dejo de tipear un momento, aparece un listado con sugerencias de direcciones argentinas que coinciden con lo que escribí.
- CA-02 — Al hacer clic sobre una sugerencia, los campos calle, ciudad, provincia y código postal se completan solos. No tengo que tocarlos.
- CA-03 — Si no aparecen sugerencias para lo que escribí, veo un mensaje que me lo indica y puedo completar los campos a mano igual, sin que el sistema me bloquee.

---

## US-082 — Ver la fecha estimada de entrega en el detalle

**Como** operador, supervisor o gerente
**Quiero** ver cuándo se estima que va a llegar un envío
**Para** poder informarle al cliente sin tener que calcularlo yo

### Criterios de aceptación

- CA-01 — Al abrir el detalle de un envío confirmado, veo una etiqueta "Entrega est." con la fecha calculada por el sistema.
- CA-02 — Si el envío todavía es borrador, esa etiqueta no muestra fecha: la fecha estimada se calcula recién cuando se confirma el envío.
- CA-03 — Los envíos cargados antes de que esta funcionalidad existiera muestran un guión en ese campo, sin errores ni valores inventados.

---

## US-083 — La fecha estimada refleja el tipo de servicio contratado

**Como** operador
**Quiero** que la fecha estimada cambie según si el envío es normal o express
**Para** que el cliente entienda cuánto antes llega si elige el servicio más urgente

### Criterios de aceptación

- CA-01 — Un envío express tiene una fecha estimada anterior a uno normal con el mismo origen y destino: el sistema le asigna menos días de tránsito.
- CA-02 — La fecha estimada que aparece en el detalle es la misma que se muestra en la página pública de seguimiento del cliente.
- CA-03 — Si después de confirmar corrijo datos del envío que no son el tipo de envío (por ejemplo, el teléfono del destinatario), la fecha estimada no cambia.

---

## US-084 — Identificar un borrador con un código legible

**Como** operador
**Quiero** que el borrador tenga un código corto y fácil de leer
**Para** poder referenciarlo al hablar con un compañero o retomarlo más tarde sin confundirlo con otro

### Criterios de aceptación

- CA-01 — Al guardar un borrador por primera vez, recibe automáticamente un código con el formato BORRADOR-NNNNN (cinco dígitos numéricos), que veo en el encabezado del detalle.
- CA-02 — El código del borrador es de solo lectura: está visible en el formulario pero no puedo modificarlo.
- CA-03 — Una vez que confirmo el borrador, el código BORRADOR-NNNNN desaparece y el envío queda identificado solo con su número LT- definitivo.

---

## US-085 — Confirmar un borrador sin perder el historial

**Como** supervisor
**Quiero** que al confirmar un borrador todo el historial de cambios quede bajo el número definitivo
**Para** poder auditar qué pasó con el envío desde que se empezó a cargar, no solo desde que se confirmó

### Criterios de aceptación

- CA-01 — Al confirmar un borrador, veo en el historial de eventos del nuevo envío un registro que indica que provino del borrador BORRADOR-NNNNN, con el código anterior visible.
- CA-02 — Los eventos que se generaron mientras el envío era borrador (guardados parciales, ediciones) aparecen en el historial bajo el número LT- definitivo, no se pierden.
- CA-03 — Si intento acceder al borrador original por su código BORRADOR- después de confirmarlo, el sistema devuelve un error: ese identificador ya no existe.

---

## US-086 — Retomar un borrador sin perder los datos ya cargados

**Como** operador
**Quiero** que al volver a editar un borrador encuentre los datos que ya cargué la vez anterior
**Para** no tener que repetir el trabajo cuando retomo un alta que dejé incompleta

### Criterios de aceptación

- CA-01 — Al abrir un borrador que ya tenía sucursal receptora asignada, el selector de sucursal aparece completado con el valor que guardé antes, sin necesidad de volver a elegirlo.
- CA-02 — Puedo guardar cambios parciales en el borrador, cerrar la pantalla, volver más tarde y continuar desde donde lo dejé.
- CA-03 — Puedo editar y guardar el borrador tantas veces como necesite; el sistema no lo confirma automáticamente ni cambia su estado hasta que yo hago clic en "Confirmar envío".

---

## US-087 — Elegir el tipo de envío al crear

**Como** operador
**Quiero** indicar si un envío es normal o express al momento de cargarlo
**Para** que el sistema refleje el servicio que el cliente contrató y lo tenga en cuenta desde el inicio

### Criterios de aceptación

- CA-01 — En el formulario de nuevo envío veo el campo "Tipo de envío" con las opciones Normal y Express, con Normal preseleccionado por defecto.
- CA-02 — El tipo de envío que elijo se guarda con el envío y puedo verlo en el detalle una vez confirmado.
- CA-03 — Mientras el envío es borrador puedo cambiar el tipo de envío cuantas veces quiera antes de confirmar; una vez confirmado, el campo no aparece en el formulario de corrección.

---

## US-088 — El tipo de envío impacta en el precio y en el plazo estimado

**Como** operador
**Quiero** que al elegir Express el sistema me muestre cuánto más cuesta y cuánto antes llega
**Para** poder informarle al cliente con precisión antes de confirmar el alta

### Criterios de aceptación

- CA-01 — Al cambiar el tipo de envío de Normal a Express en el formulario, la cotización en vivo se actualiza sola y muestra el nuevo total con el recargo de express detallado en el desglose.
- CA-02 — Un envío express tiene una fecha estimada de entrega anterior a uno normal creado con los mismos datos de origen, destino y peso.
- CA-03 — Una vez confirmado el envío, el tipo de envío no aparece como campo editable en el formulario de corrección: quedó fijo junto con el precio.
