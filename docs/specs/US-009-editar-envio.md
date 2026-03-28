# US-009 — Corregir datos de un envío (edición no destructiva)

**Como** Supervisor o Admin
**Quiero** corregir datos incorrectos de un envío confirmado
**Para** mantener la información actualizada sin alterar el registro original

---

## Criterios de aceptación

1. Los datos originales del envío **nunca se modifican**.
2. Las correcciones se almacenan en un campo separado (`corrections`) como un mapa `campo → nuevo valor`.
3. Cada campo corregido genera automáticamente un comentario interno con el nuevo valor.
4. Se registra un evento de auditoría con `event_type: "edited"` y el usuario responsable.
5. Solo Supervisor y Admin pueden aplicar correcciones.
6. No se pueden corregir envíos en estado `pending` (se editan directamente via borrador) ni en estados terminales (`delivered`, `returned`, `cancelled`).

---

## Endpoint

```
PATCH /api/v1/shipments/:tracking_id/correct
```

| Campo             | Notas                                                              |
|-------------------|--------------------------------------------------------------------|
| Body              | `{ "corrections": { "campo": "nuevo_valor", ... } }`              |
| Respuesta exitosa | `200 OK` con el envío actualizado (incluye el campo `corrections`) |
| Rol no autorizado | `403 Forbidden`                                                    |
| Estado inválido   | `400 Bad Request`                                                  |

---

## Campos corregibles

| Key en `corrections`      | Descripción                     |
|---------------------------|---------------------------------|
| `sender_name`             | Nombre remitente                |
| `sender_phone`            | Teléfono remitente              |
| `sender_email`            | Email remitente                 |
| `sender_dni`              | DNI remitente                   |
| `origin_street`           | Dirección origen (calle)        |
| `origin_city`             | Ciudad origen                   |
| `origin_province`         | Provincia origen                |
| `origin_postal_code`      | Código postal origen            |
| `recipient_name`          | Nombre destinatario             |
| `recipient_phone`         | Teléfono destinatario           |
| `recipient_email`         | Email destinatario              |
| `recipient_dni`           | DNI destinatario                |
| `destination_street`      | Dirección destino (calle)       |
| `destination_city`        | Ciudad destino                  |
| `destination_province`    | Provincia destino               |
| `destination_postal_code` | Código postal destino           |
| `weight_kg`               | Peso (kg)                       |
| `package_type`            | Tipo de paquete                 |
| `special_instructions`    | Instrucciones especiales        |

Cualquier key fuera de esta lista es rechazada con `400 Bad Request`.

---

## Reglas de negocio

1. Los datos originales del envío nunca se modifican — las correcciones se guardan en `shipment.corrections`.
2. Correcciones sucesivas se acumulan (merge): cada llamada puede corregir campos adicionales o sobreescribir correcciones previas.
3. Por cada campo corregido se crea automáticamente un comentario con el formato: `[Corrección] <Nombre campo>. Nuevo valor: <valor>`.
4. Se registra un `ShipmentEvent` con `event_type: "edited"`, `from_status == to_status` (el estado no cambia) y el usuario responsable.
5. No se pueden enviar correcciones vacías (`corrections: {}`).

---

## Comportamiento del frontend

- En `ShipmentDetail`, el botón **✏️ Edit data** aparece para supervisor y admin en envíos que no son `pending`, `delivered`, `returned` ni `cancelled`.
- Al hacer click se abre un modal con todos los campos corregibles pre-llenados con el valor efectivo actual (corrección existente o dato original).
- Al guardar, solo se envían los campos que cambiaron respecto al valor efectivo actual.
- En las tarjetas de datos (Remitente, Destinatario, Paquete), los campos con corrección activa muestran:
  - El valor corregido como valor principal.
  - Un badge **"Modificado"** en amarillo.
  - El valor original tachado en gris debajo.

---

## Diferencia con la edición de borradores (US-002)

| Aspecto               | Borrador (`pending`)                    | Envío confirmado                              |
|-----------------------|-----------------------------------------|-----------------------------------------------|
| Endpoint              | `PATCH /shipments/:id/draft`            | `PATCH /shipments/:id/correct`                |
| Modifica datos orig.  | Sí (es un draft, no hay historial aún)  | No — solo agrega correcciones                 |
| Comentario automático | No                                      | Sí — uno por campo corregido                  |
| Evento de auditoría   | No                                      | Sí — `event_type: "edited"`                   |
| Estados permitidos    | Solo `pending`                          | Todo excepto `pending`, `delivered`, `returned`, `cancelled` |

---

## Escenarios

### CA1 — Corrección exitosa de un campo

- **Dado** que el envío `LT-XXXXXXXX` está en `in_progress`
- **Y** el usuario es supervisor
- **Cuando** hace `PATCH /correct` con `{ "corrections": { "recipient_phone": "+54 9 11 9999-0000" } }`
- **Entonces** el servidor responde `200 OK` con el envío actualizado
- **Y** `shipment.corrections.recipient_phone` es `"+54 9 11 9999-0000"`
- **Y** `shipment.recipient_phone` (original) no cambia
- **Y** se crea un comentario: `[Corrección] Teléfono destinatario. Nuevo valor: +54 9 11 9999-0000`
- **Y** se registra un evento con `event_type: "edited"`

### CA2 — Corrección acumulativa

- **Dado** que el envío ya tiene `corrections.recipient_phone` corregido
- **Cuando** supervisor hace `PATCH /correct` con `{ "corrections": { "recipient_name": "Laura García" } }`
- **Entonces** el envío tiene ambas correcciones activas
- **Y** el campo `recipient_phone` previo no se pierde

### CA3 — Intento de corregir envío finalizado

- **Dado** que el envío está en `delivered`, `returned` o `cancelled`
- **Cuando** supervisor intenta `PATCH /correct`
- **Entonces** el servidor responde `400 Bad Request`

### CA4 — Intento de corregir un borrador

- **Dado** que el envío está en `pending`
- **Cuando** supervisor intenta `PATCH /correct`
- **Entonces** el servidor responde `400 Bad Request` indicando que los borradores se editan directamente

### CA5 — Campo no permitido

- **Dado** un envío confirmado
- **Cuando** se intenta corregir el campo `status` o cualquier key no listada
- **Entonces** el servidor responde `400 Bad Request`

### CA6 — Operador no puede corregir

- **Dado** un envío en `in_progress`
- **Cuando** el operador intenta `PATCH /correct`
- **Entonces** el servidor responde `403 Forbidden`

### CA7 — Visual en el frontend

- **Dado** que `recipient_phone` tiene una corrección activa
- **Cuando** supervisor accede al detalle del envío
- **Entonces** ve el teléfono corregido con badge "Modificado" y el original tachado en gris debajo
- **Y** en los comentarios aparece el registro automático de la corrección
