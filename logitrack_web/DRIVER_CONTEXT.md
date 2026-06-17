# LogiTrack — Driver Context (Mobile APK)

Pegá este archivo al inicio de cualquier prompt sobre el subsistema mobile del chofer (APK Capacitor, viewport 390px).

> **Versión**: 1.0 — junio 2026
> **Cobertura**: 6 páginas, 5 componentes exclusivos, 2 APIs driver, 4 hooks
> **Ubicación sugerida para el APK**: Copiar a `logitrack_web/DRIVER_CONTEXT.md` via `cp .omo/context/driver-reference.md logitrack_web/DRIVER_CONTEXT.md`

---

## 1. Stack

Comparte el stack del frontend web (React 19, TypeScript 5, Vite 7, Tailwind v4, shadcn/ui, lucide-react, Plus Jakarta Sans, Axios, `cn()`, `fmtDate`/`fmtDateTime`). Lo específico del driver:

- **Shell**: `DriverShell` (DriverNav + main + safe-area). Sin Sidebar ni Topbar.
- **Mapas**: Leaflet (`MapView`, OSRM routing) — solo en DriverRoute y DriverInterBranchTrip.
- **QR**: `Html5Qrcode` — solo en DriverScanVehicle y QRModal de DriverInterBranchTrip.
- **Geolocalización**: `useGeolocation` (real/simulado), `useCurrentSpeed`.

---

## 2. Design Tokens usados

```
--sidebar-bg     → fondo DriverNav (#1e3a5f)
--bg-page        → fondo de página
--bg-card        → cards, inputs, sheets
--bg-muted       → skeletons, disabled
--bg-subtle      → secciones secundarias
--bg-hover       → hover states
--text-primary   → texto principal
--text-secondary → texto secundario
--text-muted     → placeholders, hints
--text-strong    → labels, subtítulos
--border         → bordes cards/inputs
--brand          → CTA, links activos, elementos destacados
--brand-tint     → badges info
--ok / --ok-text → éxito
--danger-c / --danger-text / --danger-bg / --danger-border → error
--warn / --warn-text / --warn-bg / --warn-border → advertencia
--info-text / --info-bg / --info-border → información
```

**NO usar** en el subsistema driver: `--topbar-bg`, `--text-heading`, `--sidebar-border`, `--sidebar-hover`, `--brand-strong`, `--accent*`.

---

## 3. Patrones Mobile Obligatorios

### Touch targets
```tsx
// MÍNIMO 44×44px en todo elemento interactivo
min-h-[44px] min-w-[44px]     // botones, links, chips
h-14                           // botones primarios (56px)
h-12                           // inputs, botones secundarios
```

### Tipografía
```tsx
text-base (16px)               // contenido principal, botones
text-sm (14px)                 // texto secundario
text-xs (12px)                 // hints, chips, badges
text-[11px]                    // tracking IDs, metadatos
font-bold                      // headings, CTAs
font-semibold                  // labels, subtítulos
```

### Safe area (Capacitor)
```tsx
// CTAs sticky al pie — DriverShell ya incluye:
pb-[calc(env(safe-area-inset-bottom,0px)+80px)]

// CTA sticky manual (en páginas sin DriverShell):
pb-[max(env(safe-area-inset-bottom,0px),12px)]
```

### Cards
```tsx
// Patrón estándar
<div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4 shadow-sm">

// Card muted (secundaria)
<div className="rounded-xl bg-[var(--bg-subtle)] border border-[var(--border)] p-3">

// Card con estado (warning)
<div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] p-4">
```

### Inputs
```tsx
<input className="w-full h-12 px-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:border-[var(--brand)]" />
```

### Botones (shadcn)
```tsx
import { Button } from "@/components/ui/button"

// Primario (emerald, entregas)
<Button className="w-full h-14 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-lg font-bold gap-2">

// Destructivo (rojo)
<Button variant="destructive" className="w-full h-14 rounded-xl bg-red-500 ...">

// Acento (naranja, escanear)
<Button variant="accent" className="w-full h-14 rounded-xl text-lg font-bold gap-2.5">

// Outline (cancelar, reintentar)
<Button variant="outline" className="w-full h-14 rounded-xl text-base font-semibold">
```

