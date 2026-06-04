# LogiTrack — UI Context Toolkit

Pegá este archivo completo al inicio de cualquier prompt cuando le pidas a la IA componentes o pantallas del frontend.

---

## 1. Stack tecnológico

- **Framework**: React 19 + TypeScript 5 + Vite 7
- **Estilos**: Tailwind CSS v4 (utility classes) + CSS custom properties (`var(--token)` en `src/index.css`)
- **Componentes UI**: shadcn/ui (Radix + Nova preset) — usar siempre que exista el componente
- **Iconos**: `lucide-react` — nunca emojis ni SVG inline
- **Tipografía**: Plus Jakarta Sans Variable (`@fontsource-variable/plus-jakarta-sans`)
- **HTTP**: Axios (con interceptor Bearer en `src/api/shipments.ts`)
- **Fechas**: `fmtDate` / `fmtDateTime` de `src/utils/date.ts` — formato DD/MM/AAAA — **NUNCA** usar `.toLocaleDateString()` directamente
- **Auth**: `useAuth()` de `src/context/AuthContext` — provee `user`, `token`, `hasRole()`, `login()`, `logout()`
- **Tema**: `useTheme()` de `src/context/ThemeContext` — `theme`, `toggleTheme()`
- **Idioma UI**: Español (Argentina) — todo label, placeholder, mensaje de error y botón va en español
- **Responsive**: `useIsMobile()` de `src/hooks/useIsMobile`

---

## 2. Jerarquía de estilos (REGLA DE ORO)

```
shadcn/ui > Tailwind utilities > CSS custom properties > inline styles
```

1. Si shadcn/ui tiene el componente, **usalo** (Button, Card, Skeleton).
2. Si no, usá **Tailwind utilities** con variantes `dark:`.
3. Para valores que cambian con el tema, usá **`var(--token)`** (ej: `color: "var(--text-primary)"`).
4. **NUNCA** usar `style={{}}` inline salvo para valores de layout calculados en runtime.
5. **NUNCA** usar las clases CSS legacy (`.btn`, `.card`, `.badge`, `.table`, `.modal`, `.alert`, `.input`).

---

## 3. Estructura de carpetas relevante

```
src/
  api/
    shipments.ts        # Axios con Bearer + redirect 401 → /login
    branches.ts         # branchApi.list(), branchApi.listActive(), branchLabel()
    vehicles.ts
    users.ts
    customers.ts
    driver.ts
    mlConfig.ts
    auth.ts
    publicTracking.ts   # Sin auth, para /api/v1/public/*
  context/
    AuthContext.tsx      # user, token, hasRole(), login(), logout()
    ThemeContext.tsx      # theme, toggleTheme()
  components/
    ProtectedRoute.tsx
    StatusBadge.tsx      # badge de estado de envío — NO recrear
    PriorityBadge.tsx    # badge de prioridad IA — NO recrear
    Toast.tsx            # ToastContainer — ya montado en App.tsx
    Sidebar.tsx           # navegación lateral
    Topbar.tsx            # barra superior
    ui/
      button.tsx          # <Button> — shadcn/ui
      card.tsx            # <Card>, <CardHeader>, <CardContent>, ...
      gradient-card.tsx   # <GradientCard> — card con gradiente
      stat-card.tsx       # <StatCard> — KPI tile
      page-header.tsx     # <PageHeader> — título de página
      section.tsx         # <Section> — agrupación visual
      skeleton.tsx        # <Skeleton>, <SkeletonLine>, <SkeletonCard>
      confirm-dialog.tsx  # <ConfirmDialog> — modal de confirmación
  pages/               # una página por pantalla
  utils/
    date.ts            # fmtDate / fmtDateTime
    toast.ts           # addToast(type, message)
    shipmentStatus.ts  # shipmentStatusLabelOverride(shipment)
  hooks/
    useIsMobile.ts     # hook responsive
  lib/
    utils.ts           # cn() — className merger
```

---

## 4. Design Tokens

