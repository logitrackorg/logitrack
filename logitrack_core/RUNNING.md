# Cómo levantar el backend

## Requisitos

- Go 1.21+

## Levantar el servidor

```bash
cd logitrack_core
go run cmd/server/main.go
```

El servidor queda disponible en **http://localhost:8080**.

## Otros comandos

```bash
# Verificar que compila
go build ./...

# Ordenar dependencias
go mod tidy
```

## Notas

- Todo el estado es **en memoria**: reiniciar el servidor borra shipments y sesiones activas.
- El servidor expone la API en `/api/v1`.
- Usuarios disponibles para login:

| Usuario    | Contraseña    | Rol        |
|------------|---------------|------------|
| operator   | operator123   | Operator   |
| supervisor | supervisor123 | Supervisor |
| gerente    | gerente123    | Manager    |
| admin      | admin123      | Admin      |
