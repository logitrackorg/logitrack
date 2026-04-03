# LogiTrack

**Sistema integral de gestión y seguimiento de envíos para operadores logísticos.**

---

## El problema que resuelve

Las empresas de logística operan con múltiples sucursales, distintos perfiles de usuarios y decenas (o miles) de envíos moviéndose en simultáneo. Sin una herramienta centralizada, el seguimiento se vuelve caótico: los clientes no saben dónde está su paquete, los supervisores no pueden coordinar acciones ante un problema, y los operadores trabajan a ciegas.

**LogiTrack** unifica todo en una sola plataforma: desde que se crea un envío hasta que se entrega o devuelve al remitente.

---

## ¿Qué puede hacer LogiTrack?

### Para el negocio

- **Visibilidad total de la cadena logística** — cada envío tiene un historial completo de eventos, ubicaciones y responsables.
- **Control de acceso por rol** — cada perfil de usuario ve y puede hacer exactamente lo que le corresponde, sin más ni menos.
- **Dashboard gerencial** — métricas en tiempo real sobre volumen de envíos, tasas de entrega, envíos problemáticos y rendimiento por sucursal.

### Para los operadores (día a día)

- Crear envíos nuevos con datos del remitente, destinatario y ruta.
- Consultar el listado de envíos activos y filtrar por estado.
- Ver el detalle completo y el historial de eventos de cualquier envío.

### Para los supervisores

- Actualizar el estado de los envíos a medida que avanzan por la red (en tránsito, en sucursal, en reparto, entregado…).
- Gestionar situaciones excepcionales: entregas fallidas, devoluciones, retiros en sucursal.
- Validar identidad del destinatario o remitente mediante DNI antes de registrar entregas o devoluciones.
- **Gestión de flota**: asignar vehículos a envíos, iniciar y finalizar viajes, cambiar estados de vehículos.

### Para los conductores

- Vista optimizada para dispositivos móviles con los envíos asignados a su ruta.
- Acceso al detalle de cada envío sin necesidad de navegar por pantallas complejas.

---

## Estados de un envío

Un envío sigue un ciclo de vida controlado. Cada transición queda registrada con fecha, hora y ubicación:

```
Borrador (pending)
    └─► Confirmado (in_progress) ─────────────────────────────────────────────────────► Cancelado ✗
            └─► [vehículo asignado] Pre-tránsito (pre_transit)
                    └─► [viaje iniciado] En tránsito (in_transit)
                                └─► En sucursal (at_branch) ◄────────────────────────► Cancelado ✗
                                        │        ▲
                                        ├─► [vehículo asignado] Pre-tránsito ─────────┘
                                        ├─► En reparto (delivering) ─────────────────► Cancelado ✗
                                        │       ├─► Entregado ✓
                                        │       └─► Entrega fallida ─────────────────► Cancelado ✗
                                        │               ├─► En reparto (reintento)
                                        │               └─► En sucursal (tramo de vuelta)
                                        ├─► Listo para retiro en sucursal (ready_for_pickup) ──► Cancelado ✗
                                        │       ├─► Entregado ✓
                                        │       └─► [vehículo asignado] Pre-tránsito (traslado)
                                        └─► Listo para devolución (ready_for_return) ──────────► Cancelado ✗
                                                └─► Devuelto ✓
```

Los envíos con múltiples escalas repiten el tramo `en sucursal → pre-tránsito → en tránsito → en sucursal` tantas veces como sea necesario. `Entregado`, `Devuelto` y `Cancelado` son estados terminales — no admiten más transiciones.


## Número de tracking

Cada envío confirmado recibe un identificador único con formato **`LT-XXXXXXXX`**, que puede compartirse con el cliente para el seguimiento público. Los borradores tienen un identificador temporal (`DRAFT-XXXXXXXX`) que se reemplaza al confirmar el envío.

---

## Arquitectura del sistema

LogiTrack es una aplicación web full-stack compuesta por dos servicios independientes:

```
logitrack_core/    →  API REST (Go + Gin)       puerto 8080
logitrack_web/     →  SPA frontend (React + Vite + TypeScript)    puerto 5173
```

Ambos servicios se despliegan de forma independiente. El frontend consume la API a través de HTTP con autenticación por Bearer token.

### Levantar el entorno local

Hay dos formas de correr el proyecto localmente.

#### Opción A — Docker (recomendada)

**Requisito:** Docker con el plugin Compose (`docker compose version`).

```bash
# Primera vez o después de cambiar dependencias
docker compose up --build -d

# Arranques siguientes
docker compose up -d

# Detener (los datos de la DB se conservan)
docker compose down

# Reset completo (borra la DB)
docker compose down -v
```

- Frontend → http://localhost:5173
- API → http://localhost:8080

#### Opción B — Manual (solo la DB en Docker)

**Requisitos:** Node.js 18+, Go 1.26+ y Docker.

```bash
# Levantar solo la base de datos
docker compose -f docker-compose.db.yml up -d
```

```bash
# Terminal 1 — backend
cd logitrack_core
DB_PASSWORD=localpass DB_SSLMODE=disable go run cmd/server/main.go

# Terminal 2 — frontend
cd logitrack_web
npm run dev
```

- Frontend → http://localhost:5173
- API → http://localhost:8080

Para instrucciones detalladas de cada servicio por separado:
- [Backend (logitrack_core)](./logitrack_core/README.md)
- [Frontend (logitrack_web)](./logitrack_web/README.md)

---
