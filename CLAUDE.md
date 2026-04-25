# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All UI text (labels, error messages, placeholders, buttons, tooltips) must be in **Spanish (Argentina)**. No English strings in the frontend UI.

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

# Train ML model (generates model.json)
go run cmd/train/main.go

# Regenerate Swagger spec (run from logitrack_core/)
swag init -g cmd/server/main.go -o ../docs
rm ../docs/docs.go ../docs/swagger.json
# Output: docs/swagger.yaml at the repo root. Only the YAML is kept.
```

Test suite lives in `internal/service/` and `internal/handler/`. Run with `go test ./...`.

**Running tests is a required step when building any feature.** Before marking work as done:
- Backend: run `go test ./...` — all tests must pass. `go build ./...` alone is not sufficient.
- Frontend: run `npm run build` (in `logitrack_web/`) — no test framework is installed, so the TypeScript build is the validation step.

**Adding a field to `model.Shipment` requires changes in four places — all four, every time:**
1. `internal/model/shipment.go` — the struct field
2. `internal/db/migrate.go` — `CREATE TABLE` column + `ALTER TABLE ADD COLUMN IF NOT EXISTS` for existing DBs
3. `internal/projection/postgres_shipment.go` — `upsertShipment` INSERT/UPDATE, all SELECT queries (`Get`, `List`, `Search`), and both `Scan` calls (`scanShipment`, `scanShipments`)
4. `internal/seed/seed.go` — set the field in `initialShipment` if it has a meaningful value at creation time

Skipping any of these means the field silently disappears at the DB boundary.

**In-memory repositories for tests** are in `internal/repository/inmemory.go`. They implement every repository interface (Branch, Vehicle, Route, Customer, Comment) plus a helper `NewInMemoryShipmentRepository()` that wires the event-sourced repo with an in-memory `EventStore` and `ShipmentProjection`. Production code uses only the PostgreSQL implementations; `inmemory.go` exists solely to support unit tests without a real database connection.

### Architecture

Standard layered architecture — requests flow: `handler → service → repository`.

```
cmd/server/main.go          # Entry point: wires repos, services, handlers, registers routes
internal/
  model/                    # Pure data structs (no logic): Shipment, ShipmentEvent, Branch, User, Stats,
                            #   Route, Customer, ShipmentComment, DomainEvent (+ payload types), Vehicle, MLConfig
  repository/               # Interfaces + implementations; PostgreSQL-backed for Branch, Vehicle, MLConfig
                            #   shipment.go           — ShipmentRepository interface + command structs + in-memory adapter
                            #   shipment_es.go        — Event-sourced ShipmentRepository implementation (active)
                            #   event_store.go        — EventStore interface + in-memory implementation
                            #   vehicle.go            — VehicleRepository interface + in-memory implementation
                            #   postgres_vehicle.go   — PostgreSQL implementation of VehicleRepository
                            #   branch.go             — BranchRepository interface + in-memory implementation
                            #   postgres_branch.go    — PostgreSQL implementation of BranchRepository (CRUD + status)
                            #   ml_config.go          — MLConfigRepository interface
                            #   postgres_ml_config.go — PostgreSQL implementation (configs + model blobs)
                            #   auth, route, customer, comment
  projection/               # Read-model projectors built from DomainEvents
                            #   shipment.go       — ShipmentProjection (write-through materialized view)
  service/                  # Business logic: shipment (status transitions, tracking ID, estimated delivery),
                            #   branch (CRUD, status management, active-only listing, search by name/ID/city;
                            #           sentinel errors: ErrBranchNotFound, ErrBranchDuplicateName, ErrBranchNotActive),
                            #   route (driver route assignment/validation), comment (add/list with rules),
                            #   ml_config (train, save, activate, recalculate active shipment priorities)
  handler/                  # Gin HTTP handlers: shipment, auth, branch, driver, user, customer, comment, vehicle, ml_config
  ml/                       # RandomForest priority prediction: config (SetFactors/SetThresholds), dataset generation, train/predict
  middleware/               # Auth (Bearer token check) + RequireRoles (role-based access)
  seed/                     # LoadBranches() (in branch_seed.go) + LoadVehicles() + Load(EventStore, *ShipmentProjection, CustomerRepo)
