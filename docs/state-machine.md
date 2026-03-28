# Máquina de estados de envíos

## Estados

| Estado | Descripción                                         |
|--------|-----------------------------------------------------|
| `pending` | Borrador — no confirmado aún. Editable.             |
| `in_progress` | Confirmado, esperando primer despacho.              |
| `in_transit` | En movimiento entre sucursales.                     |
| `at_branch` | Llegó a una sucursal intermedia o de destino.       |
| `delivering` | En camino para entrega a domicilio al destinatario. |
| `delivered` | Entregado exitosamente. Estado final.               |
| `delivery_failed` | Intento de entrega fallido.                         |
| `ready_for_pickup` | El destinatario retira en la sucursal actual.       |
| `ready_for_return` | El remitente retira en la sucursal de origen.       |
| `returned` | Devuelto al remitente. Estado final.                    |
| `cancelled` | Cancelado. Estado final.                                |

---

## Diagrama de transiciones

[DIAGRAM](https://miro.com/app/board/uXjVGtApDew=/)

---