### Estados
```tsx
// Loading
<Loader2 className="w-12 h-12 text-[var(--brand)] animate-spin mx-auto mb-4" />

// Success
<CheckCircle2 className="w-16 h-16 text-[var(--ok)] mx-auto mb-4" />

// Error
<AlertCircle className="w-10 h-10 text-[var(--danger-c)]" />
<div className="rounded-2xl bg-[var(--danger-bg)] border border-[var(--danger-border)] ...">

// Warning
<AlertTriangle className="w-5 h-5 text-[var(--warn)]" />
<div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] ...">
```

### Skeleton (loading)
```tsx
// Patrón: divs con bg-[var(--bg-muted)] animate-pulse
<div className="h-7 w-28 rounded-full bg-[var(--bg-muted)] animate-pulse" />
<div className="h-6 w-3/5 rounded bg-[var(--bg-muted)] animate-pulse" />
```

---

## 4. Navegación y Shell

### DriverShell
```tsx
import { DriverShell } from "@/components/DriverShell"

<DriverShell title="Mi ruta" subtitle="10/06/2026">
  {/* contenido de página */}
</DriverShell>
```
- `title`: string requerido, va en DriverNav
- `subtitle`: string opcional (no se renderiza actualmente en DriverNav)
- Renderiza: `<DriverNav />` + `<main className="pb-[calc(env(safe-area-inset-bottom,0px)+80px)]">`

### DriverNav (`src/components/DriverNav.tsx`, 93 líneas)
- Fondo: `var(--sidebar-bg)`, height 56px, sticky top z-50
- Logo org vía `useOrganizationTheme()`
- 1 NavLink según `driver_type`: "Mi ruta" o "Mi viaje"
- ThemeToggle compact + username + Logout
- **No usa**: NotificationBell, título de página renderizado

### Rutas del chofer (`App.tsx:82-94`)
```
/driver/route           → DriverRoute (última milla)
/driver/trip             → DriverInterBranchTrip (intersucursal)
/driver/scan             → DriverScanVehicle (escanear QR)
/shipments/:trackingId   → DriverShipmentDetail
/profile                 → UserProfile (compartido)
*                        → Navigate a defaultPath
```
- **defaultPath**: intersucursal → `/driver/scan`, otros → `/driver/route`
- Sin `<main>` wrapper en App.tsx — cada página usa DriverShell internamente
- Sin Sidebar, sin Topbar, sin AppShell para roles driver

### Flujo de navegación
```
Login → /driver/scan (sin ruta) o /driver/route (ruta activa)
Scan → /driver/route (claim exitoso) o /driver/trip (intersucursal)
Route → /shipments/:id o /driver/scan (sin ruta)
Detail → /driver/route (back button)
Trip → /driver/scan (completado)
Profile → navigate(-1)
```

---

## 5. Páginas del Subsistema

### DriverScanVehicle (`src/pages/DriverScanVehicle.tsx`, 287 líneas)
**Propósito**: Punto de entrada — escanear QR del vehículo o ingresar patente.

**Early returns**: `showGate` → KssCheckIn overlay.

**Estados**: loading (Loader2 + "Escaneando…"), success (CheckCircle2 + navega en 1.8s), error (AlertCircle + Reintentar).

**Layout**: DriverShell "Escanear vehículo" + logo org centrado + input patente h-12 + OK h-12 + cámara QR.

**APIs**: `interBranchTripsApi.claimByVehicleQR()`, `driverApi.startRoute()`, `driverApi.getCheckinGateStatus()`.

---

### DriverRoute (`src/pages/DriverRoute.tsx`, 1076 líneas)
**Propósito**: Ruta de entregas del día para choferes de última milla.

**Early returns**: loading (RouteSkeleton), noRoute (Navigate a /driver/scan), midRouteCheckin (KssCheckIn), routeEffectivelyDone (RouteCompletedView con QR retorno).

**Layout**: DriverShell "Mi ruta" + progress bar + tabs (Pendientes/Completados) + toggle Lista/Mapa + ShipmentCards apilados o MapView + NextStopCard + ZoneAlert.

**Sheets**: DeliverSheet, FailedSheet, RejectedSheet (compartidos desde `src/components/driver/`).

**Subcomponentes inline**: ShipmentCard (~200L), RouteCompletedView (~130L), RouteSkeleton, TabButton, RouteStatusPill.

**APIs**: `driverApi.getRoute()`, `shipmentApi.deliver()`, `shipmentApi.updateStatus()`, `zoneApi.list()`, `interBranchTripsApi.getMyTrip()`.

---

