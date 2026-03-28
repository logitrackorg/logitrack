# Specs — LogiTrack

Las specs se escriben por User Story. Cada archivo documenta el comportamiento esperado del sistema para esa US: modelo de datos relevante, reglas de negocio, flujos y escenarios en formato Dado/Cuando/Entonces.

Las specs son la fuente de verdad. La implementación debe satisfacer todos los escenarios descritos.

## Índice

| #   | User Story | Estado |
|-----|------------|--------|
| 001 | [Registrar un envío](./US-001-registrar-envio.md) | Implementada |
| 002 | [Guardar borrador del alta](./US-002-guardar-borrador.md) | Implementada |
| 002b | [Validaciones del formulario de alta](./US-002-validaciones-alta.md) | Implementada |
| 003 | [Rol Gerente](./US-003-rol-gerente.md) | Implementada |
| 004 | [Rol Chofer](./US-004-rol-chofer.md) | Implementada |
| 004b | [Búsqueda por tracking ID](./US-004-busqueda-tracking-id.md) | Implementada |
| 005 | [Búsqueda de envíos](./US-005-busqueda-envios.md) | Implementada |
| 010 | [Envío devuelto a remitente](./US-010-devolucion-remitente.md) | Implementada |
| 011 | [Cancelar un envío](./US-011-cancelar-envio.md) | Implementada |
| 013 | [Timestamp y usuario en cada transición](./US-013-timestamp-usuario-transicion.md) | Implementada |
| 014 | [Agregar observación al cambiar estado](./US-014-observacion-cambio-estado.md) | Implementada |
| 012 | [Cambio de estado del envío](./US-012-cambio-estado.md) | Implementada |
| 006 | [Detalle completo del envío](./US-006-detalle-envio.md) | Implementada |
| 007 | [Filtrado por fecha](./US-007-filtrado-fecha.md) | Implementada |
| 008 | [Filtrado por estado](./US-008-filtrado-estado.md) | Implementada |
| 009 | [Editar envío](./US-009-editar-envio.md) | Implementada |
| 015 | [Historial completo de estados](./US-015-historial-estados.md) | Implementada |
| 018 | [Registro de acceso (login/logout)](./US-018-login-logout.md) | Implementada |
| 019 | [Rol Operador](./US-019-rol-operador.md) | Parcialmente implementada |
| 020 | [Rol Supervisor](./US-020-rol-supervisor.md) | Parcialmente implementada |
| 067 | [Registrar intento fallido de entrega](./US-067-intento-fallido.md) | Parcialmente implementada |
| 068 | [Registrar entrega exitosa](./US-068-entrega-exitosa.md) | Implementada |

## Convenciones

- Los escenarios usan el formato **Dado / Cuando / Entonces**.
- "El servidor" = backend Go (`logitrack_core`).
- "El frontend" = SPA React (`logitrack_web`).
- Las reglas del servidor son autoritativas; las del frontend son UX.
- Los campos marcados "Requerido para confirmar" son opcionales en borradores (`pending`) pero obligatorios para transicionar a `in_progress`.
