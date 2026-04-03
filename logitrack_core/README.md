# logitrack_core

API REST del sistema LogiTrack, construida en Go con el framework Gin.

## Requisitos

- Go 1.21 o superior
- PostgreSQL 17 (para producción y desarrollo local con Docker)

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

Este es el paso de validación principal (no hay test suite completo aún).

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `DB_HOST` | `localhost` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_USER` | `postgres` | Usuario de DB |
| `DB_PASSWORD` | — | Contraseña de DB (requerida) |
| `DB_NAME` | `logitrack` | Nombre de la base de datos |
| `DB_SSLMODE` | `require` | SSL mode (`disable` para local) |
| `ML_MODEL_PATH` | `model.json` | Ruta al modelo ML entrenado |

## Notas importantes

- **Persistencia en PostgreSQL.** El `EventStore` y la `ShipmentProjection` están respaldados por la base de datos. Los vehículos también se persisten. Los tokens de autenticación son in-memory y se pierden al reiniciar.
- **Auth.** `POST /api/v1/auth/login` devuelve un token UUID. Todas las rutas protegidas requieren el header `Authorization: Bearer <token>`.
- **Event sourcing.** Los envíos no se modifican directamente — cada cambio genera un `DomainEvent` que se aplica a una proyección materializada.
- **Gestión de flota.** Los vehículos se asignan a envíos vía `POST /vehicles/by-plate/:plate/assign`, lo que transiciona el envío a `pre_transit`. El viaje se inicia con `StartTrip` (→ `in_transit`) y se finaliza con `EndTrip` (→ `at_branch`).
- **Correcciones.** Los supervisores y admins pueden editar campos de envíos confirmados de forma no destructiva (`PATCH /shipments/:id/correct`). El dato original nunca se modifica.
- **Cancelación.** Envíos en estado intermedio pueden cancelarse (`POST /shipments/:id/cancel`) con un motivo obligatorio — excepto `pre_transit` e `in_transit` (el vehículo ya está en operación).
- **Comentarios.** Supervisores y admins pueden agregar notas internas a envíos no finalizados (`POST /shipments/:id/comments`).
- **Autocomplete de clientes.** Los datos de remitente y destinatario se guardan automáticamente. `GET /customers?dni=X` permite buscar clientes previos por DNI.