### DriverShipmentDetail (`src/pages/DriverShipmentDetail.tsx`, 526 líneas)
**Propósito**: Detalle de un envío individual con acciones de entrega.

**Early returns**: loading (skeleton), error (mensaje + back button).

**Layout**: DriverShell "Detalle de envío" + back button sticky + status badge + recipient card + package details + sender info + CTA sticky con 3 botones.

**Sheets**: Los mismos 3 compartidos (DeliverSheet, FailedSheet, RejectedSheet).

**Speed gate**: `useCurrentSpeed` + `useGeolocation` — bloquea entregas a >5 km/h.

**APIs**: `shipmentApi.get()`, `shipmentApi.deliver()`, `shipmentApi.updateStatus()`, `driverApi.getRoute()`.

---

### DriverInterBranchTrip (`src/pages/DriverInterBranchTrip.tsx`, 1343 líneas)
**Propósito**: Viaje inter-sucursal con múltiples paradas para choferes intersucursales.

**Early returns**: midTripCheckin (KssCheckIn), loading (TripSkeleton), noTrip (NoTripView), completado (vista checkmark).

**Layout**: DriverShell "Mi viaje" + header patente/status + StepperBar horizontal + HeroNextStop con ETA + Leaflet map + paradas completadas (collapsible) + próximas paradas + CTA "Llegué — mostrar QR".

**QRModal**: Fullscreen con QR + polling de confirmación (4s interval).

**Overlays**: fatiga bloqueante, autorización supervisor, KssCheckIn.

**Subcomponentes inline**: StepperBar, HeroNextStop, QRModal, NoTripView, TripSkeleton.

**APIs**: `interBranchTripsApi` (getMyTrip, getQR, startTrip), `driverApi` (fatiga, check-in), `publicTrackingApi` (getBranches, getShipment).

---

### UserProfile (`src/pages/UserProfile.tsx`, 409 líneas)
**Propósito**: Perfil, cambio de contraseña, historial de fatiga. **Compartido con roles internos.**

**Tabs**: "Mi Perfil", "Seguridad", "Historial de Fatiga" (solo driver).

**Layout**: `p-6 max-w-2xl mx-auto` con sidebar de tabs (220px fijos). **No usa DriverShell.**

**Problemas mobile**: Sidebar tabs no responsive, tabla de historial requiere scroll horizontal, botones `bg-[var(--sidebar-bg)]` estilo desktop.

**APIs**: `usersApi.getMe()`, `usersApi.changePassword()`, `driverApi.getPersonalHistory()`, `driverApi.requestHistory()`.

---

## 6. Componentes

### Exclusivos del driver (creados en feature/ux-driver)

| Componente | Archivo | Líneas |
|---|---|---|
| `DriverShell` | `components/DriverShell.tsx` | 18 |
| `DriverNav` | `components/DriverNav.tsx` | 93 |
| `DeliverSheet` | `components/driver/DeliverSheet.tsx` | 230 |
| `FailedSheet` | `components/driver/FailedSheet.tsx` | 116 |
| `RejectedSheet` | `components/driver/RejectedSheet.tsx` | 129 |

### Compartidos con internos (usar, no modificar)

| Componente | Archivo | Uso driver |
|---|---|---|
| `Button` | `ui/button.tsx` | Todas las páginas |
| `Card` | `ui/card.tsx` | DriverRoute, DriverInterBranchTrip |
| `Skeleton` | `ui/skeleton.tsx` | DriverInterBranchTrip |
| `BottomSheet` | `ui/bottom-sheet.tsx` | Usado por los 3 sheets |
| `StatusBadge` | `StatusBadge.tsx` | DriverShipmentDetail |
| `WhatsAppQuickButton` | `WhatsAppQuickButton.tsx` | DriverRoute, DriverShipmentDetail |
| `KssCheckIn` | `KssCheckIn.tsx` | DriverRoute, InterBranchTrip, ScanVehicle |
| `MapView` | `ui/MapView.tsx` | DriverRoute |
| `NextStopCard` | `ui/NextStopCard.tsx` | DriverRoute |
| `ZoneAlert` | `ui/ZoneAlert.tsx` | DriverRoute |
| `ThemeToggle` | `ThemeToggle.tsx` | DriverNav |

### Lo que NO existe en el subsistema driver
Sidebar, Topbar, NotificationBell, Breadcrumb, PageHeader, Section, DataTable, KPI strip, Export CSV, PriorityBadge (no usado por choferes), gráficos Recharts, calendario FullCalendar.

