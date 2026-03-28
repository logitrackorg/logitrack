# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All UI text (labels, error messages, placeholders, buttons, tooltips) must be in **English**. No Spanish strings in the frontend.

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
  model/                    # Pure data structs (no logic): Shipment, ShipmentEvent, Branch, User, Stats,
                            #   Route, Customer, ShipmentComment, DomainEvent (+ payload types)
  repository/               # Interfaces + implementations; swap to Postgres here later
                            #   shipment.go       — ShipmentRepository interface + command structs + in-memory adapter
                            #   shipment_es.go    — Event-sourced ShipmentRepository implementation (active)
                            #   event_store.go    — EventStore interface + in-memory implementation
                            #   auth, branch, route, customer, comment
  projection/               # Read-model projectors built from DomainEvents
                            #   shipment.go       — ShipmentProjection (write-through materialized view)
  service/                  # Business logic: shipment (status transitions, tracking ID, estimated delivery),
                            #   route (driver route assignment/validation), comment (add/list with rules)
  handler/                  # Gin HTTP handlers: shipment, auth, branch, driver, user, customer, comment
  middleware/               # Auth (Bearer token check) + RequireRoles (role-based access)
  seed/                     # LoadBranches() + Load(EventStore, *ShipmentProjection, CustomerRepo)