### Colores brand

| Token | Hex | Tailwind | Uso |
|-------|-----|----------|-----|
| `--brand` | `#2563eb` | `blue-600` | Links, focus rings |
| `--brand-strong` | `#1d4ed8` | `blue-700` | Botón primario |
| `--brand-tint` | `#eff6ff` | `blue-50` | Fondos info |
| `--on-brand` | `#ffffff` | `white` | Texto sobre brand |

### Colores accent (naranja)

| Token | Hex | Tailwind |
|-------|-----|----------|
| `--accent` | `#f97316` | `orange-500` |
| `--accent-hover` | `#ea580c` | `orange-600` |

### Superficies

| Token | Light | Dark |
|-------|-------|------|
| `--bg-page` | `#f8fafc` | `#0b111f` |
| `--bg-card` | `#ffffff` | `#161f31` |
| `--bg-subtle` | `#f9fafb` | `#1b2436` |
| `--bg-muted` | `#f3f4f6` | `#202a3d` |
| `--bg-hover` | `#f0f9ff` | `#1e2a40` |

### Texto

| Token | Light | Dark |
|-------|-------|------|
| `--text-primary` | `#111827` | `#e9eef6` |
| `--text-heading` | `#1e3a8f` | `#f1f5fb` |
| `--text-strong` | `#374151` | `#ccd6e6` |
| `--text-secondary` | `#6b7280` | `#99a6bb` |
| `--text-muted` | `#64748b` | `#6e7b91` |

### Bordes

| Token | Light | Dark |
|-------|-------|------|
| `--border` | `#e5e7eb` | `#2a3650` |
| `--border-strong` | `#d1d5db` | `#3a4866` |

### Estados semánticos

| Estado | Sólido | Texto | Fondo | Borde |
|--------|--------|-------|-------|-------|
| Éxito | `#10b981` | `--ok-text` | `--ok-bg` | `--ok-border` |
| Peligro | `#ef4444` | `--danger-text` | `--danger-bg` | `--danger-border` |
| Advertencia | `#f97316` | `--warn-text` | `--warn-bg` | `--warn-border` |
| Info | `#3b82f6` | `--info-text` | `--info-bg` | `--info-border` |

### Chrome

| Token | Valor |
|-------|-------|
| `--sidebar-bg` | `#1e3a5f` |
| `--sidebar-border` | `#162d4a` |
| `--sidebar-hover` | `#2563eb` |
| `--topbar-bg` | `rgba(255,255,255,0.92)` (light) / `rgba(13,20,34,0.82)` (dark) |

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
|---|---|---|
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

| Rol | Tailwind |
|-----|----------|
| `admin` | `bg-violet-100 text-violet-700` |
| `supervisor` | `bg-blue-100 text-blue-800` |
| `operator` | `bg-emerald-100 text-emerald-700` |
| `driver` | `bg-cyan-100 text-cyan-700` |
| `manager` | `bg-amber-100 text-amber-800` |

---

## 8. Paleta semántica — vehículos

| `status` | Label | Tailwind |
|----------|-------|----------|
| `disponible` | Disponible | `bg-green-100 text-green-700` |
| `en_carga` | En carga | `bg-amber-100 text-amber-700` |
| `en_transito` | En tránsito | `bg-violet-100 text-violet-700` |
| `mantenimiento` | Mantenimiento | `bg-orange-100 text-orange-700` |
| `inactivo` | Inactivo | `bg-gray-100 text-gray-500` |

---

## 9. Paleta semántica — sucursales

| `status` | Label | Tailwind |
|----------|-------|----------|
| `activo` | Activa | `bg-green-100 text-green-700` |
| `inactivo` | Inactiva | `bg-gray-100 text-gray-500` |
| `fuera_de_servicio` | Fuera de servicio | `bg-red-100 text-red-600` |

---

## 10. Componentes principales — uso obligatorio