---

## 7. APIs y Hooks

### driverApi (`src/api/driver.ts`)
```
getRoute()                  → DriverRouteResponse { route, shipments, waypoints, origin }
startRoute()                → iniciar ruta del día
markRouteStarted()          → incrementar contador de rutas completadas hoy
getCheckinGateStatus()      → { needs_test, requires_sleep_data }
getTodayCheckin()           → { ok, requires_sleep_data }
getTestEligibility(params)  → { require_test } — misfires, stopped_minutes, checkpoint
resetMisfires()             → limpiar contador post-entrega
submitTouchEvent(payload)   → tracking_id, action, reaction_time_ms, misfires
getFatigueBlockStatus()     → { blocked, recently_unblocked, unblocked_by, unblocked_at }
getPersonalHistory()        → PersonalHistoryResult (UserProfile)
requestHistory()            → solicitar acceso a historial (UserProfile)
fastForwardCheckinTime()    → DEV: adelantar reloj de check-in
```

### interBranchTripsApi (`src/api/interBranchTrips.ts`)
```
getMyTrip()                 → InterBranchTrip activo
claimByVehicleQR(token)     → claim viaje por QR o patente
getQR(tripId)               → { qr_code_base64 }
startTrip(tripId)           → iniciar viaje inter-sucursal
```

### shipmentApi (usado por driver)
```
get(trackingId)             → Shipment
deliver(trackingId, params) → keyword, contingency, recipient_dni, current_speed
updateStatus(trackingId, p) → status, location, notes, recipient_dni, current_speed
```

### Hooks
```
useAuth()                   → user, token, hasRole(), login(), logout()
useOrganizationTheme()      → config { name, logo_url, sidebar_color }
useTheme()                  → theme, toggleTheme()
useIsMobile()               → boolean, viewport < 768px
useGeolocation(waypoints, mode?, speed?, proximity?) → position, mode, isPaused, stoppedTimeMs
useCurrentSpeed()           → speedKmh, locationReady, requestLocation
```

### Utils
```
recipientView(shipment)     → { name, phone, street, city, province, postal, fullAddress, specialInstructions }
timeWindowTone(tw)          → { bg, text, border } — morning/afternoon/flexible
TIME_WINDOW_LABEL           → { morning:"Mañana", afternoon:"Tarde", flexible:"Flexible" }
FAILED_REASONS              → [{ id, label }] — 4 motivos
REJECTED_REASONS            → [{ id, label, icon }] — 6 motivos
haversineKm(a, b)           → distancia en km
cityAbbrev(city)            → "Ciudad de Buenos Aires" → "CABA"
shipmentStatusLabelOverride → label contextual para StatusBadge
isInDangerZone(lat, lng, zones) → punto en polígono
```

---

## 8. Reglas de Estilo

### ✅ HACER
- `var(--token)` para colores que cambian con tema
- `dark:` variants de Tailwind para overrides dark mode
- shadcn `<Button>` para toda acción (nunca `<button>` raw)
- lucide-react para todo ícono (nunca emoji ni SVG inline)
- `min-h-[44px]` en todo elemento clickeable/tappeable
- `h-14` en botones primarios, `h-12` en inputs
- `rounded-xl` en cards y botones
- `whitespace-nowrap` en textos del footer/header para prevenir wrapping durante animaciones
- `truncate` en textos que pueden exceder el viewport 390px
- `fmtDate()`/`fmtDateTime()` para fechas
- `cn()` para clases condicionales
- Español (Argentina) en todo texto de UI

### ❌ NO HACER
- `style={{}}` inline (salvo valores de layout calculados en runtime)
- Hex colors hardcodeados (`#1e3a5f`, `#ffffff`)
- Clases CSS legacy (`.btn`, `.card`, `.badge`, `.modal`, `.input`)
- `driver-input` CSS class (eliminada del subsistema driver)
- `<button>` raw para acciones (usar shadcn `<Button>`)
- Emojis como iconos
- `var(--topbar-bg)` en driver (usar `var(--sidebar-bg)`)
- `var(--brand-800)` — token inexistente
- Tablas horizontales (mobile: cards apiladas, no tablas)
- `.toLocaleDateString()` — usar `fmtDate()`
- `any` en TypeScript
- Íconos que no sean de lucide-react
- NotificationBell (choferes no tienen notificaciones in-app)
