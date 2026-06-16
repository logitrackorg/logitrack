# LogiTrack — UI Context Toolkit

Pegá este archivo completo al inicio de cualquier prompt cuando le pidas a la IA componentes o pantallas del frontend.

> **Versión**: 3.0 — auditado 2026-06-08
> **Cobertura**: 71 páginas, 63 componentes, 35 módulos API, 17 utilidades

---

## 1. Stack tecnológico

- **Framework**: React 19 + TypeScript 5 + Vite 7
- **Estilos**: Tailwind CSS v4 (utility classes) + CSS custom properties (`var(--token)` en `src/index.css`)
- **Componentes UI**: shadcn/ui (Radix + Nova preset) — usar siempre que exista el componente
- **Iconos**: `lucide-react` — nunca emojis ni SVG inline
- **Tipografía**: Plus Jakarta Sans Variable (`@fontsource-variable/plus-jakarta-sans`)
- **HTTP**: Axios (con interceptor Bearer en `src/api/shipments.ts`)
- **Fechas**: `fmtDate` / `fmtDateTime` / `fmtRelative` / `fmtMinutesAsTime` / `fmtDuration` de `src/utils/date.ts` — formato DD/MM/AAAA — **NUNCA** usar `.toLocaleDateString()` directamente
- **Auth**: `useAuth()` → provee `user`, `token`, `hasRole()`, `login()`, `logout()`
- **Tema**: `useTheme()` → `theme`, `toggleTheme()`, `setTheme()`, `isSystem`
- **Tema organizacional**: `useOrganizationTheme()` → branding dinámico por organización
- **Idioma UI**: Español (Argentina) — todo label, placeholder, mensaje de error y botón va en español
- **Responsive**: `useIsMobile()` de `src/hooks/useIsMobile`
- **Gráficos**: Recharts (Gauge, Doughnut, Sparkline) — `src/components/charts/`
- **Mapas**: Leaflet (driver route, inter-branch) — `src/components/ui/MapView.tsx`
- **Calendario**: FullCalendar (viajes, pronósticos) — `src/components/calendar/`
- **Clases condicionales**: `cn()` de `@/lib/utils`
- **Exportación**: jsPDF + xlsx (PDF/Excel desde dashboard) — `src/utils/exportHelpers.ts`

---

## 2. Jerarquía de estilos (REGLA DE ORO)

```
shadcn/ui > Tailwind utilities > CSS custom properties > inline styles
```

1. Si shadcn/ui tiene el componente, **usalo** (Button, Card, Skeleton, Dialog).
2. Si no, usá **Tailwind utilities** con variantes `dark:`.
3. Para valores que cambian con el tema, usá **`var(--token)`** (ej: `color: "var(--text-primary)"`).
4. **NUNCA** usar `style={{}}` inline salvo para valores de layout calculados en runtime.
5. **NUNCA** usar las clases CSS legacy (`.btn`, `.card`, `.badge`, `.table`, `.modal`, `.alert`, `.input`).

---

## 3. Estructura de carpetas