```

**Event sourcing — shipments.** `DomainEvent` objects are the source of truth. Shipment state is never mutated directly; instead each write operation appends a domain event to the `EventStore` and applies it to the `ShipmentProjection` (materialized view). Reads (List, Search, Stats, GetByTrackingID) are served from the projection. `GetEvents` transforms `DomainEvent`s back to the `ShipmentEvent` API format.

**State is persisted in PostgreSQL (RDS).** `EventStore` and `ShipmentProjection` are backed by the database — the service and handler layers are unchanged from the in-memory design.

**ShipmentRepository interface** uses command structs (not raw field parameters). Each command carries everything needed to build the domain event internally: `CreateShipmentCmd`, `SaveDraftCmd`, `UpdateDraftCmd`, `ConfirmDraftCmd`, `StatusUpdateCmd`, `CorrectCmd`, `CancelCmd`. The methods `UpdateLocation`, `SetDeliveredAt`, and `AddEvent` no longer exist — their effects are absorbed into the relevant commands.

**Auth** uses UUID tokens stored in memory. `POST /api/v1/auth/login` returns a token; all other routes require `Authorization: Bearer <token>`. Tokens are lost on restart.

**Hardcoded users** (in `repository/auth.go`):
- `operator / operator123` → RoleOperator
- `supervisor / supervisor123` → RoleSupervisor
- `gerente / gerente123` → RoleManager
- `admin / admin123` → RoleAdmin
- `chofer / chofer123` → RoleDriver

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
- `delivered`, `returned`, `cancelled` are terminal states — no further transitions.
- Multi-hop routes repeat `at_branch → in_transit → at_branch`.
- Any intermediate state (`in_progress`, `in_transit`, `at_branch`, `delivering`, `delivery_failed`, `ready_for_pickup`, `ready_for_return`) can be cancelled via `CancelShipment` — `pending` and terminal states cannot.

**DNI validation** (enforced before any repo write in `service/shipment.go`):
- `→ delivered`: `recipient_dni` required and must match `shipment.recipient_dni`.
- `→ returned`: `sender_dni` required and must match `shipment.sender_dni`.
- Validation happens **before** `repo.UpdateStatus()` to prevent state corruption on a failed attempt.

**Field format validation** (enforced in `service/shipment.go` for `Create`, `SaveDraft`, `UpdateDraft`, `ConfirmDraft`):
- `sender_dni` / `recipient_dni`: must contain only digits. In drafts, validated only when the field is non-empty; required and validated on `Create` and `ConfirmDraft`.
- `sender_email` / `recipient_email`: must match `user@domain.tld` format. Validated only when non-empty (emails are optional).

**`location` field on status updates** — rules vary by transition:
- `in_progress → in_transit`: required — destination branch city; **must differ from current branch** (enforced in `service/shipment.go UpdateStatus`)
- `in_transit → at_branch`: auto-derived from last `in_transit` event; do not send
- `at_branch → in_transit`: required — next destination branch city; **must differ from current branch** (same enforcement)
- `at_branch → delivering`: not required (going to recipient, not a branch)
- `at_branch → ready_for_pickup`: not required
- `at_branch → ready_for_return`: not required
- `ready_for_pickup → in_transit`: required — destination branch city
- `delivering → delivered`: not required
- `delivering → delivery_failed`: not required
- `delivery_failed → at_branch`: not required — auto-derived from the last `at_branch` event

**Role-based route permissions** (defined in `main.go`):
- Non-driver roles (operator, supervisor, manager, admin): GET /shipments, /branches, /search, /customers
- All roles including driver: GET /shipments/:id, /shipments/:id/events, /shipments/:id/comments
- Operator + Supervisor + Admin: POST /shipments, /shipments/draft; PATCH /shipments/:id/draft; POST /shipments/:id/confirm
- Supervisor + Admin: PATCH /shipments/:id/status, POST /shipments/:id/comments
- Supervisor + Admin + Driver: PATCH /shipments/:id/status (driver further restricted in handler — see below)
- Supervisor + Manager + Admin: GET /stats
- Supervisor + Admin: GET /users/drivers
- Driver only: GET /driver/route

**Driver restrictions** (enforced in `RouteService.ValidateDriverCanUpdateShipment`):
- Drivers can only update shipments assigned to their today's route.
- Drivers can only set status to `delivered` or `delivery_failed`.

**Route system** (service/route.go):
- Routes link a driver to a list of shipments for a specific date (`YYYY-MM-DD`).
- Route ID format: `ROUTE-XXXXXXXX`.
- When a supervisor sets a shipment to `delivering` with a `driver_id`, the shipment is auto-added to that driver's route for today via `AddShipmentToDriverRoute`.
- `GET /driver/route` returns today's route + full shipment details for the authenticated driver.

**Comments** (service/comment.go):
- Supervisor and admin can add comments to any non-finalized shipment.
- Comments cannot be added to `delivered` or `returned` shipments.
- All authenticated users can read comments.

**Corrections** (service/shipment.go `CorrectShipment`, repo `ApplyCorrections`):
- Non-destructive edits for confirmed shipments — original data is never modified.
- Stored in `Shipment.Corrections map[string]string` (field key → corrected value); corrections accumulate on successive calls.
- Endpoint: `PATCH /shipments/:tracking_id/correct` — supervisor and admin only.
- Blocked on `pending` (edit the draft directly) and terminal states (`delivered`, `returned`, `cancelled`).
- Each corrected field auto-generates a comment: `[Corrección] <label>. Nuevo valor: <value>`.
- Creates a `ShipmentEvent` with `event_type: "edited"` (status unchanged).
- `ShipmentHandler` holds a reference to `CommentService` to persist auto-comments after corrections.

**Cancellation** (service/shipment.go `CancelShipment`):
- Endpoint: `POST /shipments/:tracking_id/cancel` — supervisor and admin only.
- Body: `{ "reason": "..." }` — reason is required; returns 400 if empty.
- Blocked on `pending` and all terminal states (`delivered`, `returned`, `cancelled`).
- On success: transitions to `cancelled`, creates a `ShipmentEvent` (from_status → cancelled), and auto-adds a comment `[Cancelación] <reason>`.

**Customer autocomplete** (handler/customer.go, repository/customer.go):
- `GET /customers?dni=XXXXX` returns a stored customer by exact DNI match.
- Customers are auto-upserted whenever a shipment is created (both sender and recipient).
- In `NewShipment`, typing ≥7 digits triggers a lookup after 400ms debounce. If a match is found, a suggestion popover appears below the DNI field with the customer's name, phone and city — the user must click "Use data" to apply it. Nothing is auto-filled without confirmation.

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
  api/          # Axios clients: shipments.ts, auth.ts, branches.ts, driver.ts, users.ts, customers.ts
                # shipments.ts has request interceptor (adds Bearer token) and
                # response interceptor (redirects to /login on 401)
  context/      # AuthContext: stores user + token in localStorage, exposes login/logout/hasRole
  components/   # ProtectedRoute (role guard), StatusBadge
  pages/        # One file per screen (including DriverRoute, DriverShipmentDetail)
  utils/date.ts # fmtDate / fmtDateTime — always use these for date display (DD/MM/AAAA format)
```

**Auth flow**: `AuthContext` reads from `localStorage` on mount. `ProtectedRoute` redirects unauthenticated users to `/login` and unauthorized roles to `/`. The 401 interceptor in `api/shipments.ts` clears localStorage and redirects when the backend token expires (e.g. after a server restart).