cmd/train/main.go           # CLI to train and save the ML model (model.json)
```

**ML priority prediction** is integrated directly into the backend (no separate service). Uses `github.com/malaschitz/randomForest` for the RandomForest classifier. The ML pipeline (config → dataset → train → predict) lives in `internal/ml/`.

**Model storage**: the trained model is stored as a BYTEA blob in the `ml_models` PostgreSQL table, linked to the active `ml_configs` row. On startup, `MLConfigService.InitFromDB()` loads the active config's factors/thresholds and hot-loads the model blob from DB. Fallback chain: DB model → file (`ML_MODEL_PATH` env var, default `model.json`) → auto-train with defaults (if neither exists). `cmd/train/main.go` still exists as a CLI tool to generate a file-based model for the initial Docker build.

**Factor weights and thresholds are configurable at runtime** by admins via `POST /api/v1/ml/config/regenerate`. On regeneration: the new config is saved to `ml_configs`, the forest is retrained with the new weights, the blob is saved to `ml_models`, the in-memory model is hot-swapped, and priorities are recalculated for all non-terminal shipments. Previous configurations are retained as history and can be re-activated via `POST /api/v1/ml/config/:id/activate`.

**Priority is computed and persisted** in three moments:
- `Create` — predicted from `CreateShipmentRequest` before the repo call; stored on the shipment.
- `ConfirmDraft` — predicted from the draft shipment before `ConfirmDraftCmd`; passed in the cmd so the projection persists it in the `EventDraftConfirmed` handler.
- `CorrectShipment` — re-predicted when any ML-relevant field is corrected (`shipment_type`, `time_window`, `cold_chain`, `is_fragile`, `origin_province`, `destination_province`). The effective values are computed as: original shipment → apply all previously stored corrections → apply incoming correction. This ensures successive edits are consistent.

**Priority fields** stored on `Shipment` and persisted to DB:
- `priority` — `"alta"` / `"media"` / `"baja"` (thresholds are configurable; defaults: alta > 0.65, media > 0.35)
- `priority_score` — 0.0–1.0 weighted score
- `priority_confidence` — 0.0–1.0 forest vote share for the winning class
- `priority_factors` — `map[string]FactorDetail` per-factor breakdown (JSONB in DB)

**Priority factor weights** — configurable by admin (range 1.0–5.0); defaults:

| Factor | Default weight | Normalization |
|--------|---------------|--------------|
| `shipment_type` | 3.0 | express=1.0 / normal=0.0 |
| `distance_km` | 2.5 | Haversine(origin, dest) / 2500 |
| `restrictions` | 2.0 | (is_fragile + cold_chain) / 2 |
| `time_window` | 1.5 | morning=1.0 / afternoon=0.5 / flexible=0.0 |
| `volume_score` | 1.0 | (pkg_base + weight_kg/2) / 25 |
| `route_saturation` | 0.8 | deterministic FNV hash of "origin-dest" route |

Province coordinates for distance (all 24 Argentine provinces + CABA) are defined in `internal/ml/dataset.go ProvinceCoords`. Unknown provinces fall back to Ciudad de Buenos Aires.

**The Dockerfile trains the model** at build time (`RUN go run cmd/train/main.go model.json`) to produce an initial `model.json`. At runtime, if the DB already has an active config with a model blob, that takes precedence and the file is ignored. `model.json` is in `.gitignore`.

**Event sourcing — shipments.** `DomainEvent` objects are the source of truth. Shipment state is never mutated directly; instead each write operation appends a domain event to the `EventStore` and applies it to the `ShipmentProjection` (materialized view). Reads (List, Search, Stats, GetByTrackingID) are served from the projection. `GetEvents` transforms `DomainEvent`s back to the `ShipmentEvent` API format.

**State is persisted in PostgreSQL (RDS).** `EventStore` and `ShipmentProjection` are backed by the database — the service and handler layers are unchanged from the in-memory design.

**ShipmentRepository interface** uses command structs (not raw field parameters). Each command carries everything needed to build the domain event internally: `CreateShipmentCmd`, `SaveDraftCmd`, `UpdateDraftCmd`, `ConfirmDraftCmd`, `StatusUpdateCmd`, `CorrectCmd`, `CancelCmd`. The methods `UpdateLocation`, `SetDeliveredAt`, and `AddEvent` no longer exist — their effects are absorbed into the relevant commands.

**Auth** uses UUID tokens stored in PostgreSQL (`tokens` table). `POST /api/v1/auth/login` returns a token; all other routes require `Authorization: Bearer <token>`. Tokens persist across restarts.

**Users** — persisted in the `users` PostgreSQL table. `NewPostgresAuthRepository` upserts the seed users on every startup (`ON CONFLICT (username) DO UPDATE`), so code changes are applied after restart. To add/modify seed users, edit the seed slice in `postgres_auth.go`. Users can also be managed at runtime via the admin backoffice (`GET/POST /admin/users`, `PATCH /admin/users/:id`).

**Branch assignment**: operators, supervisors, and drivers have a `branch_id` assigned. This controls:
- **Operators**: `GET /shipments` is server-side filtered to their branch; `GET /shipments/:id`, `/events`, `/comments` return 403 for shipments outside their branch; they can only modify shipments in their branch (enforced in handler via `branchForbidden`). When creating shipments, `receiving_branch_id` is forced to their branch.
- **Supervisors**: `GET /shipments` is server-side filtered to their branch when `branch_id` is passed (the UI always sends it); can access any shipment via `GET /shipments/:id`; can only modify shipments in their branch (same `branchForbidden` guard as operators). When creating, `receiving_branch_id` is forced to their branch. For fleet operations: can only **start trips** for vehicles whose `assigned_branch` matches their branch; can only **end trips** for vehicles whose `destination_branch` matches their branch.
- **Drivers**: `GET /users/drivers?branch_id=X` matches their `branch_id`; used when assigning drivers to delivering status.
- Manager and admin have no branch assignment and no fleet restrictions.

| Username | Password | Role | Branch |
|---|---|---|---|
| `op_caba` | `op_caba123` | Operator | caba |
| `sup_caba` | `sup_caba123` | Supervisor | caba |
| `chofer_caba` | `chofer_caba123` | Driver | caba |
| `op_cordoba` | `op_cordoba123` | Operator | cordoba |
| `sup_cordoba` | `sup_cordoba123` | Supervisor | cordoba |
| `chofer_cordoba` | `chofer_cordoba123` | Driver | cordoba |
| `op_mendoza` | `op_mendoza123` | Operator | mendoza |
| `sup_mendoza` | `sup_mendoza123` | Supervisor | mendoza |
| `chofer_mendoza` | `chofer_mendoza123` | Driver | mendoza |
| `gerente` | `gerente123` | Manager | — |
| `admin` | `admin123` | Admin | — |

`chofer_caba` has ID `"5"` — referenced by the route seed (`ROUTE-SEED0001`). Do not change that ID.

**Tracking ID formats**:
- Confirmed shipments: `LT-XXXXXXXX` (generated on create or on draft confirmation)
- Drafts: `DRAFT-XXXXXXXX` (replaced by a real `LT-` ID when confirmed)

**Shipment state machine** (enforced in `service/shipment.go`):
```
pending (draft) ──confirm──► in_progress ──[vehicle assigned]──► pre_transit ──[StartTrip]──► in_transit ──► at_branch ──► in_transit (next hop)
                                         └──────────────────────────────────────────────────────────────────────────────├─► delivering ──► delivered
                                                                                                                         │              └─► delivery_failed ──► delivering (retry)
                                                                                                                         │                                  └─► at_branch (return leg)
                                                                                                                         ├─► ready_for_pickup ──► delivered
                                                                                                                         │                    └─► pre_transit (transfer to another branch via vehicle)
                                                                                                                         └─► ready_for_return ──► returned
