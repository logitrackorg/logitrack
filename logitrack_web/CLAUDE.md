# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Dev server at http://localhost:5173
npm run build     # tsc -b (type-check) + Vite production build — use to validate TS
npm run lint      # ESLint on all .ts/.tsx files
npm run preview   # Preview production build
```

No test framework is installed. **`npm run build` is the required validation step before marking any frontend change as done** — it runs `tsc -b` (type-check) + Vite build and will catch type errors and broken imports.

`VITE_API_URL` overrides the default API base (`http://localhost:8080/api/v1`).

## Architecture

```
src/
  api/            # Axios clients: shipments.ts, auth.ts, branches.ts, driver.ts, users.ts, customers.ts, vehicles.ts, mlConfig.ts
                  # shipments.ts has request interceptor (adds Bearer token) and
                  # response interceptor (redirects to /login on 401)
  context/        # AuthContext — global auth state, persisted to localStorage
  components/     # ProtectedRoute (role guard), StatusBadge, PriorityBadge
  pages/          # One file per screen (including BranchList, DriverRoute, DriverShipmentDetail, VehicleList, VehicleStatus, VehicleAssignment, AvailableVehicles, MLConfig)
  utils/date.ts   # fmtDate / fmtDateTime — always use for dates (DD/MM/AAAA, es-AR locale)
```

## Key patterns

**Auth**: `AuthContext` reads token + user JSON from `localStorage` on mount. `useAuth()` exposes `user`, `login()`, `logout()`, and `hasRole(...roles)`. `ProtectedRoute` takes an optional `roles` prop — redirects unauthorized users to `/`.

**API clients**: Each Axios instance in `api/` reads the token from `localStorage` directly via a request interceptor (not from context). The shipments client also has a 401 response interceptor that clears storage and redirects to `/login`.

**Branches** are fetched from `GET /api/v1/branches` at runtime — never hardcoded in the frontend. The `branchLabel(city, branches)` helper in `api/branches.ts` maps a city string to a display name. In `RouteTimeline`, nodes show city + province directly from the branches array (not the display name). The `Branch` interface includes `address` (street, city, province, postal_code), `status` (activo/inactivo/fuera_de_servicio), `created_at`, `updated_at`, and `updated_by`. Use `branchApi.listActive()` to get only active branches for dropdowns. Helpers `statusLabel()` and `statusColor()` are available in `api/branches.ts`.

**Role gates** (key examples):
- `+ New Shipment` button: hidden from managers
- Status update panel: supervisor + admin only
- Dashboard nav link: supervisor + manager + admin

## Screen → route map

| Route | Page | Roles |
|-------|------|-------|
| `/login` | Login | public |
| `/` | ShipmentList | all (non-driver) |
| `/new` | NewShipment | operator, supervisor, admin |
| `/shipments/:trackingId` | ShipmentDetail | all (non-driver) |
| `/dashboard` | Dashboard | supervisor, manager, admin |
| `/track` | PublicTracking | all |
| `/driver/route` | DriverRoute | driver |
| `/shipments/:trackingId` | DriverShipmentDetail | driver (misma URL, componente diferente al no-driver) |
| `/vehicles` | VehicleList | all (non-driver) |
| `/vehicles/:plate/status` | VehicleStatus | supervisor, manager, admin |
| `/vehicles/:plate/assign` | VehicleAssignment | supervisor, admin |
| `/vehicles/available` | AvailableVehicles | supervisor, manager, admin |
| `/branches` | BranchList | operator, supervisor, manager, admin |
| `/routing` | Routing (plan diario inteligente) | operator, supervisor |
| `/calendar` | TripsCalendar (calendario de viajes aplicados + planificados de hoy) | operator, supervisor, manager |
| `/routing-config` | RoutingConfig | admin |
| `/ml-config` | MLConfig | admin |
| `/system-config` | SystemConfig | admin |
| `/pricing-config` | PricingConfig | admin |

## Shipment status update rules

The status update form in `ShipmentDetail` conditionally shows fields based on the transition:

| Transition | Location / extra field |
|---|---|
| `at_origin_hub / at_hub → loaded` | Triggers vehicle picker (fleet-driven) |
| `in_transit → at_hub` | Auto-derived; display only |
| `at_hub → in_transit` | Not shown (fleet-driven via Start Trip) |
| `at_hub → out_for_delivery` | Driver selector (required) |
| `out_for_delivery → delivered` | Recipient DNI (required) |
| `out_for_delivery → delivery_failed` | Notes/motivo (required) |
| `ready_for_return → returned` | Sender DNI (required) |
| `delivery_failed → at_hub` | Auto-derived from last `at_hub` event; display only |

## Status code → UI label

Los códigos del backend (`loaded`, `out_for_delivery`, etc.) no cambian; solo el texto que ve el usuario operativo. Si renombrás una etiqueta hay que actualizarla en **todos** estos archivos para mantener consistencia: `components/StatusBadge.tsx`, `pages/ShipmentDetail.tsx` (`STATUS_LABELS` + título del modal de asignación de vehículo), `pages/ShipmentList.tsx` (`<option>` del filtro + `actionLabel` del bulk + botón "Asignar a…"), `pages/Dashboard.tsx` (`statusConfig` + `hint` de la tarjeta "En curso").

Etiquetas vigentes para estados que fueron renombrados:

| Código | Etiqueta UI |
|---|---|
| `loaded` | **Cargado en vehículo** |
| `out_for_delivery` | **Última milla** (antes "En reparto") |

`PublicTracking.tsx` mantiene su propia redacción amigable para clientes finales ("Cargado y listo para despachar", "En camino a domicilio") y queda fuera de este mapeo (excepto el override del badge — ver abajo).

### Override de etiqueta por envío

Cuando la etiqueta depende de un dato del envío (no solo del código de estado), la regla vive en `utils/shipmentStatus.ts → shipmentStatusLabelOverride(shipment)` y se pasa al badge como prop opcional `label`. **No duplicar la comparación en cada call site.**

| Código | Condición | Etiqueta override |
|---|---|---|
| `at_hub` | `current_location === final_branch_id` (sucursal final del envío) | "En sucursal de destino" |

Para envíos `at_hub` en sucursales intermedias, el badge sigue mostrando "En sucursal" (default).

Call sites que pasan el override hoy: `ShipmentList`, `ShipmentDetail`, `Dashboard`, `DriverRoute`, `DriverShipmentDetail`, `PublicTracking`. Cualquier nuevo lugar que renderice `<StatusBadge>` para un envío específico debe pasar `label={shipmentStatusLabelOverride(shipment)}`.

See the parent `../CLAUDE.md` for the full backend architecture, shipment state machine, and hardcoded user credentials.
