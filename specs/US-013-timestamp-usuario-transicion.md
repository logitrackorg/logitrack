# US-013 — Registrar timestamp y usuario en cada transición

**Estado:** Implementada

## Actor principal
Sistema (registro automático). Supervisor/Admin (quienes ejecutan el cambio).

## Descripción
Cada vez que se ejecuta una transición de estado, el sistema registra automáticamente la fecha y hora UTC y el usuario que realizó el cambio. Estos datos son parte del `ShipmentEvent` y son visibles en el historial del envío.

> Esta US describe el mecanismo de trazabilidad que sustenta US-014 (observaciones) y US-015 (historial). No agrega comportamiento nuevo — especifica un requisito transversal.

---

## Reglas de negocio

1. El campo `changed_by` se obtiene del request (`UpdateStatusRequest.ChangedBy`) — el frontend lo puebla con `user.username` del contexto de autenticación.
2. El campo `timestamp` lo genera el servidor (`time.Now().UTC()`) — el cliente no puede sobreescribirlo.
3. Ambos campos son obligatorios en el modelo `ShipmentEvent`; si `changed_by` llega vacío se almacena la cadena vacía (el frontend muestra `"system"`).
4. El registro ocurre **después** de que todas las validaciones pasan y el repositorio confirma el cambio.
5. Aplica a toda transición implementada: `UpdateStatus`, `Create`, `ConfirmDraft`. `SaveDraft` no genera evento de auditoría. `EditShipment` (US-009) no está implementado aún.

---

## Escenarios

### CA01 — Timestamp generado por el servidor

**Dado** que el supervisor ejecuta una transición
**Cuando** el request llega al servidor
**Entonces** el `ShipmentEvent` se crea con `timestamp = time.Now().UTC()` en el momento exacto del cambio
**Y** el cliente no puede enviar ni sobreescribir el timestamp

---

### CA02 — Usuario registrado automáticamente

**Dado** que el supervisor está autenticado como `"supervisor1"`
**Cuando** cambia el estado de un envío
**Entonces** el evento almacena `changed_by: "supervisor1"`
**Y** el historial del envío muestra `"by supervisor1"` en ese evento

---

### CA03 — Datos visibles en el historial

**Cuando** se consulta `GET /shipments/:tracking_id/events`
**Entonces** cada evento del array incluye `changed_by` y `timestamp`
**Y** el frontend los muestra en la sección "Event History" (ver US-015)