```
- `pending` = draft; transitions only via `ConfirmDraft`, not `UpdateStatus`.
- `in_progress` = confirmed, awaiting vehicle assignment.
- `pre_transit` = vehicle assigned and being loaded; shipment not yet departed. Reverts to `in_progress` if unassigned from vehicle; can also go directly to `at_branch` (edge case).
- `in_transit` only goes to `at_branch` — never directly to `delivered`.
- `delivering` = out for last-mile delivery to recipient.
- `delivering` only goes to `delivered` or `delivery_failed` — never back to `at_branch` directly.
- `delivery_failed` = attempted but unsuccessful; supervisor/admin decide next step.
- `ready_for_pickup` = recipient will pick up at the current branch (any branch).
- `ready_for_return` = sender will pick up at the **origin branch** only (enforced server-side: `current_location` must equal the receiving branch's city).
- `delivered`, `returned`, `cancelled` are terminal states — no further transitions.
- Multi-hop routes repeat `at_branch → pre_transit → in_transit → at_branch` (via vehicle assignment and StartTrip).
- Cancellable states: `in_progress`, `at_branch`, `delivering`, `delivery_failed`, `ready_for_pickup`, `ready_for_return`. States `pre_transit` and `in_transit` cannot be cancelled (vehicle is actively loaded/in movement). `pending` and terminal states cannot be cancelled either.

**DNI validation** (enforced before any repo write in `service/shipment.go`):
- `→ delivered`: `recipient_dni` required and must match `shipment.recipient_dni`.
- `→ returned`: `sender_dni` required and must match `shipment.sender_dni`.
- Validation happens **before** `repo.UpdateStatus()` to prevent state corruption on a failed attempt.

**Field format validation** (enforced in `service/shipment.go` for `Create`, `SaveDraft`, `UpdateDraft`, `ConfirmDraft`):
- `sender_dni` / `recipient_dni`: must contain only digits. In drafts, validated only when the field is non-empty; required and validated on `Create` and `ConfirmDraft`.
- `sender_email` / `recipient_email`: must match `user@domain.tld` format. Validated only when non-empty (emails are optional).

**`location` field on status updates** — rules vary by transition:
- `in_progress → pre_transit`: set automatically by vehicle assignment (no manual status update needed)
- `pre_transit → in_transit`: set automatically by `StartTrip` (destination branch city); do not send manually
- `in_transit → at_branch`: auto-derived from last `in_transit` event; do not send
- `at_branch → pre_transit`: set automatically by vehicle assignment; do not send manually
- `at_branch → delivering`: not required (going to recipient, not a branch)
- `at_branch → ready_for_pickup`: not required
- `at_branch → ready_for_return`: not required
- `ready_for_pickup → pre_transit`: set automatically by vehicle assignment
- `delivering → delivered`: not required
- `delivering → delivery_failed`: not required
- `delivery_failed → at_branch`: not required — auto-derived from the last `at_branch` event

**Role-based route permissions** (defined in `main.go`):
- Non-driver roles (operator, supervisor, manager, admin): GET /shipments, /branches, /branches/search, /search, /customers, /vehicles
- All roles including driver: GET /shipments/:id, /shipments/:id/events, /shipments/:id/comments, /vehicles/by-shipment/:trackingId
- Operator + Supervisor + Admin: POST /shipments, /shipments/draft; PATCH /shipments/:id/draft; POST /shipments/:id/confirm
- Operator + Supervisor + Admin + Driver: PATCH /shipments/:id/status (operator and driver further restricted in handler — see below)
- Operator + Supervisor + Admin: POST /shipments/:id/comments
- Supervisor + Manager + Admin: GET /stats, /vehicles/by-plate/:plate
- Operator + Supervisor + Manager + Admin: GET /vehicles/available
- Supervisor + Admin: GET /users/drivers; PATCH /vehicles/by-plate/:plate/status; POST /vehicles/by-plate/:plate/assign-branch, /start-trip, /end-trip; DELETE /vehicles/by-plate/:plate/shipments/:trackingId
- Operator + Supervisor + Admin: POST /vehicles/by-plate/:plate/assign (assigns shipment to vehicle → pre_transit)
- Admin only: POST /vehicles (create vehicle); POST /branches, PATCH /branches/:id, PATCH /branches/:id/status
- Admin only: GET /ml/config, GET /ml/config/history, POST /ml/config/regenerate, POST /ml/config/:id/activate
- Driver only: GET /driver/route

**Operator restrictions** (enforced in `handler/shipment.go UpdateStatus`):
- Operators cannot update a shipment that is in `delivering` status — all transitions from `delivering` are reserved for supervisor, admin, and driver. Transitions to `delivered` from other states (e.g. `ready_for_pickup → delivered`) are allowed.

**Branch restrictions** (enforced via `branchForbidden` in `handler/shipment.go`, `comment.go`, `vehicle.go`):
- Operators and supervisors with a `branch_id` get 403 on any write operation (status update, correction, cancellation, comment, vehicle assign) for shipments whose `receiving_branch_id` differs from their own.
- Operators additionally get 403 on read operations (`GET /shipments/:id`, `/events`, `/comments`) for out-of-branch shipments.
- For fleet: supervisors can only call `/start-trip` on vehicles where `assigned_branch` matches their branch, and only call `/end-trip` on vehicles where `destination_branch` matches their branch. Admins are unrestricted.

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
- Stored in `Shipment.Corrections ShipmentCorrections` (typed struct with `*field` pointers); corrections accumulate on successive calls via `Merge()`.
- Endpoint: `PATCH /shipments/:tracking_id/correct` — supervisor and admin only.
- Blocked on `pending` (edit the draft directly) and terminal states (`delivered`, `returned`, `cancelled`).
- Each corrected field auto-generates a comment: `[Correction] <label>. New value: <value>`.
- Creates a `ShipmentEvent` with `event_type: "edited"` (status unchanged).
- `ShipmentHandler` holds a reference to `CommentService` to persist auto-comments after corrections.
- Correctable fields include all sender/recipient/address fields plus: `weight_kg`, `package_type`, `special_instructions`, `shipment_type`, `time_window`, `cold_chain`, `is_fragile`.
- When any ML-relevant field is corrected, priority is automatically recomputed and persisted (passed in `CorrectCmd.Prediction`, handled in the `EventShipmentCorrected` projection handler).

**Cancellation** (service/shipment.go `CancelShipment`):
- Endpoint: `POST /shipments/:tracking_id/cancel` — supervisor and admin only.
- Body: `{ "reason": "..." }` — reason is required; returns 400 if empty.
- Blocked on `pending` and all terminal states (`delivered`, `returned`, `cancelled`).
- On success: transitions to `cancelled`, creates a `ShipmentEvent` (from_status → cancelled), and auto-adds a comment `[Cancelación] <reason>`.

**Customer autocomplete** (handler/customer.go, repository/customer.go):
- `GET /customers?dni=XXXXX` returns a stored customer by exact DNI match.
- Customers are auto-upserted whenever a shipment is created (both sender and recipient).
- In `NewShipment`, typing ≥7 digits triggers a lookup after 400ms debounce. If a match is found, a suggestion popover appears below the DNI field with the customer's name, phone and city — the user must click "Use data" to apply it. Nothing is auto-filled without confirmation.

**Comments** (`handler/comment.go`, `repository/postgres_comment.go`) are persisted in the `shipment_comments` PostgreSQL table. The `CommentHandler` holds a `ShipmentService` reference to enforce that operators can only comment on shipments in their own branch.

**`receiving_branch_id` lifecycle**: when a shipment transitions to `at_branch`, both projections (in-memory and Postgres) update `receiving_branch_id` to the new branch. This means operators and supervisors at the destination branch will see the shipment in their filtered list after it arrives.

**Fleet management** (handler/vehicle.go, repository/vehicle.go, model/vehicle.go):
- Vehicles are fleet assets tracked independently of shipments and drivers.
- Each vehicle has: `license_plate` (unique), `type` (motocicleta/furgoneta/camion/camion_grande), `capacity_kg`, `status`, `assigned_branch` (current branch ID), `destination_branch` (set during a trip), `assigned_shipments` (list of tracking IDs currently loaded).
- **Vehicle statuses**: `disponible` → `en_carga` (shipments being loaded) → `en_transito` (trip in progress) → back to `disponible` on `EndTrip`. Also: `mantenimiento` and `inactivo` (manual transitions, require `force: true` if shipments are assigned).
- **Vehicle → Shipment lifecycle**:
  1. `POST /vehicles/by-plate/:plate/assign` — assigns a shipment to the vehicle; shipment transitions to `pre_transit`; vehicle moves from `disponible` to `en_carga`.
  2. `DELETE /vehicles/by-plate/:plate/shipments/:trackingId` — removes a shipment while `en_carga`; shipment reverts to `at_branch`; vehicle returns to `disponible` if no shipments remain.
  3. `POST /vehicles/by-plate/:plate/start-trip` — body: `{ "destination_branch": "<id>" }`; all assigned shipments transition to `in_transit`; vehicle moves to `en_transito`. Only the supervisor of the vehicle's **current branch** (`assigned_branch`) can call this; admins are unrestricted.
  4. `POST /vehicles/by-plate/:plate/end-trip` — all assigned shipments transition to `at_branch` at destination city; vehicle moves to `disponible` at the destination branch; shipments list is cleared. Only the supervisor of the vehicle's **destination branch** (`destination_branch`) can call this; admins are unrestricted.
- **Assignment rules**: vehicle must be `disponible` or `en_carga`; vehicle must have an `assigned_branch`; shipment must be `in_progress`, `at_branch`, or `ready_for_pickup`; shipment's branch must match vehicle's `assigned_branch`; total weight of assigned shipments must not exceed `capacity_kg`.
- **`GET /vehicles/available`** — optional query params: `type`, `min_capacity`, `branch_id`. Returns vehicles with status `disponible` or `en_carga`.
- **`GET /vehicles/by-shipment/:trackingId`** — returns the vehicle (if any) currently assigned to that shipment. Available to all roles.

### Adding a new endpoint

1. Add struct to `internal/model/` if needed
2. Add method to the repository interface and its Postgres implementation
3. Add method to the service
4. Add handler method and register route in `handler/`
5. Apply role middleware in `main.go`

There are no in-memory repository implementations — all persistence is PostgreSQL.

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
  api/          # Axios clients: shipments.ts, auth.ts, branches.ts, driver.ts, users.ts, customers.ts, vehicles.ts, mlConfig.ts, admin.ts
                # shipments.ts has request interceptor (adds Bearer token) and
                # response interceptor (redirects to /login on 401)
                # publicTracking.ts — unauthenticated client for the public /track page;
                #   no auth headers, no 401 redirect; calls /api/v1/public/* endpoints
  context/      # AuthContext: stores user + token in localStorage, exposes login/logout/hasRole
  components/   # ProtectedRoute (role guard), StatusBadge, PriorityBadge
  pages/        # One file per screen (including BranchList, DriverRoute, DriverShipmentDetail, VehicleList, VehicleStatus, VehicleAssignment, AvailableVehicles, MLConfig, AdminUsers)
  utils/date.ts # fmtDate / fmtDateTime — always use these for date display (DD/MM/AAAA format)
```

