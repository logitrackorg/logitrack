# US-100 — Dashboard Gerencial

**Como** Gerente
**Quiero** un dashboard ejecutivo con KPIs, filtros, drill-down y exportación
**Para** monitorear el rendimiento de la operación logística y tomar decisiones basadas en datos

---

## Criterios de aceptación

1. El dashboard es la landing page del Gerente al iniciar sesión.
2. Muestra KPIs clave: Total de envíos, En curso, Entregados, Problemas (fallidos + extraviados + dañados).
3. Permite filtrar por período y sucursal.
4. Cada KPI y gráfico permite drill-down a una vista de detalle.
5. El dashboard se puede exportar a PDF y Excel.
6. Los datos mostrados corresponden al período y sucursal seleccionados.

---

## Dependencias

- **US-003 — Rol Gerente**: Define los permisos base del rol `manager`.
- **US-005 — Búsqueda de envíos**: El drill-down desde el dashboard navega al listado de envíos pre-filtrado.
- **Endpoint `GET /api/v1/shipments/stats`**: Devuelve estadísticas agrupadas por estado y por día (ya implementado).
- **US-074 — Exportar listado de envíos a CSV**: Define el formato de exportación de datos.

---

## Modelo de datos

### Request — `GET /api/v1/shipments/stats`

| Parámetro    | Tipo   | Obligatorio | Default        | Descripción                     |
|-------------|--------|-------------|----------------|----------------------------------|
| `date_from` | string | No          | 30 días atrás  | Inicio del período (YYYY-MM-DD) |
| `date_to`   | string | No          | Hoy            | Fin del período (YYYY-MM-DD)    |
| `branch_id` | string | No          | Todas          | Filtrar por sucursal receptora  |

### Response — `200 OK`

| Campo             | Tipo                  | Descripción                                            |
|-------------------|-----------------------|--------------------------------------------------------|
| `total`           | int                   | Total de envíos en el período                          |
| `by_status`       | map[string]int        | Cantidad de envíos agrupados por estado                |
| `by_day`          | map[string]int        | Cantidad de envíos creados agrupados por día           |
| `by_day_delivered`| map[string]int        | Cantidad de envíos entregados agrupados por día        |

### Nueva estructura sugerida (a implementar)

| Campo                     | Tipo           | Descripción                                                |
|---------------------------|----------------|------------------------------------------------------------|
| `avg_cycle_time_hours`    | float          | Tiempo promedio desde creación hasta entrega (en horas)   |
| `success_rate`            | float          | Porcentaje de entregas exitosas sobre el total             |
| `open_incidents`          | int            | Cantidad de incidentes abiertos en el período              |
| `by_branch`               | map[string]int | Total de envíos agrupados por sucursal                     |
| `recent_shipments`        | Shipment[]     | Últimos 5 envíos creados (ordenados por fecha descendente) |

---

## Reglas de negocio

1. El endpoint `GET /api/v1/shipments/stats` está disponible para roles `supervisor`, `manager` y `admin`.
2. Si el usuario es `supervisor` y tiene `branch_id`, el servidor filtra automáticamente por su sucursal (el parámetro `branch_id` enviado por el frontend se ignora para este rol).
3. El Gerente puede ver datos de todas las sucursales. No tiene restricción de sucursal.
4. El dashboard no expone datos personales (Ley 25.326). Los listados expandidos en drill-down deben cumplir con las mismas restricciones que `US-074`.
5. La exportación a PDF debe preservar los filtros activos al momento de la exportación.

---

## Especificación UX — Dashboard Gerencial

### Layout general

El dashboard se compone de las siguientes secciones, de arriba a abajo:

1. **Header**: Título "Dashboard" + selector de sucursal (solo manager/admin) + selector de período.
2. **Fila de KPIs principales**: 4 tarjetas (Total, En curso, Entregados, Problemas).
3. **Gráfico de tendencia**: Envíos creados vs entregados por día (barras agrupadas).
4. **Distribución por estado**: Grilla de tarjetas cliqueables, una por estado.
5. **Envíos recientes**: Tabla con los últimos 5 envíos creados.

### Navegación — Landing page

El dashboard es la pantalla principal del Gerente. Al iniciar sesión:
- Si el rol es `manager`, el frontend redirige automáticamente a `/dashboard`.
- El enlace "Dashboard" en la navegación tiene active state.

### Filtros

| Filtro     | Control                 | Comportamiento                                       |
|------------|-------------------------|-------------------------------------------------------|
| Período    | Date Range Picker       | Por defecto: últimos 30 días. Todos los KPIs se actualizan al cambiar. |
| Sucursal   | Dropdown con búsqueda   | Por defecto: "Todas las sucursales". Disponible solo para manager/admin. |

Los filtros son globales: al cambiar cualquier filtro, todas las secciones del dashboard se actualizan en simultáneo. No hay botón "Aplicar".

### Drill-down — 3 capas

| Capa | Descripción |
|------|-------------|
| **Capa 1** | Dashboard con KPIs, gráficos y tabla de recientes. |
| **Capa 2** | Al hacer clic en un KPI o en el gráfico, se navega a una vista de detalle del KPI (tabla con desglose por sucursal). |
| **Capa 3** | Al hacer clic en una sucursal dentro de la Capa 2, se navega al listado de envíos (`/`) pre-filtrado por sucursal y período. |

**Regla de navegación**: El breadcrumb en la parte superior permite volver al nivel anterior: `Dashboard > Volumen del Mes > CABA`.

### Exportación

