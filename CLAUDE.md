# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This monorepo contains two independent projects, each with its own git repository:

| Folder | Stack | Purpose |
|--------|-------|---------|
| `logitrack_core/` | Go + Gin | REST API backend |
| `logitrack_web/` | React + Vite + TypeScript | Frontend SPA |

## Backend (`logitrack_core/`)

### Commands

```bash
# Run development server (port 8080)
go run cmd/server/main.go

# Build
go build ./...

# Tidy dependencies
go mod tidy
```

No test suite yet. `go build ./...` is the primary validation step.

### Architecture

Standard layered architecture — requests flow: `handler → service → repository`.

```
cmd/server/main.go          # Entry point: wires repos, services, handlers, registers routes
internal/
  model/                    # Pure data structs (no logic): Shipment, ShipmentEvent, Branch, User, Stats
  repository/               # In-memory stores (interface + implementation); swap to Postgres here later
  service/                  # Business logic: status transitions, tracking ID generation, estimated delivery
  handler/                  # Gin HTTP handlers; one file per domain
  middleware/               # Auth (Bearer token check) + RequireRoles (role-based access)
  seed/                     # LoadBranches() + Load() called at startup to populate in-memory data
```

**All state is in-memory.** Restarting the server resets all shipments and sessions. Supabase/PostgreSQL migration means adding a new repository implementation and swapping it in `main.go` — no other layers change.

**Auth** uses UUID tokens stored in memory. `POST /api/v1/auth/login` returns a token; all other routes require `Authorization: Bearer <token>`. Tokens are lost on restart.

**Hardcoded users** (in `repository/auth.go`):
- `operator / operator123` → RoleOperator
- `supervisor / supervisor123` → RoleSupervisor
- `gerente / gerente123` → RoleManager
- `admin / admin123` → RoleAdmin

**Tracking ID formats**:
- Confirmed shipments: `LT-XXXXXXXX` (generated on create or on draft confirmation)
- Drafts: `DRAFT-XXXXXXXX` (replaced by a real `LT-` ID when confirmed)

