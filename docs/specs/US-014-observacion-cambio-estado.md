# US-014 — Agregar observación al cambiar estado

**Estado:** Implementada

## Actor principal
Supervisor, Admin (únicos roles que pueden cambiar estado desde el frontend).

> ⚠️ La US está redactada como "Como Operador", pero el cambio de estado está restringido a Supervisor y Admin (ver US-012). La funcionalidad de observaciones aplica a esos roles.

## Descripción
Al cambiar el estado de un envío, el usuario puede registrar una observación libre. La observación queda almacenada en el evento de auditoría y es visible en el historial del envío.

---

## Reglas de negocio

1. El campo `notes` en `UpdateStatusRequest` es **opcional** para todos los estados, excepto `delivery_failed` donde es **obligatorio**.
2. La observación se almacena en el `ShipmentEvent` correspondiente al cambio.
3. Los eventos sin notas no muestran sección de observación en el historial (renderizado condicional).
4. La longitud de la observación no está limitada por el sistema actual.

---

## Escenarios

### CA01 — Observación opcional en transición normal

**Dado** un envío en `at_branch`
**Y** el usuario es supervisor
**Cuando** selecciona la transición `In Transit` y escribe una observación en el campo "Notes"
**Y** confirma el cambio
**Entonces** el servidor almacena la nota en el evento
**Y** el historial muestra la observación asociada a esa transición

---

### CA02 — Cambio de estado sin observación

**Dado** un envío en `at_branch`
**Cuando** el supervisor cambia el estado a `In Transit` sin escribir ninguna nota
**Entonces** el cambio se procesa correctamente
**Y** el evento queda sin campo `notes`
**Y** en el historial no aparece sección de observación para ese evento

---

### CA03 — Observación obligatoria para `delivery_failed`

**Dado** un envío en `delivering`
**Cuando** el supervisor selecciona la transición `Delivery Failed`
**Entonces** el campo de notas muestra el placeholder `"Motivo requerido (ej: Destinatario ausente)"`
**Y** el botón "Confirm Update" está deshabilitado mientras el campo esté vacío
**Y** al enviar sin nota, el servidor responde 400 con `"notes are required for delivery_failed"`

---

### CA04 — La observación queda visible en el historial

**Dado** un evento con nota `"Destinatario ausente — tercer intento"`
**Cuando** cualquier usuario con acceso abre el detalle del envío
**Entonces** el historial muestra esa nota bajo la entrada de evento correspondiente