**Auth flow**: `AuthContext` reads from `localStorage` on mount. `ProtectedRoute` redirects unauthenticated users to `/login` and unauthorized roles to `/`. The 401 interceptor in `api/shipments.ts` clears localStorage and redirects when the backend token expires (e.g. after a server restart).

**Role-gated UI** uses `hasRole(...roles)` from `useAuth()`. Key gates:
- `+ New Shipment` button: hidden from managers
- Status update panel in `ShipmentDetail`: operator + supervisor + admin, hidden for operators/supervisors viewing a shipment outside their branch
- Dashboard nav link: only supervisor + manager + admin
- `✏️ Edit data` button in `ShipmentDetail`: operator + supervisor + admin; hidden on terminal statuses; hidden for operators/supervisors viewing a shipment outside their branch
- `Cancel shipment` button in `ShipmentDetail`: only supervisor + admin; hidden for operators/supervisors viewing a shipment outside their branch
- Fleet nav link (`Fleet`): all non-driver roles
- Vehicle assignment panel in `ShipmentDetail`: operator + supervisor + admin, shown when shipment is `in_progress`, `at_branch`, or `ready_for_pickup`
- ML Config nav link: admin only
- Users nav link: admin only (`/admin/users`)
- Branches nav link: supervisor + manager + admin (not operator)
- `Export CSV` button in `ShipmentList`: only admin + manager; exports the currently filtered shipments (state, branch, date range, search text all applied)

