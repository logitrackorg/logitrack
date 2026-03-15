# US-002 — Guardar borrador del alta

**Como** Operador
**Quiero** guardar un borrador del alta
**Para** poder completarlo más tarde

---

## Criterios de aceptación

1. Al hacer clic en "Guardar borrador" los datos se persisten en el sistema.
2. Al volver a la pantalla de alta, el sistema ofrece retomar el borrador guardado.

---

## Reglas de negocio

- Un borrador tiene `status: pending` y un identificador temporario `DRAFT-XXXXXXXX` (sin tracking ID real).
- Los datos son parciales: ningún campo es obligatorio para guardar.
- Al persistirse, el borrador es visible en la lista de envíos con badge "Draft".
- Un borrador puede confirmarse desde su pantalla de detalle (ver US-001).

---

## Escenarios

### CA1 — Los datos se persisten al guardar borrador

- **Dado** que el usuario tiene rol `operator`, `supervisor` o `admin`
- **Y** está en la pantalla `/new`
- **Cuando** completa algunos campos y hace clic en "Guardar borrador"
- **Entonces** el sistema hace `POST /shipments/draft` con los datos ingresados
- **Y** el servidor responde `201 Created` con el borrador (`status: pending`, `tracking_id: DRAFT-XXXXXXXX`)
- **Y** el frontend redirige al detalle del borrador (`/shipments/DRAFT-XXXXXXXX`) (guardado inicial)
- **Y** los datos ingresados son visibles en el detalle

### CA2 — El sistema ofrece retomar borradores al volver al alta

- **Dado** que existen uno o más borradores en el sistema (`status: pending`)
- **Cuando** el usuario navega a `/new`
- **Entonces** ve un panel "Saved drafts" antes del formulario
- **Y** el panel lista cada borrador con remitente (o "Sin nombre"), destinatario (o "Sin nombre") y fecha de creación
- **Y** cada borrador tiene un botón "Retomar" que lleva a `/shipments/DRAFT-XXXXXXXX`
- **Y** los borradores se muestran con badge "Draft"

### CA3 — Sin borradores, el panel no aparece

- **Dado** que no hay borradores en el sistema
- **Cuando** el usuario navega a `/new`
- **Entonces** el formulario se muestra directamente, sin panel de borradores

### CA4 — Guardar borrador con formulario vacío

- **Dado** que el usuario no ingresó ningún dato
- **Cuando** hace clic en "Guardar borrador"
- **Entonces** el sistema igualmente persiste el borrador (payload vacío es válido)
- **Y** el borrador aparece en la lista con "Sin nombre" como remitente y destinatario

### CA5 — Guardar cambios desde el detalle del borrador

- **Dado** que el usuario está en el detalle de un borrador (`/shipments/DRAFT-XXXXXXXX`)
- **Cuando** modifica algún campo y hace clic en "Guardar cambios"
- **Entonces** el sistema hace `PATCH /shipments/DRAFT-XXXXXXXX/draft` con los datos actualizados
- **Y** el frontend redirige a `/?status=pending` (lista de envíos filtrada por estado Draft)
