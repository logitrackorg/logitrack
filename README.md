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
- **Seguimiento público sin login** — los clientes finales pueden consultar el estado de su envío desde cualquier dispositivo con solo ingresar el número de tracking.
- **Dashboard gerencial** — métricas en tiempo real sobre volumen de envíos, tasas de entrega, envíos problemáticos y rendimiento por sucursal.
- **Flujo de borradores** — los operadores pueden armar un envío paso a paso antes de confirmarlo, sin generar movimientos prematuros en el sistema.

### Para los operadores (día a día)

- Crear envíos nuevos con datos del remitente, destinatario y ruta.
- Consultar el listado de envíos activos y filtrar por estado.
- Ver el detalle completo y el historial de eventos de cualquier envío.

### Para los supervisores

- Actualizar el estado de los envíos a medida que avanzan por la red (en tránsito, en sucursal, en reparto, entregado…).
- Gestionar situaciones excepcionales: entregas fallidas, devoluciones, retiros en sucursal.
- Validar identidad del destinatario o remitente mediante DNI antes de registrar entregas o devoluciones.

### Para los conductores

- Vista optimizada para dispositivos móviles con los envíos asignados a su ruta.
- Acceso al detalle de cada envío sin necesidad de navegar por pantallas complejas.

---

## Estados de un envío

Un envío sigue un ciclo de vida controlado. Cada transición queda registrada con fecha, hora y ubicación:

```
Borrador (pending)
    └─► Confirmado (in_progress)
            └─► En tránsito (in_transit)
                    └─► En sucursal (at_branch)
                            ├─► En reparto (delivering)
                            │       ├─► Entregado ✓
                            │       └─► Entrega fallida
                            │               ├─► En reparto (reintento)
                            │               └─► En sucursal (vuelta atrás)
                            ├─► Listo para retiro en sucursal
                            │       └─► Entregado ✓
                            └─► Listo para devolución
                                    └─► Devuelto ✓
```

Los envíos con múltiples escalas repiten el tramo `en sucursal → en tránsito → en sucursal` tantas veces como sea necesario.

---

## Perfiles de usuario

| Perfil | Puede crear envíos | Puede actualizar estados | Ve el dashboard |
|--------|--------------------|--------------------------|-----------------|
| Operador | Sí | No | No |
| Supervisor | Sí | Sí | No |
| Gerente | No | No | Sí |
| Admin | Sí | Sí | Sí |

---

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

Para instrucciones de instalación y ejecución:
- [Backend (logitrack_core)](./logitrack_core/README.md)
- [Frontend (logitrack_web)](./logitrack_web/README.md)

---