```
src/
  api/                     # 35 módulos Axios — ver sección 14
    auth.ts                # Axios base + tipos User/Role
    shipments.ts           # Cliente principal (Bearer + redirect 401 → /login)
    publicTracking.ts      # Sin auth, para /api/v1/public/*
    branches.ts            # branchApi.list(), listActive(), branchLabel()
    vehicles.ts            # CRUD + fleet ops (assign, start/end trip, QR)
    users.ts               # Perfil + listDrivers()
    admin.ts               # Admin CRUD de usuarios
    driver.ts              # Driver route, check-in (KSS/PVT/voice), test eligibility
    routing.ts             # Plan diario, regen, apply, config, recompute
    interBranchTrips.ts    # Viajes inter-sucursal (driver + operador + calendar)
    mlConfig.ts            # Config ML + regenerate + activate
    pricing.ts             # Quote + config admin
    customers.ts           # Autocomplete por DNI
    payments.ts            # MercadoPago / cash / transferencia
    reports.ts             # 9 endpoints de stats (drivers, incidents, billing, ranking...)
    autoReports.ts         # Reportes automáticos programados
    notifications.ts       # Notificaciones in-app (SSE-based)
    slaMetrics.ts          # Métricas de SLA
    slaSettings.ts         # Config SLA (admin)
    priorityLogs.ts        # Log de cambios de prioridad
    supervisorFatigue.ts   # Dashboard de fatiga (supervisor)
    fatigueConfig.ts       # Config de fatiga (admin)
    routingForecast.ts     # Forecast + rolling horizon
    routingMetrics.ts      # Métricas de ruteo observability
    branchGraph.ts         # Grafos de sucursales (edges, derive)
    systemConfig.ts        # Config del sistema (max attempts, retention...)
    organizationApi.ts     # Branding organizacional (public + admin)
    zones.ts               # CRUD de zonas de peligro
    clock.ts               # Admin clock override
    qrService.ts           # QR de envíos
    accessLog.ts           # Log de acceso (admin)
    claims.ts              # Gestión de reclamos (admin/ops)
    chatbot.ts             # Chatbot público (auth, pickup, reschedule, claim)
    two-fa.ts              # 2FA setup/verify/disable
    passwordReset.ts       # Reset de contraseña (fetch sin axios)
  context/
    AuthContext.tsx         # user, token, hasRole(), login(), logout()
    ThemeContext.tsx         # theme, toggleTheme(), setTheme(), isSystem
    OrganizationThemeContext.tsx  # config, loading, refreshTheme(), resetTheme()
  components/
    ProtectedRoute.tsx      # Route guard con roles
    StatusBadge.tsx         # badge de estado de envío — NO recrear
    PriorityBadge.tsx       # badge de prioridad IA — NO recrear
    ZoneBadge.tsx           # badge de tipo de zona (entrada/salida/revisión/devolución)
    Sidebar.tsx             # navegación lateral (rail/expandido, mobile drawer)
    Topbar.tsx              # barra superior con glass effect
    Toast.tsx               # ToastContainer — ya montado en App.tsx
    ThemeToggle.tsx          # switch light/dark animado
    NotificationBell.tsx     # campana SSE con panel desplegable
    Breadcrumb.tsx           # breadcrumb con ChevronRight
    AddressAutocomplete.tsx  # autocompletado de direcciones (Nominatim, OSM)
    ShipmentQRModal.tsx      # modal con QR + print/download (usa shadcn Dialog)
    ShipmentInfoModal.tsx    # modal read-only con datos completos del envío
    ShipmentKPIStrip.tsx     # tira horizontal de KPIs (en tránsito, en sucursal, SLA, demoras)
    ShipmentTripGroups.tsx   # agrupación de envíos por viaje (vehículo) con progreso
    PlannedPathStepper.tsx   # stepper visual de ruta planificada
    PaymentMethodsPanel.tsx  # selección de método de pago (MP/cash/transfer)
    ReportFilters.tsx        # barra de filtros con selector de sucursal y fechas
    ReportExport.tsx         # dropdown de exportación (PDF/Excel)
    EditDriverStopsModal.tsx # modal fullscreen para reordenar paradas de última milla
    ReviewInterBranchModal.tsx # modal para revisar despacho inter-sucursal
    SupervisorFatigueGuard.tsx # polling + modal bloqueante de alertas de fatiga
    TwoFAGuard.tsx            # redirect si requiere 2FA no configurado
    KssCheckIn.tsx            # multi-step KSS check-in (sueño, KSS, voz, PVT)
    PVTCheckIn.tsx            # test psicomotor de vigilancia (15s reaction)
    VoiceCheckIn.tsx          # grabación de voz para análisis de fatiga
    toparContext.tsx          # TopbarProvider + TopbarActions (portal al Topbar)
    sidebarLayout.ts          # useSidebarOffset() + constantes de layout
    PublicClaimFormFields.tsx # campos del form público de reclamo
    ui/
      button.tsx              # <Button> — shadcn/ui (7 variants, 9 sizes)
      card.tsx                # <Card>, <CardHeader>, <CardTitle>, <CardContent>, <CardFooter>
      dialog.tsx              # <Dialog>, <DialogContent>, <DialogHeader>, <DialogTitle>
      skeleton.tsx            # <Skeleton>, <SkeletonLine>, <SkeletonCard>, <SkeletonCircle>
      stat-card.tsx           # <StatCard> — KPI tile con tono semántico
      page-header.tsx         # <PageHeader> — título de página con ícono y acciones
      section.tsx             # <Section> — agrupación visual con título
      gradient-card.tsx       # <GradientCard> — card con gradiente corporativo
      alert-banner.tsx        # <AlertBanner> — tira de notificación coloreada
      event-timeline.tsx      # <EventTimeline> — timeline vertical de eventos
      confirm-dialog.tsx      # <ConfirmDialog> — modal de confirmación con textarea
      bottom-sheet.tsx        # <BottomSheet> — modal mobile-optimizado
      select-menu.tsx         # <SelectMenu> — dropdown personalizado (reemplaza select nativo)
      data-table.tsx          # <DataTable> — tabla responsive con skeleton + empty state
      empty-state.tsx         # <EmptyState> — placeholder con ícono + mensaje + acción
      form-field.tsx          # <FormField> — wrapper de campo con label + error + helper
      map-view.tsx            # <MapView> — Leaflet map + waypoints + GPS simulado
      next-stop-card.tsx      # <NextStopCard> — tarjeta de próxima parada (driver)
      zone-alert.tsx          # <ZoneAlert> — alerta de zona peligrosa (driver)
    charts/
      Gauge.tsx               # SVG semicircular gauge con umbrales
      Doughnut.tsx            # Recharts doughnut chart con overlay central
      Sparkline.tsx           # Recharts sparkline minimalista
    calendar/
      WeekCalendarView.tsx    # FullCalendar vista semanal (viajes + forecast)
      VehicleTimelineView.tsx # Gantt de vehículos por 24h
      tripEvents.ts           # helpers de conversión trip→FC event
    chatbot/
      ChatbotWidget.tsx       # widget flotante de asistente virtual
      ChatMessage.tsx         # burbuja de mensaje individual
      ChatInput.tsx           # input de chat con adjunto
  pages/                      # 71 pantallas (una por archivo)
    Login.tsx
    PublicTracking.tsx
    ShipmentList.tsx
    ShipmentDetail.tsx            # + 8 sub-componentes en ShipmentDetail/components/
    NewShipment.tsx
    Dashboard.tsx                 # alias → DashboardHost
    DashboardHost.tsx             # host con tabs lazy-loading
    KpiDetail.tsx
    Claims.tsx
    SlaAuditLogs.tsx
    SlaSettings.tsx
    Routing.tsx                   # motor dual: última milla + inter-sucursal
    Repartos.tsx                  # wrapper → Routing(mode="last_mile")
    InterSucursal.tsx             # wrapper → Routing(mode="inter_branch")
    NetworkPlanView.tsx           # vista de red (manager)
    RollingPlanView.tsx           # rolling horizon (manager)
    RoutingMetrics.tsx            # métricas de ruteo (admin)
    RoutingConfig.tsx             # config de ruteo (admin)
    MLConfig.tsx                  # config ML (admin)
    SystemConfig.tsx              # config del sistema (admin)
    PricingConfig.tsx             # config de pricing (admin)
    PaymentConfig.tsx             # config de pagos (admin)
    OrganizationConfig.tsx        # branding organizacional (admin)
    AdminUsers.tsx                # gestión de usuarios (admin)
    BulkUpload.tsx                # carga masiva CSV (ops/sup)
    AccessLog.tsx                 # logs de acceso (admin)
    DraftList.tsx                 # lista de borradores (ops/sup)
    ZoneManagement.tsx            # zonas de peligro (admin)
    FatigueConfig.tsx             # config de fatiga (admin)
    SupervisorFatigue.tsx         # dashboard fatiga (sup/manager)
    AutoReports.tsx               # reportes automáticos (manager)
    NotificationsPage.tsx         # bandeja de notificaciones
    UserProfile.tsx               # perfil + cambio de contraseña
    BranchList.tsx                # sucursales (sup/manager/admin)
    VehicleList.tsx               # flota (ops/sup/manager/admin) + VehicleDetailModal
    VehicleStatus.tsx             # detalle de vehículo (sup/admin)
    VehicleAssignment.tsx         # asignación de vehículo (sup/admin)
    AvailableVehicles.tsx         # vehículos disponibles (sup/admin)
    DriverRoute.tsx               # ruta del día (driver)
    DriverInterBranchTrip.tsx      # viaje inter-sucursal (driver)
    DriverScanVehicle.tsx          # escaneo QR vehículo (driver)
    DriverShipmentDetail.tsx       # detalle de envío (driver)
    TripsCalendar.tsx              # calendario de viajes (ops/sup/manager)
    InterBranchTripsList.tsx       # lista de viajes (ops/sup/manager)
    OperatorTripReception.tsx      # recepción de viaje (ops/sup)
    NetworkHub.tsx                 # hub de red (manager/admin)
    AdminRoutingHub.tsx            # hub de ruteo admin
    BranchGraphAdmin.tsx           # grafo de sucursales (admin)
    TwoFAVerify.tsx                # verificación 2FA
    TwoFASetup.tsx                 # setup 2FA
    TwoFASetupRequired.tsx         # setup 2FA obligatorio
    ReportsTab/* (12 tabs)         # pestañas de reportes lazy
  hooks/
    useIsMobile.ts         # hook responsive (breakpoint configurable)
    useShipments.ts        # SWR-based data fetching para lista de envíos
    useGeolocation.ts      # GPS driver (real/simulado/fijo)
    useCurrentSpeed.ts     # lectura de velocidad del dispositivo
    useOptimisticUpdate.ts # optimistic UI con rollback
    useTopbarSlot.ts       # registro del slot del Topbar
  utils/
    date.ts               # fmtDate, fmtDateTime, fmtRelative, fmtMinutesAsTime, fmtDuration
    toast.ts              # addToast(type, message)
    shipmentStatus.ts     # shipmentStatusLabelOverride(shipment)
    vehicleStatus.ts      # vehicleStatusLabel(), vehicleStatusColor()
    badgeTone.ts          # softBadgeStyle() — tintes semánticos
    errors.ts             # extractErrorMessage()
    geo.ts                # haversineKm(), findFinalBranch()
    exportHelpers.ts      # exportToPDF(), exportToExcel()
    driverActions.ts      # WhatsApp helpers, TIME_WINDOW_LABEL, FAILED_REASONS
    dashboard.tsx         # toDateInput(), defaultRange(), Skeleton
    routingEta.ts         # recomputeETA() — cálculo de horarios de llegada
    pointInPolygon.ts     # isInDangerZone() — ray-casting
    googleMaps.ts         # googleMapsRoute(), googleMapsSingleStop()
    printShipmentDocument.ts  # impresión de hoja de envío
    groupShipmentsByTrip.ts   # agrupación por viaje
    devicePermissions.ts      # permisos de dispositivo (driver)
    publicClaimForm.ts        # formulario de reclamo público
  lib/
    utils.ts              # cn() — className merger
```

---

## 4. Design Tokens

### Colores brand