**Branch-scoped UI**:
- `ShipmentList` branch filter: operators see a locked badge (their branch, no dropdown); supervisors default to their branch but can switch; manager/admin see all
- `VehicleList` branch filter: same pattern — operator locked, supervisor defaults to own branch. The filter matches vehicles where `assigned_branch` **or** `destination_branch` equals the selected branch (client-side)
- `NewShipment` receiving branch: pre-filled and locked for operator + supervisor; free select for admin
- `ShipmentDetail` action buttons (Edit, Cancel, Update Status, Comments): hidden via `operatorOutOfBranch` for operators **and supervisors** viewing shipments outside their branch
- `VehicleList` Start Trip button: disabled for supervisors when the vehicle's `assigned_branch` ≠ their branch; End Trip button: disabled when `destination_branch` ≠ their branch

**Branches** are fetched from `GET /api/v1/branches` at runtime — never hardcoded in the frontend. The `branchLabel(city, branches)` helper in `api/branches.ts` maps a city string to a display name. In `RouteTimeline`, nodes show city + province directly from the branches array (not the display name). Use `branchApi.listActive()` for dropdowns that should only offer operational branches (e.g. receiving branch on new shipment). The `Branch` interface exposes `address` (street, city, province, postal_code), `status`, `created_at`, `updated_at`, `updated_by`. Helpers `statusLabel()` and `statusColor()` are in `api/branches.ts`.