### Button
```tsx
import { Button } from "@/components/ui/button"

<Button>Guardar</Button>
<Button variant="accent">Acción destacada</Button>
<Button variant="outline">Cancelar</Button>
<Button variant="destructive">Eliminar</Button>
<Button variant="ghost"><X size={16} /></Button>
<Button size="sm">Pequeño</Button>
<Button size="lg">Grande</Button>
<Button disabled={loading}>{loading ? <Spinner /> : "Enviar"}</Button>
```
**NO usar** `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` de index.css.

### Card
```tsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"

<Card variant="default">  {/* bg-white, shadow-sm */}
  <CardHeader>
    <CardTitle>Título</CardTitle>
  </CardHeader>
  <CardContent>Contenido</CardContent>
  <CardFooter>Acciones</CardFooter>
</Card>

<Card variant="muted">  {/* bg-slate-50 */}
  ...
</Card>
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

### Toast
```tsx
import { addToast } from "@/utils/toast"
addToast("success", "Envío actualizado correctamente.")
addToast("error", "No se pudo guardar el cambio.")
```

### Skeleton
```tsx
import { Skeleton, SkeletonLine, SkeletonCard } from "@/components/ui/skeleton"
```

---

## 11. Patrones de código obligatorios

### Imports con alias `@`
```typescript
import { fmtDate, fmtDateTime } from "@/utils/date"
import { useAuth } from "@/context/AuthContext"
import { useTheme } from "@/context/ThemeContext"
import { branchApi, branchLabel } from "@/api/branches"
import { StatusBadge } from "@/components/StatusBadge"
import { PriorityBadge } from "@/components/PriorityBadge"
import { cn } from "@/lib/utils"
```

### Fechas — SIEMPRE con formatters
```typescript
fmtDate(shipment.created_at)       // → "01/04/2026"
fmtDateTime(event.timestamp)       // → "01/04/2026 14:30"
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

### Responsive
```typescript
const isMobile = useIsMobile()
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

## 12. Patrones de UI

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
<div className="text-center py-12">
  <Package size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">No hay datos</h3>
  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Mensaje explicativo.</p>
  <Button>Acción</Button>
</div>
```

### Estados de error
```tsx
<div className="text-center py-12">
  <AlertTriangle size={48} className="mx-auto text-amber-500 mb-4" />
  <h3 className="text-lg font-semibold ...">Error</h3>
  <p className="text-sm text-gray-500 ...">{error.message}</p>
  <Button variant="outline" onClick={refetch}>Reintentar</Button>
</div>
```

### Inputs — patrón estándar
```tsx
<div>
  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
    Nombre del campo
  </label>
  <input
    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700
               bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100
               placeholder:text-gray-400 focus:outline-none focus:ring-2
               focus:ring-blue-500 focus:border-blue-500 transition-all"
    placeholder="..."
  />
</div>
```

### Modal / Dialog
```tsx
{isOpen && (
  <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4"
       onClick={onClose}>
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl"
         onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Título</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>
      {/* contenido */}
    </div>
  </div>
)}
```

### Table
```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm">
    <thead>
      <tr className="bg-gray-50 dark:bg-gray-800/50">
        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
          Columna
        </th>
      </tr>
    </thead>
    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
      <tr className="hover:bg-blue-50/50 dark:hover:bg-blue-500/5 cursor-pointer transition-colors">
        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">Dato</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Badge genérico (no estado de envío)
```tsx
<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
                 bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300
                 border border-transparent">
  Etiqueta
</span>
```

---

## 13. Modelos de datos principales

### Shipment
```typescript
interface Shipment {
  tracking_id: string           // "LT-XXXXXXXX" | "DRAFT-XXXXXXXX"
  status: ShipmentStatus
  priority?: "alta" | "media" | "baja"
  priority_score?: number       // 0–1
  priority_confidence?: number  // 0–1
  priority_factors?: Record<string, number>
  sender: Customer
  recipient: Customer
  weight_kg: number
  package_type: "envelope" | "box" | "pallet"
  is_fragile?: boolean
  special_instructions?: string
  shipment_type?: "normal" | "express"
  time_window?: "morning" | "afternoon" | "flexible"
  cold_chain?: boolean
  receiving_branch_id?: string
  origin_branch_id?: string
  current_location?: string
  corrections?: ShipmentCorrections
  has_incident?: boolean
  incident_type?: IncidentType
  created_at: string            // ISO UTC
  updated_at: string
  estimated_delivery_at: string
  delivered_at?: string
}