| Token | Hex | Tailwind | Uso |
|-------|-----|----------|-----|
| `--brand` | `#2563eb` | `blue-600` | Links, focus rings, iconos activos |
| `--brand-strong` | `#1d4ed8` | `blue-700` | Botón primario bg, hover states |
| `--brand-tint` | `#eff6ff` | `blue-50` | Fondos info sutiles |
| `--brand-tint-border` | `#bfdbfe` | `blue-200` | Bordes de cards/alertas info |
| `--on-brand` | `#ffffff` | `white` | Texto sobre brand |

### Colores accent (naranja)

| Token | Hex | Tailwind |
|-------|-----|----------|
| `--accent` | `#f97316` | `orange-500` |
| `--accent-hover` | `#ea580c` | `orange-600` |
| `--accent-tint` | `#fff7ed` | `orange-50` |
| `--accent-tint-border` | `#fed7aa` | `orange-200` |

### Superficies

| Token | Light | Dark |
|-------|-------|------|
| `--bg-page` | `#f8fafc` | `#0b111f` |
| `--bg-card` | `#ffffff` | `#161f31` |
| `--bg-elevated` | `#ffffff` | `#1c2740` |
| `--bg-subtle` | `#f9fafb` | `#1b2436` |
| `--bg-muted` | `#f3f4f6` | `#202a3d` |
| `--bg-inset` | `#f1f5f9` | `#131c2e` |
| `--bg-hover` | `#f0f9ff` | `#1e2a40` |

### Texto

| Token | Light | Dark |
|-------|-------|------|
| `--text-primary` | `#111827` | `#e9eef6` |
| `--text-heading` | `#1e3a8f` | `#f1f5fb` |
| `--text-strong` | `#374151` | `#ccd6e6` |
| `--text-secondary` | `#6b7280` | `#99a6bb` |
| `--text-muted` | `#64748b` | `#6e7b91` |
| `--text-faint` | `#cbd5e1` | `#4f5d72` |

### Bordes

| Token | Light | Dark |
|-------|-------|------|
| `--border` | `#e5e7eb` | `#2a3650` |
| `--border-strong` | `#d1d5db` | `#3a4866` |
| `--border-subtle` | `#eef0f3` | `#222d44` |

### Estados semánticos

| Estado | Sólido | Texto | Fondo | Borde |
|--------|--------|-------|-------|-------|
| Éxito | `--ok: #10b981` | `--ok-text` | `--ok-bg` | `--ok-border` |
| Peligro | `--danger-c: #ef4444` | `--danger-text` | `--danger-bg` | `--danger-border` |
| Advertencia | `--warn: #f97316` | `--warn-text` | `--warn-bg` | `--warn-border` |
| Info | `--info: #3b82f6` | `--info-text` | `--info-bg` | `--info-border` |
| Púrpura | `--purple: #8b5cf6` | `--purple-text` | `--purple-bg` | `--purple-border` |

### Chrome

| Token | Light | Dark |
|-------|-------|------|
| `--sidebar-bg` | `#1e3a5f` | `#0c1424` |
| `--sidebar-border` | `#162d4a` | `#1c2842` |
| `--sidebar-hover` | `#2563eb` | `#1e40af` |
| `--topbar-bg` | `rgba(255,255,255,0.92)` | `rgba(13,20,34,0.82)` |

### Sombras

| Clase | Uso |
|-------|-----|
| `shadow-sm` | Cards default |
| `shadow` / `shadow-md` | Cards hover, dropdowns |
| `shadow-lg` | Modales |
| `shadow-xl` | Modales grandes |

### Border radius

| Clase | Valor | Uso |
|-------|-------|-----|
| `rounded-sm` | 4px | Badges, inputs |
| `rounded` / `rounded-md` | 6px | Botones sm, chips |
| `rounded-lg` | 10px | Botones default, inputs, selects |
| `rounded-xl` | 12px | Cards |
| `rounded-2xl` | 14px | Modales |

---

## 5. Paleta semántica — estados de envío

> Los colores de badge están definidos en `StatusBadge.tsx`. Usar siempre el componente, no recrear.

| `status` | Label UI | Color |
|----------|----------|-------|
| `draft` | Borrador | Gray |
| `pending_payment` | Pago pendiente | Gray |
| `at_origin_hub` | En sucursal origen | Amber |
| `loaded` | **Cargado en vehículo** | Indigo |
| `in_transit` | En tránsito | Blue (pulse animado) |
| `at_hub` | En sucursal | Violet |
| `out_for_delivery` | **Última milla** | Orange (pulse animado) |
| `delivery_failed` | Entrega fallida | Red |
| `redelivery_scheduled` | Reentrega programada | Yellow |
| `no_entregado` | No entregado | Pink |
| `rechazado` | Rechazado | Rose |
| `delivered` | Entregado | Emerald |
| `ready_for_pickup` | Listo para retiro | Sky |
| `ready_for_return` | Listo para devolución | Purple |
| `returned` | Devuelto | Slate |
| `cancelled` | Cancelado | Red |
| `lost` | Extraviado | Slate |
| `destroyed` | Daño total | Slate |
| `expired` | Borrador expirado | Gray |

### Override de etiqueta por envío

Definido en `utils/shipmentStatus.ts → shipmentStatusLabelOverride(shipment)`.

| Código | Condición | Etiqueta override |
|--------|-----------|-------------------|
| `at_hub` | `current_location === final_branch_id` | "En sucursal de destino" |

Siempre pasar `label={shipmentStatusLabelOverride(shipment)}` al `StatusBadge`.

---

## 6. Paleta semántica — prioridad IA

| `priority` | Color |
|------------|-------|
| `alta` | Red |
| `media` | Amber |
| `baja` | Gray |

Usar `<PriorityBadge priority={shipment.priority} />`.

---

## 7. Paleta semántica — roles de usuario

| Rol | Badge Tailwind |
|-----|----------------|
| `admin` | `bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300` |
| `supervisor` | `bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300` |
| `operator` | `bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300` |
| `driver` | `bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300` |
| `manager` | `bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300` |

---

## 8. Paleta semántica — vehículos

| `status` | Label | Badge |
|----------|-------|-------|
| `disponible` | Disponible | `bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300` |
| `en_carga` | En carga | `bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300` |
| `en_transito` | En tránsito | `bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300` |
| `mantenimiento` | Mantenimiento | `bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300` |
| `inactivo` | Inactivo | `bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-300` |

Helpers: `vehicleStatusLabel(status)`, `vehicleStatusColor(status)` en `utils/vehicleStatus.ts`.

---

## 9. Paleta semántica — sucursales

| `status` | Label | Badge |
|----------|-------|-------|
| `activo` | Activa | `bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300` |
| `inactivo` | Inactiva | `bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-300` |
| `fuera_de_servicio` | Fuera de servicio | `bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300` |

Helpers: `statusLabel(status)`, `statusColor(status)` en `api/branches.ts`.

### Zonas de sucursal (BranchZoneType)

| Tipo | Color |
|------|-------|
| `entrada` | Blue |
| `salida` | Green |
| `revision` | Amber |
| `devolucion` | Purple |

Usar `<ZoneBadge zone={shipment.zone} />`.

---

## 10. Componentes principales — uso obligatorio

### Button
```tsx
import { Button } from "@/components/ui/button"

<Button>Guardar</Button>
<Button variant="accent">Acción destacada</Button>
<Button variant="outline">Cancelar</Button>
<Button variant="secondary">Alternativa</Button>
<Button variant="destructive">Eliminar</Button>
<Button variant="ghost"><X size={16} /></Button>
<Button size="sm">Pequeño</Button>
<Button size="xs">Tabla</Button>
<Button size="lg">Grande</Button>
<Button size="icon" variant="ghost"><X size={16} /></Button>
<Button disabled={loading}>{loading ? <Spinner /> : "Enviar"}</Button>
```
**NO usar** `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` de index.css.