| Formato | Contenido |
|---------|-----------|
| **PDF** | Layout A4 apaisado con todos los widgets del dashboard + filtros aplicados + fecha de generación. |
| **Excel** | Una hoja por widget con datos subyacentes. Sin datos personales (Ley 25.326). |

Botón "Exportar" en la esquina superior derecha con dropdown de formato.

---

## Escenarios

### CA1 — Gerente inicia sesión y ve el dashboard como landing

- **Dado** que el usuario tiene rol `manager` y está autenticado
- **Cuando** el frontend carga después del login
- **Entonces** redirige automáticamente a `/dashboard`
- **Y** el enlace "Dashboard" en la navegación aparece con active state

### CA2 — Dashboard muestra KPIs correctos

- **Dado** que el Gerente está en `/dashboard`
- **Cuando** los datos se cargan correctamente
- **Entonces** se muestran 4 tarjetas de KPI: Total de envíos, En curso, Entregados, Problemas
- **Y** los valores corresponden al período por defecto (últimos 30 días, todas las sucursales)

### CA3 — Gerente filtra por sucursal

- **Dado** que el Gerente está en `/dashboard`
- **Cuando** selecciona una sucursal en el dropdown de filtro
- **Entonces** todos los KPIs y gráficos se actualizan mostrando datos de esa sucursal
- **Y** la URL no cambia (el filtro es local)

### CA4 — Gerente filtra por período

- **Dado** que el Gerente está en `/dashboard`
- **Cuando** cambia el rango de fechas en el Date Range Picker
- **Entonces** todos los KPIs y gráficos se actualizan para el nuevo período

### CA5 — Drill-down de KPI a detalle

- **Dado** que el Gerente está en `/dashboard`
- **Cuando** hace clic en la tarjeta "Entregados"
- **Entonces** navega a una vista de detalle que muestra el desglose de entregados por sucursal en una tabla
- **Y** el breadcrumb muestra `Dashboard > Entregados`

### CA6 — Drill-down de sucursal a listado de envíos

- **Dado** que el Gerente está en la vista de detalle de un KPI
- **Cuando** hace clic en una sucursal de la tabla
- **Entonces** navega al listado de envíos (`/`) pre-filtrado por esa sucursal
- **Y** los filtros de fecha del dashboard se mantienen aplicados en el listado

### CA7 — Exportar dashboard a PDF

- **Dado** que el Gerente está en `/dashboard`
- **Cuando** hace clic en "Exportar > PDF"
- **Entonces** se descarga un archivo PDF con la composición actual del dashboard
- **Y** el PDF incluye los filtros activos en el encabezado

### CA8 — Exportar dashboard a Excel

- **Dado** que el Gerente está en `/dashboard`
- **Cuando** hace clic en "Exportar > Excel"
- **Entonces** se descarga un archivo `.xlsx` con los datos subyacentes del dashboard
- **Y** no se incluyen datos personales (Ley 25.326)

### CA9 — Dashboard sin datos

- **Dado** que el Gerente está en `/dashboard`
- **Y** no hay envíos en el período seleccionado
- **Cuando** se cargan los datos
- **Entonces** se muestran tarjetas con valor `0`
- **Y** el gráfico de tendencia aparece vacío con la leyenda "No hay datos para el período seleccionado"

### CA10 — Error al cargar datos del dashboard

- **Dado** que el Gerente está en `/dashboard`
- **Cuando** el servidor responde con error
- **Entonces** las tarjetas muestran `—` (guión) en lugar de valores
- **Y** se muestra un mensaje de error no bloqueante: "No se pudieron cargar los datos. Intentá de nuevo más tarde."

### CA11 — Dashboard en mobile

- **Dado** que el Gerente accede desde un dispositivo con ancho ≤ 768px
- **Cuando** carga `/dashboard`
- **Entonces** las 4 tarjetas de KPI se apilan en 2 columnas
- **Y** la tabla de envíos recientes tiene scroll horizontal
- **Y** el selector de sucursal se muestra como dropdown de ancho completo

### CA12 — Supervisor ve el dashboard con sucursal fija

- **Dado** que el usuario tiene rol `supervisor` con `branch_id` asignado
- **Cuando** navega a `/dashboard`
- **Entonces** los datos están filtrados automáticamente a su sucursal
- **Y** el selector de sucursal no aparece (se muestra un badge fijo con el nombre de la sucursal)

---

## Notas de implementación

### Backend

1. El endpoint `GET /api/v1/shipments/stats` ya existe y retorna `total`, `by_status`, `by_day`, `by_day_delivered`. No requiere cambios significativos.
2. Para la Capa 2 (detalle de KPI por sucursal), se sugiere un nuevo endpoint `GET /api/v1/shipments/stats/detail?kpi={kpi}&date_from=...&date_to=...` que retorne el desglose por sucursal.
3. El filtro por sucursal (`branch_id`) ya está implementado en el backend.

### Frontend

1. El dashboard actual (`pages/Dashboard.tsx`) ya implementa KPIs, gráfico SVG y tabla de recientes. La mejora consiste en:
   - Agregar la página de detalle de KPI (Capa 2).
   - Implementar exportación PDF/Excel.
   - Mejorar el gráfico con una librería profesional (Recharts).
   - Agregar skeleton loading.
2. La navegación con drill-down usa `useNavigate` con query params para mantener el contexto.
3. El breadcrumb es un nuevo componente a crear (`Breadcrumb`).
4. La exportación PDF puede usar `html2canvas` + `jspdf` o una librería equivalente. La exportación Excel puede usar `xlsx` (SheetJS).
