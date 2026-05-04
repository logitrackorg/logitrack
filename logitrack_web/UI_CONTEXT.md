# LogiTrack — UI Context Toolkit

Pegá este archivo completo al inicio de cualquier prompt cuando le pidas a la IA componentes o pantallas del frontend.

---

## 1. Stack tecnológico

- **Framework**: React 19 + TypeScript 5 + Vite 7
- **Estilos**: Tailwind CSS v4 (utility classes solamente, no CSS custom salvo en `src/index.css`)
- **Componentes UI**: shadcn/ui (Radix + Nova preset) — usar siempre que exista el componente
- **Iconos**: `lucide-react` — nunca emojis ni SVG inline salvo casos muy específicos
- **HTTP**: Axios (con interceptor Bearer en `src/api/shipments.ts`)
- **Fechas**: `fmtDate` / `fmtDateTime` de `src/utils/date.ts` — formato DD/MM/AAAA — **NUNCA** usar `.toLocaleDateString()` directamente
- **Auth**: `useAuth()` de `src/context/AuthContext` — provee `user`, `token`, `hasRole()`, `login()`, `logout()`
- **Idioma UI**: Español (Argentina) — todo label, placeholder, mensaje de error y botón va en español

---

## 2. Estructura de carpetas relevante

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
    AuthContext.tsx     # user, token, hasRole(), login(), logout()
  components/
    ProtectedRoute.tsx
    StatusBadge.tsx     # badge de estado de envío — NO recrear
    PriorityBadge.tsx   # badge de prioridad IA — NO recrear
    Toast.tsx           # ToastContainer — ya montado en App.tsx
  pages/               # una página por pantalla
  utils/
    date.ts            # fmtDate / fmtDateTime
    toast.ts           # addToast(type, message)
  hooks/
    useIsMobile.ts     # hook responsive
```

---

## 3. Design Tokens

### Colores base

| Propósito | Hex | Clase Tailwind equivalente |
|---|---|---|
| Primario | `#1E3A5F` | `slate-800` |
| Primario hover | `#0f2744` | `slate-900` |
| Acento | `#F59E0B` | `amber-500` |
| Background página | `#F8FAFC` | `slate-50` |
| Surface / card | `#FFFFFF` | `white` |
| Borde | `#E2E8F0` | `slate-200` |
| Texto principal | `#111827` | `gray-900` |
| Texto secundario | `#6B7280` | `gray-500` |
| Texto muted | `#9CA3AF` | `gray-400` |

### Paleta semántica — estados de envío

| `status` | Label UI | Clases Tailwind |
|---|---|---|
| `pending` | Borrador | `bg-gray-100 text-gray-600` |
| `in_progress` | En proceso | `bg-amber-100 text-amber-700` |
| `pre_transit` | Pre-tránsito | `bg-cyan-100 text-cyan-700` |
| `in_transit` | En tránsito | `bg-blue-100 text-blue-700` |
| `at_branch` | En sucursal | `bg-violet-100 text-violet-700` |
| `delivering` | En reparto | `bg-orange-100 text-orange-700` |
| `delivery_failed` | Entrega fallida | `bg-red-100 text-red-700` |
| `delivered` | Entregado | `bg-green-100 text-green-700` |
| `ready_for_pickup` | Listo para retiro | `bg-sky-100 text-sky-700` |
| `ready_for_return` | Listo para devolución | `bg-purple-100 text-purple-700` |
| `returned` | Devuelto | `bg-slate-100 text-slate-600` |
| `cancelled` | Cancelado | `bg-red-50 text-red-400` |

### Paleta semántica — prioridad IA

| `priority` | Clases Tailwind |
|---|---|
| `alta` | `bg-red-100 text-red-700` |
| `media` | `bg-amber-100 text-amber-700` |
| `baja` | `bg-green-100 text-green-700` |

### Paleta semántica — roles de usuario

| Rol | Clases Tailwind |
|---|---|
| `admin` | `bg-violet-100 text-violet-700` |
| `supervisor` | `bg-blue-100 text-blue-800` |
| `operator` | `bg-emerald-100 text-emerald-700` |
| `driver` | `bg-cyan-100 text-cyan-700` |
| `manager` | `bg-amber-100 text-amber-800` |

### Paleta semántica — estado de vehículos

| `status` | Label | Clases Tailwind |
|---|---|---|
| `disponible` | Disponible | `bg-green-100 text-green-700` |
| `en_carga` | En carga | `bg-amber-100 text-amber-700` |
| `en_transito` | En tránsito | `bg-violet-100 text-violet-700` |
| `mantenimiento` | Mantenimiento | `bg-orange-100 text-orange-700` |
| `inactivo` | Inactivo | `bg-gray-100 text-gray-500` |

### Paleta semántica — estado de sucursales

| `status` | Label | Clases Tailwind |
|---|---|---|
| `activo` | Activa | `bg-green-100 text-green-700` |
| `inactivo` | Inactiva | `bg-gray-100 text-gray-500` |
| `fuera_de_servicio` | Fuera de servicio | `bg-red-100 text-red-600` |