### Card
```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"

<Card variant="default">  {/* bg-white, shadow-sm */}
  <CardHeader>
    <CardTitle>Título</CardTitle>
    <CardDescription>Descripción opcional</CardDescription>
  </CardHeader>
  <CardContent>Contenido</CardContent>
  <CardFooter>Acciones</CardFooter>
</Card>

<Card variant="muted">  {/* bg-slate-50 */}
  ...
</Card>
```

### GradientCard
```tsx
import { GradientCard, GradientCardLabel, GradientCardValue, GradientCardIcon } from "@/components/ui/gradient-card"

<GradientCard tone="brand">  {/* brand | emerald | amber | rose */}
  <GradientCardLabel>Total facturado</GradientCardLabel>
  <GradientCardValue>$ 1.250.000</GradientCardValue>
  <GradientCardIcon><DollarSign size={20} /></GradientCardIcon>
</GradientCard>
```

### StatCard
```tsx
import { StatCard } from "@/components/ui/stat-card"

<StatCard
  label="En tránsito"
  value={shipments.in_transit}
  hint="+12% vs ayer"
  icon={<Truck size={18} />}
  tone="info"  {/* info | success | warning | danger */}
/>
```

### PageHeader
```tsx
import { PageHeader } from "@/components/ui/page-header"

<PageHeader
  title="Envíos"
  description="Gestión y seguimiento del flujo logístico"
  icon={<Package size={22} />}
  actions={<Button>+ Nuevo envío</Button>}
/>
```

### Section
```tsx
import { Section } from "@/components/ui/section"

<Section title="Datos del remitente" description="Información de contacto">
  {/* campos */}
</Section>
```

### StatusBadge
```tsx
import { StatusBadge } from "@/components/StatusBadge"
<StatusBadge status={shipment.status} label={shipmentStatusLabelOverride(shipment)} />
```

### PriorityBadge
```tsx
import { PriorityBadge } from "@/components/PriorityBadge"
<PriorityBadge priority={shipment.priority} />
```

### ZoneBadge
```tsx
import { ZoneBadge } from "@/components/ZoneBadge"
<ZoneBadge zone={shipment.zone} />
```

### Toast
```tsx
import { addToast } from "@/utils/toast"
addToast("success", "Envío actualizado correctamente.")
addToast("error", "No se pudo guardar el cambio.")
addToast("info", "Recordatorio: revisar envíos pendientes.")
addToast("warning", "El vehículo está cerca de su capacidad máxima.")
```

### Skeleton
```tsx
import { Skeleton, SkeletonLine, SkeletonCard, SkeletonCircle } from "@/components/ui/skeleton"

// Para página de detalle completa:
import { DetailPageSkeleton } from "@/components/ui/skeleton"
```

### Dialog
```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>
    <DialogHeader onClose={() => setIsOpen(false)}>
      <DialogTitle>Título del modal</DialogTitle>
    </DialogHeader>
    {/* contenido */}
    <DialogFooter>
      <Button variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
      <Button onClick={handleConfirm}>Confirmar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### ConfirmDialog
```tsx
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

<ConfirmDialog
  isOpen={showConfirm}
  title="Cancelar envío"
  description="¿Estás seguro? Esta acción no se puede deshacer."
  confirmLabel="Cancelar envío"
  variant="danger"  {/* danger | default */}
  showComment  {/* opcional: requiere motivo (min 15 chars) */}
  onConfirm={(comment?) => handleCancel(comment)}
  onCancel={() => setShowConfirm(false)}
/>
```

### AlertBanner
```tsx
import { AlertBanner } from "@/components/ui/alert-banner"

<AlertBanner
  variant="info"  {/* info | success | warning | danger */}
  title="Atención"
  description="Este envío tiene una incidencia activa."
  action={<Button size="sm" variant="outline">Resolver</Button>}
  onDismiss={() => setShowAlert(false)}
/>
```

### EventTimeline
```tsx
import { EventTimeline } from "@/components/ui/event-timeline"

<EventTimeline
  events={shipmentEvents}
  branches={branches}
  onClaimClick={(claimId) => navigate(`/claims/${claimId}`)}
/>
```

### EmptyState
```tsx
import { EmptyState } from "@/components/ui/empty-state"

<EmptyState
  icon={<Package size={48} />}
  title="No hay envíos"
  description="Creá tu primer envío para empezar."
  action={<Button>+ Nuevo envío</Button>}
/>
```

### DataTable
```tsx
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn } from "@/components/ui/data-table/types"

const columns: DataTableColumn<Shipment>[] = [
  { key: "tracking_id", header: "Tracking", render: (s) => <code>{s.tracking_id}</code> },
  { key: "status", header: "Estado", render: (s) => <StatusBadge status={s.status} /> },
]

<DataTable
  columns={columns}
  data={shipments}
  loading={isLoading}
  emptyMessage="No se encontraron envíos."
  onRowClick={(shipment) => navigate(`/shipments/${shipment.tracking_id}`)}
/>
```

### FormField
```tsx
import { FormField } from "@/components/ui/form-field"

<FormField label="Nombre del destinatario" required error={errors.name}>
  <input className="w-full px-3 py-2 rounded-lg border ..." />
</FormField>
```

### BottomSheet (mobile)
```tsx
import { BottomSheet } from "@/components/ui/bottom-sheet"

<BottomSheet open={isOpen} onClose={() => setIsOpen(false)} title="Detalle" description="Información adicional">
  {/* contenido */}
</BottomSheet>
```

### SelectMenu
```tsx
import { SelectMenu, SelectOption, SelectGroup } from "@/components/ui/SelectMenu"

<SelectMenu value={status} onChange={setStatus} placeholder="Seleccionar estado">
  <SelectGroup label="Activos">
    <SelectOption value="in_transit">En tránsito</SelectOption>
    <SelectOption value="at_hub">En sucursal</SelectOption>
  </SelectGroup>
</SelectMenu>
```

### Breadcrumb
```tsx
import { Breadcrumb, BreadcrumbItem } from "@/components/Breadcrumb"

<Breadcrumb>
  <BreadcrumbItem href="/">Envíos</BreadcrumbItem>
  <BreadcrumbItem>LT-A1B2C3D4</BreadcrumbItem>
</Breadcrumb>
```

### KPI Strip
```tsx
import { ShipmentKPIStrip } from "@/components/ShipmentKPIStrip"

<ShipmentKPIStrip
  shipments={shipments}
  onFilterClick={(status) => setFilter(status)}
  activeFilter={currentFilter}
/>
```

### Trip Groups
```tsx
import { ShipmentTripGroups } from "@/components/ShipmentTripGroups"

<ShipmentTripGroups
  groups={tripGroups}
  ungrouped={orphanShipments}
  selected={selectedIds}
  onSelect={setSelectedIds}
/>
```

### Gauge (charts)
```tsx
import { Gauge } from "@/components/charts/Gauge"

<Gauge
  value={78}
  min={0} max={100}
  thresholds={[
    { value: 60, color: "#ef4444", label: "Crítico" },
    { value: 80, color: "#f97316", label: "Precaución" },
    { value: 100, color: "#10b981", label: "Óptimo" },
  ]}
  label="Tasa de éxito"
  unit="%"