**Shipment state machine** (enforced in `service/shipment.go`):
```
pending (draft) ──confirm──► in_progress ──► in_transit ──► at_branch ──► in_transit (next hop)
                                                                        ├─► delivering ──► delivered
                                                                        │              └─► delivery_failed ──► delivering (retry)
                                                                        │                                  └─► at_branch (return leg)
                                                                        ├─► ready_for_pickup ──► delivered
                                                                        │                    └─► in_transit (transfer to another branch)
                                                                        └─► ready_for_return ──► returned
```
- `pending` = draft; transitions only via `ConfirmDraft`, not `UpdateStatus`.
- `in_progress` = confirmed, awaiting first dispatch.
- `in_transit` only goes to `at_branch` — never directly to `delivered`.
- `delivering` = out for last-mile delivery to recipient.
- `delivering` only goes to `delivered` or `delivery_failed` — never back to `at_branch` directly.
- `delivery_failed` = attempted but unsuccessful; supervisor/admin decide next step.
- `ready_for_pickup` = recipient will pick up at the current branch (any branch).
- `ready_for_return` = sender will pick up at the **origin branch** only (enforced server-side: `current_location` must equal the receiving branch's city).
- `delivered`, `returned` are terminal states — no further transitions.
- Multi-hop routes repeat `at_branch → in_transit → at_branch`.

**DNI validation** (enforced before any repo write in `service/shipment.go`):
- `→ delivered`: `recipient_dni` required and must match `shipment.recipient_dni`.
- `→ returned`: `sender_dni` required and must match `shipment.sender_dni`.
- Validation happens **before** `repo.UpdateStatus()` to prevent state corruption on a failed attempt.

**`location` field on status updates** — rules vary by transition:
- `in_progress → in_transit`: required — destination branch city
- `in_transit → at_branch`: auto-derived from last `in_transit` event; do not send
- `at_branch → in_transit`: required — next destination branch city
- `at_branch → delivering`: not required (going to recipient, not a branch)
- `at_branch → ready_for_pickup`: not required
- `at_branch → ready_for_return`: not required
- `ready_for_pickup → in_transit`: required — destination branch city
- `delivering → delivered`: not required
- `delivering → delivery_failed`: not required
- `delivery_failed → at_branch`: not required — auto-derived from the last `at_branch` event

**Role-based route permissions** (defined in `main.go`):
- All roles: GET shipments, branches, search
- Operator + Supervisor + Admin: POST /shipments
- Supervisor + Admin: PATCH /shipments/:id/status
- Supervisor + Manager + Admin: GET /stats

### Adding a new endpoint

1. Add struct to `internal/model/` if needed
2. Add method to the repository interface and `inMemory` implementation
3. Add method to the service
4. Add handler method and register route in `handler/`
5. Apply role middleware in `main.go`

---

## Frontend (`logitrack_web/`)

### Commands

```bash
# Dev server (port 5173)
npm run dev

# Type-check + production build
npm run build

# Lint
npm run lint
```

`npm run build` runs `tsc -b` before Vite — use it to validate TypeScript.

### Architecture

```
src/
  api/          # Axios clients: shipments.ts, auth.ts, branches.ts
                # shipments.ts has request interceptor (adds Bearer token) and
                # response interceptor (redirects to /login on 401)
  context/      # AuthContext: stores user + token in localStorage, exposes login/logout/hasRole
  components/   # ProtectedRoute (role guard), StatusBadge
  pages/        # One file per screen
  utils/date.ts # fmtDate / fmtDateTime — always use these for date display (DD/MM/AAAA format)
```

**Auth flow**: `AuthContext` reads from `localStorage` on mount. `ProtectedRoute` redirects unauthenticated users to `/login` and unauthorized roles to `/`. The 401 interceptor in `api/shipments.ts` clears localStorage and redirects when the backend token expires (e.g. after a server restart).

**Role-gated UI** uses `hasRole(...roles)` from `useAuth()`. Key gates:
- `+ New Shipment` button: hidden from managers
- Status update panel in `ShipmentDetail`: only supervisor + admin
- Dashboard nav link: only supervisor + manager + admin

**Branches** are fetched from `GET /api/v1/branches` at runtime — never hardcoded in the frontend. The `branchLabel(city, branches)` helper in `api/branches.ts` maps a city string to a display name. In `RouteTimeline`, nodes show city + province directly from the branches array (not the display name).

**Draft workflow**: drafts (`pending`) are created via `POST /shipments/draft` and edited via `PATCH /shipments/:id/draft`. After saving changes in `ShipmentDetail`, the UI redirects to `/?status=pending` (shipment list pre-filtered to Draft). Confirming a draft via `POST /shipments/:id/confirm` generates a real `LT-` tracking ID and moves the shipment to `in_progress`.

**ShipmentList filter**: the `status` query param pre-selects the filter on load (e.g. `/?status=pending`). Default filter is `active` (excludes `delivered` and `pending`).

**Shipment list ordering**: the backend returns shipments sorted by tracking ID ascending (`List()` and `Search()` both apply `sort.Slice`).

### Screen → route map

| Route | Component | Roles |
|-------|-----------|-------|
| `/login` | Login | public |
| `/` | ShipmentList | all |
| `/new` | NewShipment | operator, supervisor, admin |
| `/shipments/:trackingId` | ShipmentDetail | all |
| `/dashboard` | Dashboard | supervisor, manager, admin |
| `/track` | PublicTracking | all |

---

## Specs

`specs/` contains functional specifications organized by domain (auth, roles, shipments, state machine, branches, dashboard, public tracking). Written in Given/When/Then format. New features should have a spec written first — see `specs/00-indice.md`.

## Running locally (both services)

```bash
# Terminal 1 — backend
cd logitrack_core && go run cmd/server/main.go

# Terminal 2 — frontend
cd logitrack_web && npm run dev
```

Frontend at http://localhost:5173, API at http://localhost:8080.

`VITE_API_URL` env var overrides the default API base URL (`http://localhost:8080/api/v1`).