---

## 4. Modelos de datos principales

### Shipment
```typescript
interface Shipment {
  tracking_id: string           // "LT-XXXXXXXX" | "DRAFT-XXXXXXXX"
  status: ShipmentStatus
  priority?: 'alta' | 'media' | 'baja'
  priority_score?: number       // 0–1
  priority_confidence?: number  // 0–1
  priority_factors?: Record<string, number>
  sender: Customer
  recipient: Customer
  weight_kg: number
  package_type: 'envelope' | 'box' | 'pallet'
  is_fragile?: boolean
  special_instructions?: string
  shipment_type?: 'normal' | 'express'
  time_window?: 'morning' | 'afternoon' | 'flexible'
  cold_chain?: boolean
  receiving_branch_id?: string
  origin_branch_id?: string
  current_location?: string     // branch ID o ciudad
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
  sender_name?: string
  sender_phone?: string
  sender_email?: string
  sender_dni?: string
  origin_street?: string
  origin_city?: string
  origin_province?: string
  origin_postal_code?: string
  recipient_name?: string
  recipient_phone?: string
  recipient_email?: string
  recipient_dni?: string
  destination_street?: string
  destination_city?: string
  destination_province?: string
  destination_postal_code?: string
  weight_kg?: string
  package_type?: string
  special_instructions?: string
  shipment_type?: string
  time_window?: string
  cold_chain?: string           // "true" | "false"
  is_fragile?: string           // "true" | "false"
  [key: string]: string | undefined
}
```

### ShipmentEvent
```typescript
interface ShipmentEvent {
  id: string
  tracking_id: string
  event_type: 'status_change' | 'edited'
  from_status?: ShipmentStatus
  to_status: ShipmentStatus
  changed_by: string
  location?: string
  notes?: string
  timestamp: string             // ISO UTC
}
```

### Branch
```typescript
interface Branch {
  id: string                    // e.g. "caba", "cordoba"
  name: string                  // e.g. "CDBA-01"
  address: Address
  province: string
  status: 'activo' | 'inactivo' | 'fuera_de_servicio'
}
```

### Vehicle
```typescript
interface Vehicle {
  id: string
  license_plate: string
  type: 'motocicleta' | 'furgoneta' | 'camion' | 'camion_grande'
  capacity_kg: number
  status: 'disponible' | 'en_carga' | 'en_transito' | 'mantenimiento' | 'inactivo'
  assigned_branch: string
  destination_branch?: string
  assigned_shipments?: string[] // tracking IDs
}
```

### User / Auth
```typescript
interface User {
  id: string
  username: string
  role: 'operator' | 'supervisor' | 'manager' | 'admin' | 'driver'
  branch_id?: string
}
// acceso: const { user, hasRole } = useAuth()
```

---

## 5. Endpoints de API relevantes

Base URL: `http://localhost:8080/api/v1` (dev) — sobreescribible con `VITE_API_URL`.
Todos requieren `Authorization: Bearer <token>` salvo los indicados.

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
GET    /stats                                   → supervisor, manager, admin

GET    /branches                                → ?status=
POST   /branches                                → admin
PATCH  /branches/:id                            → admin
PATCH  /branches/:id/status

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
GET    /driver/route                            → solo driver

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

## 6. Permisos por rol (resumen para UI)

```typescript
const permissions = {
  nav: {
    shipments:   ['operator', 'supervisor', 'manager', 'admin'],
    dashboard:   ['supervisor', 'manager', 'admin'],
    fleet:       ['operator', 'supervisor', 'manager', 'admin'],
    branches:    ['supervisor', 'manager', 'admin'],
    bulkUpload:  ['operator', 'supervisor'],
    mlConfig:    ['admin'],
    organization:['admin'],
    users:       ['admin'],
    accessLogs:  ['admin'],
    driverRoute: ['driver'],
  },
  shipments: {
    create:       ['operator', 'supervisor', 'admin'],
    updateStatus: ['operator', 'supervisor', 'admin'],  // operator NO puede desde "delivering"
    cancel:       ['supervisor', 'admin'],
    correct:      ['operator', 'supervisor', 'admin'],
    comment:      ['operator', 'supervisor', 'admin'],
    exportCSV:    ['admin', 'manager'],
    newShipment:  ['operator', 'supervisor', 'admin'],  // NO manager, NO driver
  }
}
// Restricción de sucursal (branchForbidden):
// - operator: solo ve Y edita envíos de su sucursal
// - supervisor: ve todo, pero solo edita envíos de su sucursal
```

---

## 7. Convenciones de código

### Imports con alias `@`
```typescript
import { fmtDate, fmtDateTime } from '@/utils/date'
import { useAuth } from '@/context/AuthContext'
import { branchApi, branchLabel } from '@/api/branches'
import { StatusBadge } from '@/components/StatusBadge'
import { PriorityBadge } from '@/components/PriorityBadge'
```

### Patrones obligatorios