/>
```

---

## 11. State Management — Contexts

### Provider hierarchy (App.tsx)
```
ThemeProvider
  └── OrganizationThemeProvider
       └── AuthProvider
            └── BrowserRouter
                 └── TwoFAGuard
                      └── Routes
                           ├── /track → PublicTracking (no shell)
                           ├── /2fa/* → páginas 2FA (no shell)
                           └── * → AppRoutes
                                ├── driver → DriverNav + routes
                                ├── no user → Login
                                └── non-driver authenticated
                                     └── SupervisorFatigueGuard
                                          └── AppShell
                                               └── TopbarProvider
                                                    ├── Sidebar + Topbar
                                                    └── <main>
```

### AuthContext (`src/context/AuthContext.tsx`)
```typescript
const { user, token, login, logout, hasRole, setSession, setUser, setToken } = useAuth()

// user: User | null
// token: string | null
// hasRole("admin", "supervisor") → boolean
// login(username, password) → Promise<LoginResponse>
// logout() → void
```

Login response puede incluir `requires_2fa: true` → redirige a `/2fa/verify`.

### ThemeContext (`src/context/ThemeContext.tsx`)
```typescript
const { theme, toggleTheme, setTheme, isSystem } = useTheme()

// theme: "light" | "dark"
// isSystem: boolean — true cuando sigue la preferencia del OS
// toggleTheme() → flips light/dark
// setTheme("dark") → persiste en localStorage["theme:preference"]
```

Aplica clase `dark` en `<html>` y seteando `color-scheme`. Escucha cambios de `prefers-color-scheme` si `isSystem === true`.

### OrganizationThemeContext (`src/context/OrganizationThemeContext.tsx`)
```typescript
const { config, loading, refreshTheme, resetTheme } = useOrganizationTheme()

// config: OrganizationBranding | null (fetched de GET /public/organization)
// loading: boolean
// refreshTheme() → re-fetch + re-inyecta CSS vars en <html>
// resetTheme() → limpia CSS vars organizacionales
```

Inyecta dinámicamente `--brand-*`, `--accent-*`, `--sidebar-bg`, `--sidebar-border`, `--text-heading`, `--fc-button-*` (27 propiedades CSS). Usado por Sidebar para logo/nombre.

### TopbarContext (`src/components/topbarContext.tsx`)
```typescript
import { TopbarActions } from "@/components/topbarContext"

// Uso en páginas: inyectar acciones en el Topbar
<TopbarActions>
  <Button size="sm">Exportar</Button>
</TopbarActions>
```

Patrón de portal: el contenido se renderiza en el nodo del Topbar. Se limpia al desmontar la página. El `TopbarProvider` está dentro de `AppShell` (solo rutas no-driver).

---

## 12. Custom Hooks

| Hook | Archivo | Propósito |
|------|---------|-----------|
| `useAuth()` | `context/AuthContext.tsx` | Auth state + acciones (ver arriba) |
| `useTheme()` | `context/ThemeContext.tsx` | Tema light/dark (ver arriba) |
| `useOrganizationTheme()` | `context/OrganizationThemeContext.tsx` | Branding organizacional (ver arriba) |
| `useIsMobile(breakpoint?)` | `hooks/useIsMobile.ts` | `boolean` — true si viewport ≤ breakpoint (default 768px) |
| `useShipments(filters?)` | `hooks/useShipments.ts` | `{ shipments, isLoading, isError, error, mutate }` — SWR con 10s dedup |
| `useGeolocation(routePoints, mode?, speed?, deliveryPoints)` | `hooks/useGeolocation.ts` | `{ position, mode, isPaused, pause, play, reset }` — GPS con simulación |
| `useCurrentSpeed()` | `hooks/useCurrentSpeed.ts` | `{ speedKmh, locationReady, permissionDenied, requestLocation }` |
| `useOptimisticUpdate(updateFn, options?)` | `hooks/useOptimisticUpdate.ts` | `{ execute, isPending, error, clearError }` — optimistic UI con rollback |
| `useTopbarSlotRef()` | `hooks/useTopbarSlot.ts` | `(el: HTMLElement | null) => void` — callback ref para Topbar |
| `useSidebarOffset()` | `components/sidebarLayout.ts` | `number` — offset izquierdo del main (68px rail, 240px expanded, 0 mobile) |

### useGeolocation modos
- `"real"` — `navigator.geolocation.watchPosition` nativo
- `"fixed"` — coordenada estática desde `?gps=lat,lng` en la URL
- `"simulate"` — ruta simulada a lo largo de la polyline OSRM con auto-pausa cerca de puntos de entrega
- Configurable vía URL: `?gps=simulate&speed=60`

### useOptimisticUpdate patrón
```typescript
const { execute, isPending } = useOptimisticUpdate(
  async (data) => await shipmentApi.updateStatus(trackingId, data),
  { onRollback: (prev) => setLocalState(prev) }
)

// Uso:
await execute(
  { status: "delivered", recipient_dni: "12345678" },  // optimistic
  previousState  // para rollback en error
)
```

---

## 13. Patrones de código obligatorios

### Imports con alias `@`
```typescript
import { fmtDate, fmtDateTime, fmtRelative } from "@/utils/date"
import { useAuth } from "@/context/AuthContext"
import { useTheme } from "@/context/ThemeContext"
import { useOrganizationTheme } from "@/context/OrganizationThemeContext"
import { branchApi, branchLabel } from "@/api/branches"
import { StatusBadge } from "@/components/StatusBadge"
import { PriorityBadge } from "@/components/PriorityBadge"
import { PageHeader } from "@/components/ui/page-header"
import { cn } from "@/lib/utils"
```

### Fechas — SIEMPRE con formatters
```typescript
fmtDate(shipment.created_at)        // → "01/04/2026"
fmtDateTime(event.timestamp)        // → "01/04/2026 14:30"
fmtRelative(event.timestamp)        // → "hace 5 min" / "en 2 días"
fmtMinutesAsTime(570)               // → "09:30"
fmtDuration(135)                    // → "2h 15min"
```

### Auth
```typescript
const { user, hasRole } = useAuth()
if (hasRole("admin", "supervisor")) { /* ... */ }
```

### Branch labels — NUNCA hardcodear
```typescript
const branches = await branchApi.listActive()
branchLabel(city, branches)        // city → display name
branchLabelById(id, branches)      // id → display name
```

### Correcciones — valor corregido tiene precedencia
```typescript
const effectiveName = shipment.corrections?.recipient_name ?? shipment.recipient.name
```

### Conditional className
```typescript
import { cn } from "@/lib/utils"
className={cn("base-class", isActive && "active-class", className)}
```

### Dark mode — siempre incluir variante dark
```typescript
className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
```

### TopbarActions — portal al Topbar
```typescript
import { TopbarActions } from "@/components/topbarContext"
// Dentro de cualquier página dentro de AppShell:
<TopbarActions>
  <Button size="sm" onClick={handleExport}>Exportar CSV</Button>
</TopbarActions>
```

### Estructura de componente estándar
```typescript
interface MiComponenteProps {
  shipment: Shipment
  onUpdate?: () => void
}

export function MiComponente({ shipment, onUpdate }: MiComponenteProps) {
  // 1. hooks (useAuth, useIsMobile, useState, useEffect)
  // 2. estado local
  // 3. handlers
  // 4. return JSX
}
```

---

## 14. Patrones de UI

### Estados de carga
```tsx
{loading ? (
  <div className="space-y-4">
    <SkeletonLine />
    <SkeletonLine className="w-3/4" />
    <SkeletonCard />
  </div>
) : (
  <>{/* contenido real */}</>
)}
```

### Estados vacíos
```tsx
<EmptyState
  icon={<Package size={48} />}
  title="No hay envíos"
  description="Creá tu primer envío para empezar."
  action={<Button>+ Nuevo envío</Button>}
/>
```

### Estados de error
```tsx
<div className="text-center py-12">
  <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Error al cargar</h3>
  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{error.message}</p>
  <Button variant="outline" onClick={refetch}>Reintentar</Button>
</div>
```

### Inputs — patrón estándar
```tsx
<FormField label="Nombre del campo" required error={errors.field}>
  <input
    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700
               bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100
               placeholder:text-gray-400 focus:outline-none focus:ring-2
               focus:ring-blue-500 focus:border-blue-500 transition-all"
    placeholder="..."
    value={value}
    onChange={(e) => setValue(e.target.value)}
  />