**Role-gated UI** uses `hasRole(...roles)` from `useAuth()`. Key gates:
- `+ New Shipment` button: hidden from managers
- Status update panel in `ShipmentDetail`: only supervisor + admin
- Dashboard nav link: only supervisor + manager + admin
- `✏️ Edit data` button in `ShipmentDetail`: only supervisor + admin, hidden on `pending`/`delivered`/`returned`/`cancelled`
- `Cancel shipment` button in `ShipmentDetail`: only supervisor + admin, hidden on `pending` and terminal states (`delivered`, `returned`, `cancelled`)

**Branches** are fetched from `GET /api/v1/branches` at runtime — never hardcoded in the frontend. The `branchLabel(city, branches)` helper in `api/branches.ts` maps a city string to a display name. In `RouteTimeline`, nodes show city + province directly from the branches array (not the display name).

**Draft workflow**: drafts (`pending`) are created via `POST /shipments/draft` and edited via `PATCH /shipments/:id/draft`. After saving changes in `ShipmentDetail`, the UI redirects to `/?status=pending` (shipment list pre-filtered to Draft). Confirming a draft via `POST /shipments/:id/confirm` generates a real `LT-` tracking ID and moves the shipment to `in_progress`.

**ShipmentList filter**: the `status` query param pre-selects the filter on load (e.g. `/?status=pending`). Default filter is `active` (excludes `delivered`, `pending`, `returned`, and `cancelled`). Date filtering is applied client-side using local timezone — the backend `date_from`/`date_to` params are not used, to avoid UTC/local timezone mismatches in displayed dates.

**Shipment list ordering**: the backend returns shipments sorted by tracking ID ascending (`List()` and `Search()` both apply `sort.Slice`).

### Screen → route map

| Route | Component | Roles |
|-------|-----------|-------|
| `/login` | Login | public |
| `/` | ShipmentList | all (non-driver) |
| `/new` | NewShipment | operator, supervisor, admin |
| `/shipments/:trackingId` | ShipmentDetail | all (non-driver) |
| `/dashboard` | Dashboard | supervisor, manager, admin |
| `/track` | PublicTracking | all |
| `/driver/route` | DriverRoute | driver |
| `/shipments/:trackingId` | DriverShipmentDetail | driver (misma URL, componente diferente al no-driver) |

---

## Git workflow

Branches: `main` (production, auto-deploys to Amplify) and `develop` (integration base). All feature work branches from `develop`.

```
feature/<description>     new functionality
fix/<description>         bug fix
chore/<description>       maintenance (deps, config, docs)
hotfix/<description>      urgent fix branched from main, merged back to main AND develop
```