```typescript
// Fechas — SIEMPRE así:
fmtDate(shipment.created_at)       // → "01/04/2026"
fmtDateTime(event.timestamp)       // → "01/04/2026 14:30"

// Auth:
const { user, hasRole } = useAuth()
if (hasRole('admin', 'supervisor')) { /* ... */ }

// Branches — NUNCA hardcodear:
const branches = await branchApi.listActive()
branchLabel(city, branches)        // city → display name
branchLabelById(id, branches)      // id → display name

// Correcciones — el valor corregido tiene precedencia:
const effectiveName = shipment.corrections?.recipient_name ?? shipment.recipient.name

// Toasts:
import { addToast } from '@/utils/toast'
addToast('success', 'Envío actualizado correctamente.')
addToast('error', 'No se pudo guardar el cambio.')
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

## 8. Componentes existentes — NO recrear

```typescript
// Badge de estado de envío
import { StatusBadge } from '@/components/StatusBadge'
<StatusBadge status={shipment.status} />

// Badge de prioridad IA
import { PriorityBadge } from '@/components/PriorityBadge'
<PriorityBadge priority={shipment.priority} />

// Rutas protegidas
import { ProtectedRoute } from '@/components/ProtectedRoute'

// Toasts (ya montado en App.tsx — solo usar addToast)
import { addToast } from '@/utils/toast'

// Hook responsive
import { useIsMobile } from '@/hooks/useIsMobile'
const isMobile = useIsMobile()
```

---

## 9. Reglas de negocio clave para la UI

### Transiciones de estado disponibles
```
in_progress      → pre_transit       (asignar vehículo — automático)
pre_transit      → in_transit        (StartTrip — automático desde Flota)
in_transit       → at_branch         (EndTrip — automático desde Flota)
at_branch        → delivering        (requiere driver_id)
                 → ready_for_pickup
                 → ready_for_return  (solo si current_location == origin_branch_id)
delivering       → delivered         (requiere recipient_dni)
                 → delivery_failed   (requiere notes)
delivery_failed  → delivering        (requiere driver_id)
                 → at_branch
ready_for_pickup → delivered         (requiere recipient_dni)
                 → pre_transit       (traslado via vehículo)
ready_for_return → returned          (requiere sender_dni)
```

### Estados terminales — sin más transiciones
`delivered`, `returned`, `cancelled`

### Estados cancelables
`in_progress`, `at_branch`, `delivering`, `delivery_failed`, `ready_for_pickup`, `ready_for_return`

### Estados NO cancelables
`pending`, `pre_transit`, `in_transit` + terminales

### Tracking ID
- Confirmados: `LT-XXXXXXXX`
- Borradores: `DRAFT-XXXXXXXX`

### Filtro "Activo" en lista de envíos
Excluye: `pending`, `delivered`, `returned`, `cancelled`

### Correcciones de datos
- Valor corregido como principal
- Badge "Modificado" (`bg-yellow-100 text-yellow-700 border border-yellow-300`)
- Valor original tachado en gris debajo

### Customer autocomplete (DNI)
- ≥7 dígitos → 400ms debounce → GET /customers?dni=
- El usuario DEBE hacer click en "Usar datos" — no autofill automático

### location en ShipmentEvent
El campo `location` puede ser branch ID (ej: `"caba"`) o ciudad (ej: `"Ciudad de Buenos Aires"`).
Resolver siempre con:
```typescript
branches.find(b => b.address.city === loc) ?? branches.find(b => b.id === loc)
```

---

## 10. NO hacer (reglas absolutas)

```
✗ No usar strings en inglés en la UI
✗ No hardcodear nombres de sucursales — siempre desde GET /branches
✗ No usar .toLocaleDateString() — usar fmtDate/fmtDateTime
✗ No crear CSS custom salvo en src/index.css
✗ No mostrar stack traces ni mensajes técnicos al usuario
✗ No mostrar "Cancelar envío" para operator
✗ No mostrar Dashboard en nav para operator
✗ No mostrar "Nuevo envío" para manager ni driver
✗ No permitir transiciones desde "delivering" para operator
✗ No mostrar panel de update status para manager ni driver
✗ No usar emojis como iconos — usar lucide-react
✗ No recrear StatusBadge ni PriorityBadge
✗ No usar estilos inline (style={{}}) — usar clases Tailwind
```

---

## 11. Usuarios de prueba (seed)

| Usuario | Contraseña | Rol | Sucursal |
|---|---|---|---|
| `op_caba` | `op_caba123` | operator | caba |
| `sup_caba` | `sup_caba123` | supervisor | caba |
| `chofer_caba` | `chofer_caba123` | driver | caba |
| `op_cordoba` | `op_cordoba123` | operator | cordoba |
| `sup_cordoba` | `sup_cordoba123` | supervisor | cordoba |
| `gerente` | `gerente123` | manager | — |
| `admin` | `admin123` | admin | — |

---

*Toolkit mantenido en `logitrack_web/UI_CONTEXT.md` — actualizar cuando se agreguen componentes, endpoints o reglas de negocio nuevas.*