</FormField>
```

### Modal / Dialog (con shadcn)
```tsx
<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>
    <DialogHeader onClose={() => setIsOpen(false)}>
      <DialogTitle>Título</DialogTitle>
    </DialogHeader>
    {/* contenido */}
    <DialogFooter>
      <Button variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
      <Button onClick={handleConfirm}>Confirmar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Table (con DataTable)
```tsx
const columns: DataTableColumn<Shipment>[] = [
  { key: "tracking_id", header: "Tracking", className: "w-36" },
  { key: "status", header: "Estado", render: (s) => <StatusBadge status={s.status} /> },
  { key: "recipient", header: "Destinatario", render: (s) => effectiveName(s) },
]

<DataTable
  columns={columns}
  data={shipments}
  loading={isLoading}
  emptyMessage="No se encontraron envíos."
  onRowClick={(shipment) => navigate(`/shipments/${shipment.tracking_id}`)}
/>
```

### Badge genérico (no estado de envío)
```tsx
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
                 bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300
                 border border-transparent">
  Etiqueta
</span>
```

### Filtros / Barra de herramientas
```tsx
<div className="flex flex-wrap items-center gap-3 mb-4">
  <input placeholder="Buscar..." className="w-48 px-3 py-2 rounded-lg border ..." />
  <SelectMenu value={status} onChange={setStatus} placeholder="Estado">
    <SelectOption value="in_transit">En tránsito</SelectOption>
    <SelectOption value="at_hub">En sucursal</SelectOption>
  </SelectMenu>
  <div className="flex-1" />
  <Button size="sm" variant="outline">Exportar</Button>
</div>
```

### Formularios
```tsx
<form onSubmit={handleSubmit} className="space-y-6">
  <Section title="Datos del remitente">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label="Nombre" required>
        <input className="w-full px-3 py-2 rounded-lg border ..." />
      </FormField>
      {/* más campos */}
    </div>
  </Section>

  <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
    <Button variant="outline" type="button" onClick={onCancel}>Cancelar</Button>
    <Button type="submit" disabled={loading}>{loading ? "Guardando..." : "Guardar"}</Button>
  </div>
</form>
```

### Responsive
```typescript
const isMobile = useIsMobile()
// Mobile (< 768px): Sidebar drawer, tablas scroll horizontal, grids 1 columna
// Desktop (> 768px): Sidebar expandible, grids multi-columna
```

---

## 15. Modelos de datos principales

### Shipment
```typescript
interface Shipment {
  tracking_id: string           // "LT-XXXXXXXX" | "DRAFT-XXXXXXXX"
  status: ShipmentStatus
  priority?: "alta" | "media" | "baja"
  priority_score?: number       // 0–1
  priority_confidence?: number  // 0–1
  priority_factors?: PriorityFactors
  sender: Customer
  recipient: Customer
  weight_kg: number
  package_type: "envelope" | "box"
  is_fragile?: boolean
  special_instructions?: string
  shipment_type?: "normal" | "express"
  time_window?: "morning" | "afternoon" | "flexible"
  delivery_method?: "ultima_milla" | "retiro_sucursal"
  cold_chain?: boolean
  receiving_branch_id?: string
  origin_branch_id?: string
  final_branch_id?: string
  current_location?: string
  corrections?: ShipmentCorrections
  has_incident?: boolean
  incident_type?: IncidentType
  zone?: BranchZoneType       // "entrada" | "salida" | "revision" | "devolucion"
  is_returning?: boolean
  price?: number
  price_breakdown?: PriceBreakdown
  price_currency?: string     // "ARS"
  created_at: string
  updated_at: string
  estimated_delivery_at: string
  delivered_at?: string
  chatbot_metadata?: Record<string, any>
  planned_path?: PlannedPathHop[]
}

interface ShipmentCorrections {
  sender_name?: string; sender_phone?: string; sender_email?: string; sender_dni?: string
  origin_street?: string; origin_city?: string; origin_province?: string; origin_postal_code?: string
  recipient_name?: string; recipient_phone?: string; recipient_email?: string; recipient_dni?: string
  destination_street?: string; destination_city?: string; destination_province?: string; destination_postal_code?: string
  weight_kg?: string; package_type?: string; special_instructions?: string
  shipment_type?: string; time_window?: string; cold_chain?: string; is_fragile?: string
  [key: string]: string | undefined
}

interface PriceBreakdown {
  base_fare: number; distance_km: number; distance_cost: number
  weight_surcharge: number; last_mile_surcharge: number; risky_zone_surcharge: number
  shipment_multiplier: number; time_window_surplus: number; fragile_surplus: number
  subtotal: number; total: number
}
```

### ShipmentEvent
```typescript
interface ShipmentEvent {
  id: string; tracking_id: string
  event_type?: "status_change" | "edited"
  from_status?: ShipmentStatus; to_status: ShipmentStatus
  changed_by: string; location?: string; notes?: string
  timestamp: string  // ISO UTC
  current_location?: EventLocation
  rescheduled_date?: string
  via?: string
}
```

### Branch
```typescript
interface Branch {
  id: string; name: string   // e.g. "caba", "CDBA-01"
  address: Address
  province: string
  status: "activo" | "inactivo" | "fuera_de_servicio"
  max_capacity?: number
  hours?: string
  latitude?: number; longitude?: number
  created_at: string; updated_at: string; updated_by?: string
}
```

### Vehicle
```typescript
interface Vehicle {
  id: string; license_plate: string
  type: "auto" | "furgoneta" | "camion"
  mode: "ultima_milla" | "inter_sucursal"
  capacity_kg: number
  status: "disponible" | "en_carga" | "en_transito" | "mantenimiento" | "inactivo"
  assigned_branch?: string; destination_branch?: string
  assigned_shipments?: string[]
}
```

### User / Auth
```typescript
interface User {
  id: string; username: string
  role: "operator" | "supervisor" | "manager" | "admin" | "driver"
  branch_id?: string
  first_name?: string; last_name?: string
  email?: string; phone?: string
  status?: "activo" | "inactivo"
  driver_type?: "ultima_milla" | "intersucursal"
  two_fa_enabled?: boolean
  two_fa_enrolled_at?: string
  address?: UserAddress
}
```

---

## 16. API modules reference

Base URL: `http://localhost:8080/api/v1` (dev) — sobreescribible con `VITE_API_URL`.

### Auth & Profile
| Module | Key Functions |
|--------|---------------|
| `auth.ts` | `authApi.login()`, `authApi.logout()` |
| `users.ts` | `usersApi.getMe()`, `listDrivers(branchId?, driverType?)`, `changePassword()` |
| `two-fa.ts` | `twoFAApi.setup()`, `confirm()`, `verify()`, `disable()` |
| `passwordReset.ts` | `passwordResetApi.request(username, channel)`, `confirm()` |

### Shipments
| Module | Key Functions |
|--------|---------------|
| `shipments.ts` | `list()`, `get()`, `create()`, `saveDraft()`, `updateDraft()`, `updateStatus()`, `deliver()`, `cancelShipment()`, `correctShipment()`, `getEvents()`, `getComments()`, `addComment()`, `getIncidents()`, `reportIncident()`, `search()`, `stats()`, `bulkUpdateStatus()`, `moveZone()`, `approveFromRevision()`, `classifyShipment()` |
| `customers.ts` | `customerApi.getByDNI(dni)` |
| `qrService.ts` | `qrService.generateQR(trackingId)`, `getDownloadURL()` |

### Fleet
| Module | Key Functions |
|--------|---------------|
| `vehicles.ts` | `list()`, `create()`, `getByPlate()`, `updateStatus()`, `listAvailable()`, `assignToShipment()`, `assignBranch()`, `startTrip()`, `endTrip()`, `getByShipment()`, `unassignShipment()`, `getQR()` |

