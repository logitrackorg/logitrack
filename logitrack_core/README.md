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

## Verificar que funciona

```bash
curl http://localhost:8080/api/v1/branches
```

Debe devolver la lista de sucursales cargadas al inicio.

## Build

```bash
go build ./...
```

Este es el paso de validación principal (no hay test suite aún).

## Variables de entorno

Ninguna requerida para correr localmente. El puerto es fijo en `8080`.

## Notas importantes

- **El estado es volátil.** Al reiniciar el servidor se pierden todos los envíos y sesiones activas. Los tokens de autenticación dejan de ser válidos.
- **Usuarios hardcodeados.** Ver el [README principal](../README.md#credenciales-de-prueba) para las credenciales.
- **Auth.** `POST /api/v1/auth/login` devuelve un token UUID. Todas las rutas protegidas requieren el header `Authorization: Bearer <token>`.