All commits must follow [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `ci`. PRs require at least one review before merging (hotfixes excepted).

---

## Production infrastructure

| Layer | Service | Notes |
|-------|---------|-------|
| Frontend | AWS Amplify | Auto-deploy on push to `main` |
| HTTPS proxy | AWS CloudFront | Terminates TLS in front of EC2 (mixed-content fix) |
| Backend | EC2 port 8080 | Go + Gin API |
| Database | RDS PostgreSQL 17.4 | Persistent storage for events and projections |

---

## Specs

`docs/specs/` contains functional specifications organized by domain (auth, roles, shipments, state machine, branches, dashboard, public tracking). Written in Given/When/Then format. New features should have a spec written first — see `docs/specs/00-indice.md`.

## Running locally (both services)

```bash
# Terminal 1 — backend
cd logitrack_core && go run cmd/server/main.go

# Terminal 2 — frontend
cd logitrack_web && npm run dev
```

Frontend at http://localhost:5173, API at http://localhost:8080.

`VITE_API_URL` env var overrides the default API base URL (`http://localhost:8080/api/v1`).

---

## Domain model

Six core entities plus supporting value objects:

| Entity | Key fields | Notes |
|--------|-----------|-------|
| **Shipment** | tracking_id, status, sender/recipient info, origin/destination (Address), weight_kg, package_type, receiving_branch_id, current_location, timestamps, corrections | Central aggregate. Tracking ID is `LT-XXXX` (confirmed) or `DRAFT-XXXX` (pending). `corrections` is a `map[string]string` of non-destructive field overrides. |
| **ShipmentEvent** | id, tracking_id, event_type, from_status, to_status, changed_by, location, notes, timestamp | Immutable audit log of every status change. `event_type`: `"status_change"` or `"edited"`. |
| **ShipmentComment** | id, tracking_id, author, body, created_at | Internal notes on a shipment. Cannot be added to finalized shipments. |
| **Branch** | id, name, city, province | Physical logistics branches. Loaded from seed data at startup. |
| **User** | id, username, role | Auth identity. Roles: `operator`, `supervisor`, `manager`, `admin`, `driver`. |
| **Route** | id, date, driver_id, shipment_ids[], created_by, created_at | Links a driver to shipments for a given day. ID format: `ROUTE-XXXXXXXX`. |
| **Customer** | dni, name, phone, email, address | Auto-populated from shipment sender/recipient data. Used for DNI autocomplete. |

**Value objects**: `Address` (street, city, province, postal_code), `Status` (enum), `PackageType` (enum: envelope, box, pallet, fragile), `Role` (enum).

**Key relationships**:
- Shipment 1→N ShipmentEvent (status history)
- Shipment 1→N ShipmentComment (internal notes)
- Shipment N→1 Branch (via receiving_branch_id)
- Route N→N Shipment (via shipment_ids)
- Route N→1 User/Driver (via driver_id)

## Seed data

On startup, `seed.Load()` populates 8 branches and 8 sample shipments in various states:

**Branches** (seed/seed.go `LoadBranches`): caba, san-pedro, cordoba, mendoza, rio-gallegos, jujuy, posadas, ushuaia.

Branch `name` follows the format `XXXX-NN` — 4-letter code derived from the city name + 2-digit counter per city (e.g. `CDBA-01` for Ciudad de Buenos Aires, `CORD-01` for Córdoba). Increment the counter (`-02`, `-03`) if a second branch exists in the same city.

**Sample shipments** cover key scenarios:
- `LT-A1B2C3D4`: at_branch (Córdoba) — standard single-hop
- `LT-E5F6G7H8`: delivered (Mendoza) — completed delivery
- `LT-I9J0K1L2`: in_progress (CABA) — just created, awaiting first dispatch
- `LT-M3N4O5P6`: in_transit (Jujuy→Posadas) — mid-route
- `LT-Q7R8S9T0`: delivered (CABA) — completed, originated from Córdoba
- `LT-U1V2W3X4`: in_progress (CABA) — recently created, long-distance to Río Gallegos
- `LT-DELIVER01`, `LT-DELIVER02`: at_branch (CABA) — ready for last-mile delivery assignment
- `LT-MULTI001`: at_branch (Jujuy) — multi-hop: CABA→Córdoba→Mendoza→Jujuy with full event history

Customers from all shipments are auto-upserted into the customer repository for DNI autocomplete.

## Complete API reference

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | /api/v1/auth/login | public | — | Login, returns token + user |
| GET | /api/v1/auth/me | Bearer | all | Current user info |
| GET | /api/v1/branches | Bearer | non-driver | List all branches |
| GET | /api/v1/shipments | Bearer | non-driver | List shipments (query: `status`, `date_from`, `date_to`) |
| GET | /api/v1/search | Bearer | non-driver | Search by tracking ID or recipient name (query: `q`) |
| GET | /api/v1/shipments/:tracking_id | Bearer | all | Get shipment detail |
| GET | /api/v1/shipments/:tracking_id/events | Bearer | all | Get shipment event history |
| GET | /api/v1/shipments/:tracking_id/comments | Bearer | all | Get shipment comments |
| POST | /api/v1/shipments | Bearer | operator, supervisor, admin | Create confirmed shipment |
| POST | /api/v1/shipments/draft | Bearer | operator, supervisor, admin | Create draft shipment |
| PATCH | /api/v1/shipments/:tracking_id/draft | Bearer | operator, supervisor, admin | Update draft |
| POST | /api/v1/shipments/:tracking_id/confirm | Bearer | operator, supervisor, admin | Confirm draft → in_progress |
| PATCH | /api/v1/shipments/:tracking_id/status | Bearer | supervisor, admin, driver | Update shipment status |
| PATCH | /api/v1/shipments/:tracking_id/correct | Bearer | supervisor, admin | Apply non-destructive field corrections |
| POST | /api/v1/shipments/:tracking_id/cancel | Bearer | supervisor, admin | Cancel shipment (body: `reason` required) |
| POST | /api/v1/shipments/:tracking_id/comments | Bearer | supervisor, admin | Add comment |
| GET | /api/v1/stats | Bearer | supervisor, manager, admin | Dashboard stats |
| GET | /api/v1/users/drivers | Bearer | supervisor, admin | List driver users |
| GET | /api/v1/customers?dni=X | Bearer | non-driver | Customer lookup by DNI |
| GET | /api/v1/driver/route | Bearer | driver | Get today's assigned route + shipments |
| GET | /health | public | — | Health check |
