# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Dev server at http://localhost:5173
npm run build     # tsc -b (type-check) + Vite production build — use to validate TS
npm run lint      # ESLint on all .ts/.tsx files
npm run preview   # Preview production build
```

No test framework is installed.

`VITE_API_URL` overrides the default API base (`http://localhost:8080/api/v1`).

## Architecture

```
src/
  api/            # Three Axios instances: auth.ts, shipments.ts, branches.ts
  context/        # AuthContext — global auth state, persisted to localStorage
  components/     # ProtectedRoute (role guard), StatusBadge
  pages/          # One file per screen
  utils/date.ts   # fmtDate / fmtDateTime — always use for dates (DD/MM/AAAA, es-AR locale)
```

## Key patterns

**Auth**: `AuthContext` reads token + user JSON from `localStorage` on mount. `useAuth()` exposes `user`, `login()`, `logout()`, and `hasRole(...roles)`. `ProtectedRoute` takes an optional `roles` prop — redirects unauthorized users to `/`.

**API clients**: Each Axios instance in `api/` reads the token from `localStorage` directly via a request interceptor (not from context). The shipments client also has a 401 response interceptor that clears storage and redirects to `/login`.

**Branches**: Always fetched from `GET /api/v1/branches` at runtime — never hardcoded. Use `branchLabel(city, branches)` from `api/branches.ts` to map a city to a display name. `RouteTimeline` shows city + province directly from the branches array, not the display name.

**Role gates** (key examples):
- `+ New Shipment` button: hidden from managers
- Status update panel: supervisor + admin only
- Dashboard nav link: supervisor + manager + admin

## Screen → route map

| Route | Page | Roles |
|-------|------|-------|
| `/login` | Login | public |
| `/` | ShipmentList | all |
| `/new` | NewShipment | operator, supervisor, admin |
| `/shipments/:trackingId` | ShipmentDetail | all |
| `/dashboard` | Dashboard | supervisor, manager, admin |
| `/track` | PublicTracking | all |

## Shipment status update rules

The status update form in `ShipmentDetail` conditionally shows a location field based on the transition:

| Transition | Location field |
|---|---|
| `pending → in_transit` | Required — destination branch dropdown |
| `in_transit → at_branch` | Auto-derived; display only |
| `at_branch → in_transit` | Required — next branch dropdown |
| `at_branch → delivering` | Not shown |
| `delivering → at_branch` | Auto-derived from last `at_branch` event; display only |
| `delivering → delivered` | Not shown |

See the parent `../CLAUDE.md` for the full backend architecture, shipment state machine, and hardcoded user credentials.
