# logitrack_core

API REST del sistema LogiTrack, construida en Go con el framework Gin.

## Requisitos

- Go 1.21 o superior
- Sin base de datos externa — todo el estado es in-memory (se resetea al reiniciar)

## Levantar el servidor

```bash
# Desde la raíz del repo
cd logitrack_core

# Instalar/sincronizar dependencias
go mod tidy

# Iniciar el servidor de desarrollo (puerto 8080)
go run cmd/server/main.go
```

El servidor queda disponible en `http://localhost:8080`.

## Build

```bash
go build ./...
```

Este es el paso de validación principal (no hay test suite aún).

## Variables de entorno

Ninguna requerida para correr localmente. El puerto es fijo en `8080`.

## Notas importantes

- **El estado es volátil.** Al reiniciar el servidor se pierden todos los envíos y sesiones activas. Los tokens de autenticación dejan de ser válidos.
- **Auth.** `POST /api/v1/auth/login` devuelve un token UUID. Todas las rutas protegidas requieren el header `Authorization: Bearer <token>`.
- **Event sourcing.** Los envíos no se modifican directamente — cada cambio genera un `DomainEvent` que se aplica a una proyección materializada en memoria.
- **Correcciones.** Los supervisores y admins pueden editar campos de envíos confirmados de forma no destructiva (`PATCH /shipments/:id/correct`). El dato original nunca se modifica.
- **Cancelación.** Cualquier envío en estado intermedio puede cancelarse (`POST /shipments/:id/cancel`) con un motivo obligatorio.
- **Comentarios.** Supervisores y admins pueden agregar notas internas a envíos no finalizados (`POST /shipments/:id/comments`).
- **Autocomplete de clientes.** Los datos de remitente y destinatario se guardan automáticamente. `GET /customers?dni=X` permite buscar clientes previos por DNI.