**Branch dropdowns** (receiving branch in NewShipment, destination branch in VehicleList start-trip) group options by province with `<optgroup>` and sort both provinces and branches within each group alphabetically via `localeCompare`.

**ShipmentList filter**: the `status` query param pre-selects the filter on load (e.g. `/?status=pending`). Default filter is `active` (excludes `delivered`, `pending`, `returned`, and `cancelled`). A **branch filter** and a **date range filter** are also applied. The branch filter only shows active branches. Operators have their branch locked server-side (`List` handler forces `filter.ReceivingBranchID = user.BranchID`); supervisors default to their branch but can change it. Date filtering is client-side using local timezone.

**Draft workflow**: drafts (`pending`) are created via `POST /shipments/draft` and edited via `PATCH /shipments/:id/draft`. After saving changes in `ShipmentDetail`, the UI redirects to `/?status=pending` (shipment list pre-filtered to Draft). Confirming a draft via `POST /shipments/:id/confirm` generates a real `LT-` tracking ID and moves the shipment to `in_progress`.

**Shipment list ordering**: the backend returns shipments sorted by tracking ID ascending (`List()` and `Search()` both apply `sort.Slice`).

**DriverRoute** (`/driver/route`) shows today's assigned shipments with a search field that filters by tracking ID or recipient name (including corrected values).

**VehicleList** (`/vehicles`) has a **Load Shipments** button on each `disponible`/`en_carga` vehicle (operator + supervisor + admin). Opens a modal where you type the trailing part of the tracking ID (e.g. `A1B2C3D4` → `LT-A1B2C3D4`), which calls `POST /vehicles/by-plate/:plate/assign` immediately per shipment. The vehicle branch must match the shipment's current branch; status must be `in_progress`, `at_branch`, or `ready_for_pickup`.

**Public tracking page** (`/track`): rendered as a completely standalone page — it is declared as a top-level route in `App.tsx` before `AppRoutes`, so it bypasses the auth check and the `Nav` component entirely. It uses `api/publicTracking.ts` (no Bearer token) to call the `/api/v1/public/*` endpoints. The event history is translated into user-friendly language (no internal status names, no `changed_by`, no internal notes); only city + province and timestamps are shown. Deep-linking is supported via `?id=LT-XXXX`.

**`location` field on `ShipmentEvent`** is inconsistent by origin: seed events store the branch ID (e.g. `"caba"`, `"cordoba"`), while events generated at runtime by the vehicle handler store the branch's `address.city` string (e.g. `"Ciudad de Buenos Aires"`). Any code that resolves a branch from an event's `location` must try both: `branches.find(b => b.address.city === loc) ?? branches.find(b => b.id === loc)`.

**CSV export**: admin and manager can download the currently filtered shipment list as a CSV file via the "Export CSV" button. The export is client-side (no extra API call) and reflects all active filters. Corrected field values take precedence over originals. File name format: `shipments_YYYY-MM-DD.csv`. Sender/recipient names are intentionally excluded (personal data — Ley 25.326); no DNI, email, phone, or full address is exported. See spec US-074.

### Screen → route map

| Route | Component | Roles |
|-------|-----------|-------|
| `/login` | Login | public |
| `/` | ShipmentList | all (non-driver) |
| `/new` | NewShipment | operator, supervisor, admin |
| `/shipments/:trackingId` | ShipmentDetail | all (non-driver) |
| `/dashboard` | Dashboard | supervisor, manager, admin |
| `/track` | PublicTracking | **public — no login required** |
| `/driver/route` | DriverRoute | driver |
| `/shipments/:trackingId` | DriverShipmentDetail | driver (misma URL, componente diferente al no-driver) |
| `/vehicles` | VehicleList | all (non-driver) |
| `/vehicles/:plate/status` | VehicleStatus | supervisor, manager, admin |
| `/vehicles/:plate/assign` | VehicleAssignment | supervisor, admin |
| `/vehicles/available` | AvailableVehicles | supervisor, manager, admin |
| `/branches` | BranchList | supervisor, manager, admin |
| `/ml-config` | MLConfig | admin |
| `/admin/users` | AdminUsers | admin |

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

Seven core entities plus supporting value objects:

| Entity | Key fields | Notes |
|--------|-----------|-------|
| **Shipment** | tracking_id, status, sender/recipient info, origin/destination (Address), weight_kg, package_type, shipment_type, time_window, cold_chain, is_fragile, receiving_branch_id, current_location, timestamps, priority, priority_score, priority_confidence, priority_factors, corrections | Central aggregate. Tracking ID is `LT-XXXX` (confirmed) or `DRAFT-XXXX` (pending). `corrections` is a typed `ShipmentCorrections` struct of non-destructive field overrides. Priority fields are set by the ML service on create/confirm/correct. |
| **ShipmentEvent** | id, tracking_id, event_type, from_status, to_status, changed_by, location, notes, timestamp | Immutable audit log of every status change. `event_type`: `"status_change"` or `"edited"`. |
| **ShipmentComment** | id, tracking_id, author, body, created_at | Internal notes on a shipment. Cannot be added to finalized shipments. |
| **Branch** | id, name, address (street, city, province, postal_code), province, status, created_at, updated_at, updated_by | Logistics warehouses/branches. Persistent in PostgreSQL. Statuses: activo, inactivo, fuera_de_servicio. CRUD via service/branch.go. |
| **User** | id, username, role, branch_id | Auth identity. Persisted in `users` table. `branch_id` required for operator/supervisor/driver. Roles: `operator`, `supervisor`, `manager`, `admin`, `driver`. |
| **Route** | id, date, driver_id, shipment_ids[], created_by, created_at | Links a driver to shipments for a given day. ID format: `ROUTE-XXXXXXXX`. |
| **Customer** | dni, name, phone, email, address | Auto-populated from shipment sender/recipient data. Used for DNI autocomplete. |
| **Vehicle** | id, license_plate, type, capacity_kg, status, updated_at, updated_by, assigned_shipments[], assigned_branch, destination_branch | Fleet vehicle. `license_plate` is unique. `assigned_branch` = current branch; `destination_branch` set during a trip. Persisted in PostgreSQL via `postgres_vehicle.go`. |
| **MLConfig** | id, factors (map), alta_threshold, media_threshold, is_active, created_by, created_at, notes | One active config at a time. Factor weights range 1.0–5.0. History retained indefinitely. Model blob stored separately in `ml_models` table (BYTEA). |

**Value objects**: `Address` (street, city, province, postal_code), `Status` (enum), `PackageType` (enum: envelope, box, pallet), `ShipmentType` (enum: normal, express), `TimeWindow` (enum: morning, afternoon, flexible), `Role` (enum), `VehicleStatus` (enum: disponible, en_carga, mantenimiento, en_transito, inactivo), `VehicleType` (enum: motocicleta, furgoneta, camion, camion_grande).

**Key relationships**:
- Shipment 1→N ShipmentEvent (status history)
- Shipment 1→N ShipmentComment (internal notes)
- Shipment N→1 Branch (via receiving_branch_id)
- Route N→N Shipment (via shipment_ids)
- Route N→1 User/Driver (via driver_id)
- Vehicle N→N Shipment (via assigned_shipments — tracking IDs currently loaded on the vehicle)
- Vehicle N→1 Branch (via assigned_branch)

## Seed data

On startup, `seed.Load()` populates 6 branches, 15 sample shipments, and 3 sample vehicles:

**Branches** (seed/branch_seed.go `LoadBranches`): 6 branches, persisted in PostgreSQL. 3 are `activo` (caba, cordoba, mendoza), 2 are `inactivo` (jujuy, posadas), 1 is `fuera_de_servicio` (bariloche). Seeded via `Create` with duplicate-name protection — idempotent on restart. The seed does **not** delete removed branches from the DB; wipe the DB to remove stale entries.

Branch `name` follows the format `XXXX-NN` — 4-letter code derived from the city name + 2-digit counter per city (e.g. `CDBA-01` for Ciudad de Buenos Aires, `CORD-01` for Córdoba). Increment the counter (`-02`, `-03`) if a second branch exists in the same city.

**Sample shipments** cover key scenarios (all events follow valid state machine transitions including `pre_transit`):
- `LT-A1B2C3D4`: at_branch (Córdoba) — single-hop from CABA
- `LT-E5F6G7H8`: delivered (Mendoza) — completed express delivery from CABA
- `LT-I9J0K1L2`: in_progress (CABA) — just created, awaiting dispatch
- `LT-M3N4O5P6`: at_branch (Mendoza) — originated at Córdoba
- `LT-Q7R8S9T0`: delivered (CABA) — originated from Córdoba
- `LT-U1V2W3X4`: in_progress (CABA) — recently created
- `LT-DELIVER01`: delivering (CABA) — out for last-mile delivery, assigned to `chofer_caba` (ID 5)
- `LT-DELIVER02`: at_branch (CABA) — arrived from Córdoba, ready for delivery
- `LT-CABA0001`: in_progress (CABA) — registered by `op_caba`
- `LT-CABA0002`: at_branch (Córdoba) — dispatched from CABA
- `LT-CABA0003`: at_branch (CABA) — arrived, ready for last-mile
- `LT-MEND0001`: in_progress (Mendoza) — registered by `op_mendoza`
- `LT-MEND0002`: at_branch (CABA) — dispatched from Mendoza
- `LT-MEND0003`: delivered (Mendoza) — completed
- `LT-MULTI001`: at_branch (Mendoza) — multi-hop: CABA→Córdoba→Mendoza with full event history

Customers from all shipments are auto-upserted into the customer repository for DNI autocomplete.

**Sample vehicles** (seed/seed.go `LoadVehicles`):
- `AB123CD`: furgoneta, 800 kg, disponible — assigned to caba
- `EF456GH`: camion, 5000 kg, disponible — assigned to cordoba
- `IJ789KL`: motocicleta, 50 kg, mantenimiento — assigned to caba