### Branches
| Module | Key Functions |
|--------|---------------|
| `branches.ts` | `list()`, `listActive()`, `search()`, `create()`, `update()`, `updateStatus()`, `getCapacity()`, helpers: `branchLabel()`, `branchLabelById()`, `statusLabel()`, `statusColor()` |

### Routing (Dispatch)
| Module | Key Functions |
|--------|---------------|
| `routing.ts` | `getTodayPlan()`, `getHorizonPlans()`, `regenerate()`, `regenerateGlobal()`, `apply()`, `getConfig()`, `updateConfig()`, `recomputeLastMile()`, helpers: `reasonLabel()`, `REASON_LABELS` |
| `interBranchTrips.ts` | `getMyTrip()`, `startTrip()`, `getQR()`, `finishByScan()`, `assignDriver()`, `cancel()`, `listByBranch()`, `calendar()`, `getById()`, `confirmUnload()`, `confirmLoad()`, `claimByVehicleQR()`, `closeByVehicleQR()` |
| `routingForecast.ts` | `getForecast()`, `getQuality()`, `getRollingPlan()` |
| `routingMetrics.ts` | `listPlans()`, `listApplies()`, `listHops()`, `listODVolume()`, `getSummary()` |
| `branchGraph.ts` | `getGraph()`, `derive()`, `create()`, `setEnabled()` |

### Driver
| Module | Key Functions |
|--------|---------------|
| `driver.ts` | `getRoute()`, `startRoute()`, `submitCheckin()`, `skipCheckin()`, `submitPVT()`, `uploadVoice()`, `submitTouchEvent()`, `getTestEligibility()`, `getFatigueBlockStatus()`, `requestHistory()`, `getPersonalHistory()` |

### Admin
| Module | Key Functions |
|--------|---------------|
| `admin.ts` | `adminApi.listUsers()`, `createUser()`, `updateUser()` |
| `mlConfig.ts` | `mlConfigApi.getActive()`, `getHistory()`, `regenerate()`, `activate()` |
| `pricing.ts` | `pricingApi.quote()`, `getConfig()`, `updateConfig()`, `formatCurrencyARS()` |
| `systemConfig.ts` | `systemConfigApi.get()`, `update()`, `getPublicConfig()` |
| `organizationApi.ts` | `organizationApi.get()`, `getPublic()`, `update()` |
| `slaSettings.ts` | `slaSettingsApi.get()`, `update()` |
| `fatigueConfig.ts` | `fatigueConfigApi.get()`, `update()`, `resetCheckins()`, `getAuditLogs()` |
| `zones.ts` | `zoneApi.list()`, `create()`, `update()`, `remove()` + `ZONE_COLOR` |
| `clock.ts` | `clockApi.get()`, `setOverride()`, `clear()` |
| `accessLog.ts` | `accessLogApi.list(limit?)` |
| `payments.ts` | `paymentApi.requestPayment()`, `backToDraft()`, `get()`, `confirmCashPayment()`, `confirmTransferPayment()`, `getQR()`, `getConfig()`, `updateConfig()`, `updateCredentials()` |
| `autoReports.ts` | `autoReportsApi.listSchedules()`, `createSchedule()`, `updateSchedule()`, `deleteSchedule()`, `runNow()`, `listGenerated()`, `getGenerated()`, `downloadCsvUrl()` |

### Reports & Stats
| Module | Key Functions |
|--------|---------------|
| `reports.ts` | `driverPerformance()`, `incidentsByBranch()`, `billingMetrics()`, `branchRanking()`, `volumeByTimeWindow()`, `volumeByShipmentType()`, `volumeByDeliveryMethod()`, `returnMetrics()`, `successRateByBranch()` |
| `slaMetrics.ts` | `slaMetricsApi.get()` |
| `priorityLogs.ts` | `priorityLogsApi.list()` |
| `supervisorFatigue.ts` | `getDashboard()`, `getHistory()`, `getActiveAlerts()`, `dismissAlert()`, `recallDriver()`, `listHistoryRequests()`, `reviewHistoryRequest()`, `getBlockedDrivers()`, `unblockDriver()` |

### Public (no auth)
| Module | Key Functions |
|--------|---------------|
| `publicTracking.ts` | `getShipment()`, `getEvents()`, `getBranches()`, `getStats()`, `createClaim()`, `getClaim()` |
| `chatbot.ts` | `authenticate()`, `requestPickup()`, `getRescheduleOptions()`, `rescheduleDelivery()`, `cancelShipment()`, `authenticateSender()`, `fileClaim()`, `respondToClaim()`, `cancelBySender()` |

### Other
| Module | Key Functions |
|--------|---------------|
| `claims.ts` | `list()`, `get()`, `getEvents()`, `downloadEvidence()`, `downloadResponseEvidence()`, `updateCategory()`, `resolve()`, `requestInfo()`, `markInReview()` + `CLAIM_TYPE_LABELS`, `CLAIM_EVENT_LABELS` |
| `notifications.ts` | `notificationApi.list()`, `unreadCount()`, `markRead()`, `markAllRead()`, `fetchServerClockOffsetMs()` |

---

## 17. Route Map (completo desde App.tsx)

### Rutas públicas (sin auth, sin shell)
| Route | Page | Notes |
|-------|------|-------|
| `/login` | Login | |
| `/track` | PublicTracking | Bypass de auth, usa `publicTracking.ts` |
| `/2fa/verify` | TwoFAVerify | Pre-auth |
| `/2fa/setup-required` | TwoFASetup | Required mode |

### Driver routes (DriverNav shell)
| Route | Page | Notes |
|-------|------|-------|
| `/driver/route` | DriverRoute | Default para ultima_milla |
| `/driver/trip` | DriverInterBranchTrip | Default para intersucursal |
| `/driver/scan` | DriverScanVehicle | |
| `/shipments/:trackingId` | DriverShipmentDetail | Misma URL, componente diferente |
| `/profile` | UserProfile | |

### Non-driver authenticated routes (AppShell)
| Route | Page | Roles |
|-------|------|-------|
| `/` | ShipmentList | operator, supervisor, manager |
| `/new` | NewShipment | operator, supervisor |
| `/shipments/:trackingId` | ShipmentDetail | operator, supervisor, manager |
| `/drafts` | DraftList | operator, supervisor |
| `/dashboard` | Dashboard | supervisor, manager |
| `/kpi-detail` | KpiDetail | supervisor, manager, admin |
| `/claims` | Claims | operator, supervisor, manager, admin |
| `/claims/:id` | Claims | operator, supervisor, manager, admin |
| `/sla-audit` | SlaAuditLogs | supervisor, manager |
| `/calendar` | TripsCalendar | operator, supervisor, manager |
| `/repartos` | Repartos → Routing(last_mile) | operator, supervisor |
| `/inter-sucursal` | InterSucursal → Routing(inter_branch) | operator, supervisor |
| `/viajes` | InterBranchTripsList | operator, supervisor, manager |
| `/inter-branch-trips/:id/recepcion` | OperatorTripReception | operator, supervisor |
| `/red` | NetworkHub | manager, admin |
| `/notifications` | NotificationsPage | operator, supervisor, manager, admin |
| `/bulk-upload` | BulkUpload | operator, supervisor |
| `/profile` | UserProfile | all authenticated |
| `/auto-reports` | AutoReports | manager |

### Vehicle routes
| Route | Page | Roles |
|-------|------|-------|
| `/vehicles` | VehicleList | operator, supervisor, manager, admin |
| `/vehicles/:plate/status` | VehicleStatus | supervisor, admin |
| `/vehicles/:plate/assign` | VehicleAssignment | supervisor, admin |
| `/vehicles/available` | AvailableVehicles | supervisor, admin |