interface Customer {
  name: string
  dni?: string
  phone?: string
  email?: string
  address: Address
}

interface Address {
  street?: string
  city: string
  province: string
  postal_code?: string
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
```

### ShipmentEvent
```typescript
interface ShipmentEvent {
  id: string; tracking_id: string
  event_type: "status_change" | "edited"
  from_status?: ShipmentStatus; to_status: ShipmentStatus
  changed_by: string; location?: string; notes?: string
  timestamp: string  // ISO UTC
}
```

### Branch
```typescript
interface Branch {
  id: string          // e.g. "caba"
  name: string        // e.g. "CDBA-01"
  address: Address
  province: string
  status: "activo" | "inactivo" | "fuera_de_servicio"
}
```

### Vehicle
```typescript
interface Vehicle {
  id: string; license_plate: string
  type: "motocicleta" | "furgoneta" | "camion" | "camion_grande"
  capacity_kg: number
  status: "disponible" | "en_carga" | "en_transito" | "mantenimiento" | "inactivo"
  assigned_branch: string; destination_branch?: string
  assigned_shipments?: string[]
}
```

### User / Auth
```typescript
interface User {
  id: string; username: string
  role: "operator" | "supervisor" | "manager" | "admin" | "driver"
  branch_id?: string
}
```

---

## 14. Endpoints de API relevantes

Base URL: `http://localhost:8080/api/v1` (dev) — sobreescribible con `VITE_API_URL`.

```
POST   /auth/login                              → sin auth
POST   /auth/logout
GET    /auth/me

GET    /shipments                               → ?date_from=&date_to=&branch_id=
POST   /shipments
POST   /shipments/draft
GET    /shipments/:tracking_id
PATCH  /shipments/:tracking_id/status
PATCH  /shipments/:tracking_id/draft
POST   /shipments/:tracking_id/confirm
PATCH  /shipments/:tracking_id/correct
POST   /shipments/:tracking_id/cancel
GET    /shipments/:tracking_id/events
GET    /shipments/:tracking_id/comments
POST   /shipments/:tracking_id/comments
GET    /shipments/:tracking_id/incidents
POST   /shipments/:tracking_id/incidents
POST   /shipments/bulk-status
GET    /search?q=
GET    /stats

GET    /branches                                → ?status=
POST   /branches                                → admin
PATCH  /branches/:id                            → admin

GET    /vehicles
POST   /vehicles                                → admin
GET    /vehicles/available                      → ?branch_id=
GET    /vehicles/by-plate/:plate
GET    /vehicles/by-shipment/:trackingId
POST   /vehicles/by-plate/:plate/assign
POST   /vehicles/by-plate/:plate/start-trip
POST   /vehicles/by-plate/:plate/end-trip
DELETE /vehicles/by-plate/:plate/shipments/:trackingId
PATCH  /vehicles/by-plate/:plate/status
POST   /vehicles/by-plate/:plate/assign-branch

GET    /users/drivers                           → ?branch_id=
GET    /users/me
POST   /users/me/password
GET    /driver/route

GET    /customers?dni=

GET    /ml/config                               → admin
GET    /ml/config/history
POST   /ml/config/regenerate
POST   /ml/config/:id/activate

GET    /organization
PUT    /organization                            → admin

GET    /admin/users                             → admin
POST   /admin/users
PATCH  /admin/users/:id
GET    /admin/access-logs

GET    /public/track/:id                        → sin auth
GET    /public/track/:id/events                 → sin auth
GET    /public/branches                         → sin auth
```

---

## 15. Permisos por rol (resumen para UI)

```typescript
const permissions = {
  nav: {
    shipments:   ["operator", "supervisor", "manager", "admin"],
    dashboard:   ["supervisor", "manager", "admin"],
    fleet:       ["operator", "supervisor", "manager", "admin"],
    branches:    ["supervisor", "manager", "admin"],
    bulkUpload:  ["operator", "supervisor"],
    mlConfig:    ["admin"],
    organization:["admin"],
    users:       ["admin"],
    accessLogs:  ["admin"],
    driverRoute: ["driver"],
  },
  shipments: {
    create:       ["operator", "supervisor", "admin"],
    updateStatus: ["operator", "supervisor", "admin"],
    cancel:       ["supervisor", "admin"],
    correct:      ["operator", "supervisor", "admin"],
    comment:      ["operator", "supervisor", "admin"],
    exportCSV:    ["admin", "manager"],
    newShipment:  ["operator", "supervisor", "admin"],  // NO manager, NO driver
  }
}
// Restricción de sucursal (branchForbidden):
// - operator: solo ve Y edita envíos de su sucursal
// - supervisor: ve todo, pero solo edita envíos de su sucursal
```

---

## 16. Reglas de negocio clave para la UI

### Transiciones de estado disponibles
```
draft ──confirm──► at_origin_hub
at_origin_hub ──[vehicle]──► loaded
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

### Tracking ID
- Confirmados: `LT-XXXXXXXX`
- Borradores: `DRAFT-XXXXXXXX`

### Correcciones de datos
- Valor corregido como principal
- Badge "Modificado" (`bg-yellow-100 text-yellow-700 border border-yellow-300`)
- Valor original tachado en gris debajo

### Customer autocomplete (DNI)
- ≥7 dígitos → 400ms debounce → GET /customers?dni=
- El usuario DEBE hacer click en "Usar datos" — no autofill automático

### location en ShipmentEvent
Resolver siempre con:
```typescript
branches.find(b => b.address.city === loc) ?? branches.find(b => b.id === loc)
```

---

## 17. NO hacer (reglas absolutas)

```
✗ No usar strings en inglés en la UI
✗ No hardcodear nombres de sucursales
✗ No usar .toLocaleDateString()
✗ No usar CSS custom en archivos separados (solo en src/index.css)
✗ No mostrar stack traces al usuario
✗ No mostrar "Cancelar envío" para operator
✗ No mostrar Dashboard en nav para operator
✗ No mostrar "Nuevo envío" para manager ni driver
✗ No permitir transiciones desde "delivering" para operator
✗ No usar emojis como iconos
✗ No recrear StatusBadge ni PriorityBadge
✗ No usar estilos inline (style={{}})
✗ No usar clases CSS legacy: .btn, .card, .badge, .table, .modal, .alert, .input, .select, .textarea, .field
✗ No usar hex colors hardcodeados (usar var(--token) o Tailwind)
✗ No crear componentes sin variante dark:
```

---

## 18. Usuarios de prueba (seed)

| Usuario | Contraseña | Rol | Sucursal |
|---------|-----------|-----|----------|
| `op_caba` | `op_caba123` | operator | caba |
| `sup_caba` | `sup_caba123` | supervisor | caba |
| `chofer_caba` | `chofer_caba123` | driver | caba |
| `op_cordoba` | `op_cordoba123` | operator | cordoba |
| `sup_cordoba` | `sup_cordoba123` | supervisor | cordoba |
| `op_mendoza` | `op_mendoza123` | operator | mendoza |
| `sup_mendoza` | `sup_mendoza123` | supervisor | mendoza |
| `op_posadas` | `op_posadas123` | operator | posadas |
| `gerente` | `gerente123` | manager | — |
| `admin` | `admin123` | admin | — |

---

*Toolkit mantenido en `logitrack_web/UI_CONTEXT.md` — actualizar cuando se agreguen componentes, endpoints o reglas de negocio nuevas.*