## Complete API reference

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | /api/v1/public/track/:tracking_id | public | — | Public shipment lookup by tracking ID (no auth) |
| GET | /api/v1/public/track/:tracking_id/events | public | — | Public event history for a shipment (no auth) |
| GET | /api/v1/public/branches | public | — | Public branch list used by the tracking page timeline |
| POST | /api/v1/auth/login | public | — | Login, returns token + user |
| GET | /api/v1/auth/me | Bearer | all | Current user info |
| GET | /api/v1/branches | Bearer | non-driver | List all branches (query: `status`) |
| GET | /api/v1/branches/search | Bearer | non-driver | Search by name, ID, or city (query: `q`) |
| POST | /api/v1/branches | Bearer | admin | Create new branch |
| PATCH | /api/v1/branches/:id | Bearer | admin | Edit branch data (active only) |
| PATCH | /api/v1/branches/:id/status | Bearer | supervisor, admin | Change branch status |
| GET | /api/v1/shipments | Bearer | non-driver | List shipments (query: `status`, `date_from`, `date_to`) |
| GET | /api/v1/search | Bearer | non-driver | Search by tracking ID or recipient name (query: `q`) |
| GET | /api/v1/shipments/:tracking_id | Bearer | all | Get shipment detail |
| GET | /api/v1/shipments/:tracking_id/events | Bearer | all | Get shipment event history |
| GET | /api/v1/shipments/:tracking_id/comments | Bearer | all | Get shipment comments |
| POST | /api/v1/shipments | Bearer | operator, supervisor, admin | Create confirmed shipment |
| POST | /api/v1/shipments/draft | Bearer | operator, supervisor, admin | Create draft shipment |
| PATCH | /api/v1/shipments/:tracking_id/draft | Bearer | operator, supervisor, admin | Update draft |
| POST | /api/v1/shipments/:tracking_id/confirm | Bearer | operator, supervisor, admin | Confirm draft → in_progress |
| PATCH | /api/v1/shipments/:tracking_id/status | Bearer | operator, supervisor, admin, driver | Update shipment status |
| PATCH | /api/v1/shipments/:tracking_id/correct | Bearer | operator, supervisor, admin | Apply non-destructive field corrections |
| POST | /api/v1/shipments/:tracking_id/cancel | Bearer | supervisor, admin | Cancel shipment (body: `reason` required) |
| POST | /api/v1/shipments/:tracking_id/comments | Bearer | operator, supervisor, admin | Add comment |
| GET | /api/v1/stats | Bearer | supervisor, manager, admin | Dashboard stats |
| GET | /api/v1/users/drivers | Bearer | operator, supervisor, admin | List driver users (query: `branch_id` to filter by branch) |
| GET | /api/v1/admin/users | Bearer | admin | List all users |
| POST | /api/v1/admin/users | Bearer | admin | Create user (branch required for operator/supervisor/driver) |
| PATCH | /api/v1/admin/users/:id | Bearer | admin | Update user username, role, branch_id |
| GET | /api/v1/customers?dni=X | Bearer | non-driver | Customer lookup by DNI |
| GET | /api/v1/driver/route | Bearer | driver | Get today's assigned route + shipments |
| GET | /api/v1/vehicles | Bearer | non-driver | List all vehicles |
| GET | /api/v1/vehicles/available | Bearer | operator, supervisor, manager, admin | List available vehicles (query: `type`, `min_capacity`, `branch_id`) |
| POST | /api/v1/vehicles | Bearer | admin | Create vehicle (body: `license_plate`, `type`, `capacity_kg`, `branch_id`) |
| GET | /api/v1/vehicles/by-plate/:plate | Bearer | supervisor, manager, admin | Get vehicle status by license plate |
| GET | /api/v1/vehicles/by-shipment/:trackingId | Bearer | all | Get vehicle assigned to a shipment |
| PATCH | /api/v1/vehicles/by-plate/:plate/status | Bearer | supervisor, admin | Update vehicle status (body: `status`, `notes`, `force`) |
| POST | /api/v1/vehicles/by-plate/:plate/assign | Bearer | operator, supervisor, admin | Assign shipment to vehicle; transitions shipment to pre_transit |
| POST | /api/v1/vehicles/by-plate/:plate/assign-branch | Bearer | supervisor, admin | Assign vehicle to a branch (only when disponible) |
| POST | /api/v1/vehicles/by-plate/:plate/start-trip | Bearer | supervisor, admin | Start trip; all shipments → in_transit; vehicle → en_transito |
| POST | /api/v1/vehicles/by-plate/:plate/end-trip | Bearer | supervisor, admin | End trip; all shipments → at_branch; vehicle → disponible at destination |
| DELETE | /api/v1/vehicles/by-plate/:plate/shipments/:trackingId | Bearer | supervisor, admin | Unassign shipment from vehicle (only when en_carga); shipment → at_branch |
| GET | /api/v1/ml/config | Bearer | admin | Get active ML config (factors + thresholds); returns defaults if none saved |
| GET | /api/v1/ml/config/history | Bearer | admin | List all ML config versions ordered by date desc |
| POST | /api/v1/ml/config/regenerate | Bearer | admin | Save new config, retrain model, hot-swap, recalculate active shipment priorities |
| POST | /api/v1/ml/config/:id/activate | Bearer | admin | Roll back to a previous config version |
| GET | /health | public | — | Health check |