### Branch routes
| Route | Page | Roles |
|-------|------|-------|
| `/branches` | BranchList | supervisor, manager, admin |

### Admin routes
| Route | Page | Roles |
|-------|------|-------|
| `/ml-config` | MLConfig | admin |
| `/system-config` | SystemConfig | admin |
| `/pricing-config` | PricingConfig | admin |
| `/payment-config` | PaymentConfig | admin |
| `/routing-config` | RoutingConfig | admin |
| `/fatigue-config` | FatigueConfig | admin |
| `/organization` | OrganizationConfig | admin |
| `/zones` | ZoneManagement | admin |
| `/admin/users` | AdminUsers | admin |
| `/admin/access-logs` | AccessLog | admin |
| `/admin/sla-config` | SlaSettings | admin |

### Supervisor routes
| Route | Page | Roles |
|-------|------|-------|
| `/supervisor/fatigue` | SupervisorFatigue | supervisor, manager |

### Redirects (legacy)
| From | To |
|------|-----|
| `/routing` | `/inter-sucursal` |
| `/operations/trips` | `/viajes` |
| `/reports/drivers` | `/dashboard?tab=choferes` |
| `/reports/incidents` | `/dashboard?tab=reclamos` |
| `/reports/billing` | `/dashboard?tab=facturacion` |
| `/reports/branch-ranking` | `/dashboard?tab=ranking` |
| `/reports/volume-by-window` | `/dashboard?tab=volumen` |
| `/reports/return-metrics` | `/dashboard?tab=retorno` |
| `/reports/success-rate` | `/dashboard?tab=exito` |

---

## 18. Permisos por rol (resumen para UI)

```typescript
const permissions = {
  nav: {
    shipments:   ["operator", "supervisor", "manager"],
    repartos:    ["operator", "supervisor"],
    interSucursal: ["operator", "supervisor"],
    viajes:      ["operator", "supervisor", "manager"],
    calendar:    ["operator", "supervisor", "manager"],
    claims:      ["operator", "supervisor", "manager", "admin"],
    slaAudit:    ["supervisor", "manager"],
    dashboard:   ["supervisor", "manager"],
    kpiDetail:   ["supervisor", "manager", "admin"],
    fleet:       ["operator", "supervisor", "manager", "admin"],
    branches:    ["supervisor", "manager", "admin"],
    bulkUpload:  ["operator", "supervisor"],
    drafts:      ["operator", "supervisor"],
    network:     ["manager", "admin"],
    notifications: ["operator", "supervisor", "manager", "admin"],
    autoReports: ["manager"],
    admin:       ["admin"],
    driverRoute: ["driver"],
  },
  shipments: {
    create:       ["operator", "supervisor"],
    updateStatus: ["operator", "supervisor"],
    cancel:       ["supervisor"],
    correct:      ["supervisor"],
    comment:      ["supervisor"],
    incidentReport: ["operator", "supervisor"],
    exportCSV:    ["admin", "manager"],
    newShipment:  ["operator", "supervisor"],  // NO manager, NO driver
    outForDelivery: ["supervisor"],            // operator CANNOT update out_for_delivery
  }
}
// Restricción de sucursal (branchForbidden):
// - operator: solo ve Y edita envíos de su sucursal
// - supervisor: ve todo, pero solo edita envíos de su sucursal
// - manager/admin: sin restricción de sucursal
```

---

## 19. Reglas de negocio clave para la UI

### Transiciones de estado
```
draft ──confirm──► at_origin_hub
at_origin_hub ──[vehicle assign]──► loaded
loaded ──[StartTrip]──► in_transit
in_transit ──[EndTrip]──► at_hub
at_hub ──► out_for_delivery      (requiere driver_id)
at_hub ──► ready_for_pickup
at_hub ──► ready_for_return      (solo si current_location == origin_branch_id)
out_for_delivery ──► delivered          (requiere recipient_dni)
out_for_delivery ──► delivery_failed    (requiere notes)
delivery_failed ──► out_for_delivery    (reintento)
delivery_failed ──► at_hub
ready_for_pickup ──► delivered          (requiere recipient_dni)
ready_for_return ──► returned           (requiere sender_dni)
```

### Estados terminales
`delivered`, `returned`, `cancelled`, `lost`, `destroyed`

### Estados cancelables
`at_origin_hub`, `at_hub`, `out_for_delivery`, `delivery_failed`, `ready_for_pickup`, `ready_for_return`

### Driver — actualización de estado
- Solo shipments en su ruta del día (validado por `RouteService.ValidateDriverCanUpdateShipment`)
- Solo `delivered` o `delivery_failed`
- Requiere GPS: `useCurrentSpeed()` → `locationReady` debe ser `true`
- Check-in de fatiga: KSS + PVT + voz según configuración

### Customer autocomplete (DNI)
- ≥7 dígitos → 400ms debounce → GET /customers?dni=
- El usuario DEBE hacer click en "Usar datos" — no autofill automático

### location en ShipmentEvent
Resolver siempre con:
```typescript
branches.find(b => b.address.city === loc) ?? branches.find(b => b.id === loc)
```

### Time window en NewShipment
- Se oculta si `delivery_method === retiro_sucursal`
- Se resetea a `flexible` automáticamente en ese caso

---

## 20. NO hacer (reglas absolutas)

```
✗ No usar strings en inglés en la UI
✗ No hardcodear nombres de sucursales
✗ No usar .toLocaleDateString()
✗ No usar CSS custom en archivos separados (salvo index.css, MapView.css, chatbot.css — estos son deuda)
✗ No mostrar stack traces al usuario
✗ No mostrar "Cancelar envío" para operator
✗ No mostrar Dashboard en nav para operator
✗ No mostrar "Nuevo envío" para manager ni driver
✗ No permitir transiciones desde out_for_delivery para operator
✗ No usar emojis como iconos
✗ No recrear StatusBadge ni PriorityBadge
✗ No usar estilos inline (style={{}})
✗ No usar clases CSS legacy: .btn, .card, .badge, .table, .modal, .alert, .input, .select, .textarea, .field
✗ No usar hex colors hardcodeados (usar var(--token) o Tailwind)
✗ No crear componentes sin variante dark:
✗ No usar export default (usar named exports)
✗ No usar React.FC (usar function declaration)
```

---

## 21. Usuarios de prueba (seed)

| Usuario | Contraseña | Rol | Sucursal |
|---------|-----------|-----|----------|
| `op_caba` | `op_caba123` | operator | caba |
| `sup_caba` | `sup_caba123` | supervisor | caba |
| `chofer_caba` | `chofer_caba123` | driver | caba |
| `op_cordoba` | `op_cordoba123` | operator | cordoba |
| `sup_cordoba` | `sup_cordoba123` | supervisor | cordoba |
| `chofer_cordoba` | `chofer_cordoba123` | driver | cordoba |
| `op_mendoza` | `op_mendoza123` | operator | mendoza |
| `sup_mendoza` | `sup_mendoza123` | supervisor | mendoza |
| `chofer_mendoza` | `chofer_mendoza123` | driver | mendoza |
| `op_posadas` | `op_posadas123` | operator | posadas |
| `chofer_posadas` | `chofer_posadas123` | driver | posadas |
| `sup_santa_cruz` | `sup_santacruz123` | supervisor | santa_cruz |
| `gerente` | `gerente123` | manager | — |
| `admin` | `admin123` | admin | — |

---

*Toolkit mantenido en `logitrack_web/UI_CONTEXT.md` — actualizar cuando se agreguen componentes, endpoints, rutas o reglas de negocio nuevas.*
*Deuda técnica documentada en `.omo/debts/ui-debt.md` — marcar como resuelta al migrar.*
