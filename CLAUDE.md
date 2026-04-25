# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All UI text (labels, error messages, placeholders, buttons, tooltips) must be in **Spanish (Argentina)**. No English strings in the frontend UI.

## Repository layout

| Folder | Stack | Purpose |
|--------|-------|---------|
| `logitrack_core/` | Go + Gin | REST API backend (port 8080) |
| `logitrack_web/` | React + Vite + TypeScript | Frontend SPA (port 5173) |

`VITE_API_URL` overrides the default API base URL (`http://localhost:8080/api/v1`).

## Backend (`logitrack_core/`)

### Commands

```bash
go run cmd/server/main.go        # dev server
go build ./...                   # build
go test ./...                    # tests (required before marking work done)
go mod tidy
swag init -g cmd/server/main.go -o ../docs && rm ../docs/docs.go ../docs/swagger.json
go run cmd/train/main.go         # train ML model → model.json
```

**Before marking work done**: run `go test ./...` — all tests must pass. `go build ./...` alone is not sufficient.

### Architecture

Standard layered architecture: `handler → service → repository`.

```
cmd/server/main.go     # entry point: wires repos, services, handlers, routes
internal/
  model/               # pure data structs: Shipment, ShipmentEvent, Branch, User, Route,
                       #   Customer, ShipmentComment, DomainEvent, Vehicle, MLConfig
  repository/          # interfaces + PostgreSQL implementations (shipment_es.go is active ES impl)
  projection/          # ShipmentProjection — write-through materialized view from DomainEvents
  service/             # business logic: shipment, branch, route, comment, ml_config
  handler/             # Gin HTTP handlers
  ml/                  # RandomForest priority prediction (config, dataset, train/predict)
  middleware/          # Bearer token auth + RequireRoles
  seed/                # LoadBranches, LoadVehicles, Load(EventStore, Projection, CustomerRepo)
cmd/train/main.go      # CLI: train and save model.json
```

**Adding a field to `model.Shipment` requires changes in four places — all four, every time:**
1. `internal/model/shipment.go` — the struct field
2. `internal/db/migrate.go` — `CREATE TABLE` column + `ALTER TABLE ADD COLUMN IF NOT EXISTS`
3. `internal/projection/postgres_shipment.go` — `upsertShipment` INSERT/UPDATE, all SELECT queries, both `Scan` calls
4. `internal/seed/seed.go` — set the field in `initialShipment` if meaningful at creation time

Skipping any of these means the field silently disappears at the DB boundary.

**In-memory repositories** (`internal/repository/inmemory.go`) implement every interface for unit tests only. Production uses PostgreSQL exclusively.

### Event sourcing — shipments

`DomainEvent` objects are the source of truth. Each write appends a domain event to `EventStore` and applies it to `ShipmentProjection`. Reads (List, Search, Stats, GetByTrackingID) are served from the projection.

**ShipmentRepository** uses command structs: `CreateShipmentCmd`, `SaveDraftCmd`, `UpdateDraftCmd`, `ConfirmDraftCmd`, `StatusUpdateCmd`, `CorrectCmd`, `CancelCmd`.

### Auth & Users

UUID tokens in PostgreSQL `tokens` table. `Authorization: Bearer <token>` required on all routes except public/login. `NewPostgresAuthRepository` upserts seed users on every startup via `ON CONFLICT (username) DO UPDATE`.

### Seed users

| Username | Password | Role | Branch |
|---|---|---|---|
| `op_caba` | `op_caba123` | operator | caba |
| `sup_caba` | `sup_caba123` | supervisor | caba |
| `chofer_caba` | `chofer_caba123` | driver | caba |
| `op_cordoba` | `op_cordoba123` | operator | cordoba |
| `sup_cordoba` | `sup_cordoba123` | supervisor | cordoba |
| `chofer_cordoba` | `chofer_cordoba123` | driver | cordoba |
| `op_mendoza` | `op_mendoza123` | operator | mendoza |
| `sup_mendoza` | `sup_mendoza123` | supervisor | mendoza |
| `chofer_mendoza` | `chofer_mendoza123` | driver | mendoza |
| `gerente` | `gerente123` | manager | — |
| `admin` | `admin123` | admin | — |

`chofer_caba` has ID `"5"` — referenced by route seed (`ROUTE-SEED0001`). Do not change that ID.

### Tracking ID formats

- Confirmed shipments: `LT-XXXXXXXX`
- Drafts: `DRAFT-XXXXXXXX` (replaced by `LT-` on confirm)

### Shipment state machine

```
pending ──confirm──► in_progress ──[vehicle]──► pre_transit ──[StartTrip]──► in_transit ──► at_branch ──► in_transit (next hop)
                                                                                                        ├─► delivering ──► delivered
                                                                                                        │              └─► delivery_failed ──► delivering (retry)
                                                                                                        │                                  └─► at_branch (return leg)
                                                                                                        ├─► ready_for_pickup ──► delivered
                                                                                                        │                    └─► pre_transit (transfer via vehicle)
                                                                                                        └─► ready_for_return ──► returned
```

- `pending` = draft; transitions only via `ConfirmDraft`, not `UpdateStatus`.
- `pre_transit`: reverts to `in_progress` if unassigned from vehicle.
- `in_transit` only goes to `at_branch` — never directly to `delivered`.
- `delivering` only goes to `delivered` or `delivery_failed`.
- `ready_for_return`: `current_location` must equal the receiving branch's city (enforced server-side).
- Terminal states: `delivered`, `returned`, `cancelled` — no further transitions.
- Cancellable: `in_progress`, `at_branch`, `delivering`, `delivery_failed`, `ready_for_pickup`, `ready_for_return`. NOT cancellable: `pre_transit`, `in_transit`, `pending`, terminal.

### Business rules

**DNI validation** (before any repo write in `service/shipment.go`):
- `→ delivered`: `recipient_dni` required and must match `shipment.recipient_dni`.
- `→ returned`: `sender_dni` required and must match `shipment.sender_dni`.

**Field format validation** (`Create`, `SaveDraft`, `UpdateDraft`, `ConfirmDraft`):
- DNI: digits only. In drafts, only when non-empty; required on `Create`/`ConfirmDraft`.
- Email: `user@domain.tld` format. Only when non-empty (optional).

**`location` field on status updates** — most transitions set it automatically:
- `→ pre_transit`: set by vehicle assignment
- `→ in_transit`: set by `StartTrip`
- `in_transit → at_branch`: auto-derived from last `in_transit` event
- `delivery_failed → at_branch`: auto-derived from last `at_branch` event
- All other transitions: not required

**`receiving_branch_id` lifecycle**: on `at_branch`, both projections update `receiving_branch_id` to the new branch, so operators/supervisors at the destination see the shipment in their filtered list.

### Role-based permissions (defined in `main.go`)

- Non-driver: GET /shipments, /branches, /branches/search, /search, /customers, /vehicles
- All roles: GET /shipments/:id, /events, /comments, /vehicles/by-shipment/:trackingId
- Operator + Supervisor + Admin: POST/PATCH shipments (create, draft, confirm, comment, correct, vehicle assign)
- Operator + Supervisor + Admin + Driver: PATCH /shipments/:id/status
- Supervisor + Manager + Admin: GET /stats, /vehicles/by-plate/:plate
- Supervisor + Admin: GET /users/drivers; vehicle status/assign-branch/start-trip/end-trip/unassign
- Admin only: POST /vehicles, POST/PATCH /branches; all /ml/config routes
- Driver only: GET /driver/route

**Operator restrictions**: cannot update a shipment in `delivering` status (reserved for supervisor/admin/driver). Can transition to `delivered` from other states (e.g. `ready_for_pickup`).

**Branch restrictions** (`branchForbidden` in handler):
- Operators + supervisors get 403 on writes for shipments whose `receiving_branch_id` ≠ their branch.
- Operators additionally get 403 on reads for out-of-branch shipments.
- Fleet: supervisors can only `/start-trip` vehicles where `assigned_branch` = their branch; only `/end-trip` where `destination_branch` = their branch.

**Driver restrictions** (`RouteService.ValidateDriverCanUpdateShipment`):
- Only shipments on their today's route; only `delivered` or `delivery_failed`.

### Route system

Routes link a driver to shipments for a date (`YYYY-MM-DD`). ID format: `ROUTE-XXXXXXXX`. When supervisor sets `→ delivering` with `driver_id`, shipment is auto-added to that driver's today route.

### Corrections (`PATCH /shipments/:tracking_id/correct` — supervisor + admin)

Non-destructive edits. Stored in `Shipment.Corrections` (typed struct, `*field` pointers); accumulate via `Merge()`. Blocked on `pending` and terminal states. Each correction auto-generates a `[Correction]` comment and an `"edited"` ShipmentEvent (status unchanged). When any ML-relevant field is corrected, priority is recomputed and persisted.

Correctable fields: all sender/recipient/address fields + `weight_kg`, `package_type`, `special_instructions`, `shipment_type`, `time_window`, `cold_chain`, `is_fragile`.

### Cancellation (`POST /shipments/:tracking_id/cancel` — supervisor + admin)

`reason` required (400 if empty). Blocked on `pending` and terminal states. Auto-adds `[Cancelación] <reason>` comment.

### Comments (`service/comment.go`)

Supervisor + admin only (write). Cannot add to `delivered` or `returned`. All authenticated users can read. `CommentHandler` holds a `ShipmentService` reference to enforce branch restrictions for operators.

### Customer autocomplete

`GET /customers?dni=XXXXX` — exact DNI match. Auto-upserted on shipment create. UI: ≥7 digits → 400ms debounce → suggestion popover → user must click "Use data" (no auto-fill).

### Fleet management

Vehicles: `license_plate` (unique), `type`, `capacity_kg`, `status`, `assigned_branch`, `destination_branch`, `assigned_shipments[]`.

Status flow: `disponible` → `en_carga` → `en_transito` → `disponible`. Also: `mantenimiento`, `inactivo` (require `force: true` if shipments assigned).

**Vehicle → Shipment lifecycle**:
1. `assign` → shipment `pre_transit`, vehicle `en_carga`
2. `DELETE shipment` → shipment `at_branch`, vehicle `disponible` if empty
3. `start-trip` → all shipments `in_transit`, vehicle `en_transito`
4. `end-trip` → all shipments `at_branch` at destination, vehicle `disponible` at destination branch

Assignment rules: vehicle must be `disponible`/`en_carga`; shipment must be `in_progress`, `at_branch`, or `ready_for_pickup`; branches must match; total weight ≤ `capacity_kg`.

### ML priority prediction

RandomForest (`github.com/malaschitz/randomForest`) in `internal/ml/`. Priority computed on Create, ConfirmDraft, and CorrectShipment (ML-relevant fields). Model stored as BYTEA in `ml_models` table. Fallback: DB blob → file (`ML_MODEL_PATH`, default `model.json`) → auto-train.

Priority fields: `priority` (alta/media/baja), `priority_score` (0–1), `priority_confidence` (0–1), `priority_factors` (JSONB).

Default factor weights (configurable 1.0–5.0 by admin):

| Factor | Weight | Normalization |
|--------|--------|--------------|
| `shipment_type` | 3.0 | express=1.0 / normal=0.0 |
| `distance_km` | 2.5 | Haversine / 2500 |
| `restrictions` | 2.0 | (is_fragile + cold_chain) / 2 |
| `time_window` | 1.5 | morning=1.0 / afternoon=0.5 / flexible=0.0 |
| `volume_score` | 1.0 | (pkg_base + weight_kg/2) / 25 |
| `route_saturation` | 0.8 | FNV hash of "origin-dest" |

Default thresholds: alta > 0.65, media > 0.35. Province coords in `internal/ml/dataset.go ProvinceCoords`.

On `POST /ml/config/regenerate`: saves config, retrains, saves blob, hot-swaps model, recalculates all non-terminal shipment priorities.

### Adding a new endpoint

1. Add struct to `internal/model/` if needed
2. Add method to repository interface + Postgres implementation
3. Add method to service
4. Add handler method, register route in `handler/`
5. Apply role middleware in `main.go`

There are no in-memory repository implementations — all persistence is PostgreSQL.

---

## Frontend (`logitrack_web/`)

### Commands

```bash
npm run dev      # dev server (port 5173)
npm run build    # tsc -b + Vite build (TypeScript validation — required before marking work done)
npm run lint
```

### Architecture

```
src/
  api/          # Axios clients per domain. shipments.ts: Bearer interceptor + 401→/login redirect.
                # publicTracking.ts: no auth, no redirect (calls /api/v1/public/* endpoints)
  context/      # AuthContext: user + token in localStorage, login/logout/hasRole
  components/   # ProtectedRoute, StatusBadge, PriorityBadge
  pages/        # one file per screen
  utils/date.ts # fmtDate / fmtDateTime — always use these (DD/MM/AAAA format)
```

Routes are defined in `App.tsx`. `/track` is declared before `AppRoutes` — bypasses auth and Nav entirely.

### Role-gated UI (`hasRole()` from `useAuth()`)

- `+ New Shipment`: hidden from managers
- Status update panel / Edit / Cancel buttons in `ShipmentDetail`: hidden via `operatorOutOfBranch` for operators **and supervisors** outside their branch
- Dashboard nav: supervisor + manager + admin
- Fleet nav: all non-driver
- ML Config nav: admin only
- Users nav: admin only
- Branches nav: supervisor + manager + admin (not operator)
- `Export CSV`: admin + manager only; client-side, reflects all active filters

### Branch-scoped UI

- `ShipmentList` branch filter: operator = locked badge; supervisor = defaults to own, can switch; manager/admin = all
- `VehicleList` branch filter: same pattern. Matches `assigned_branch` **or** `destination_branch` (client-side)
- `NewShipment` receiving branch: locked for operator + supervisor; free select for admin
- `VehicleList` Start Trip: disabled for supervisors when `assigned_branch` ≠ their branch; End Trip: when `destination_branch` ≠ their branch

### Key frontend behaviors

**Branches**: always fetched from `GET /api/v1/branches` — never hardcoded. `branchLabel(city, branches)` maps city → display name. Use `branchApi.listActive()` for dropdowns. Branch dropdowns use `<optgroup>` by province, sorted alphabetically via `localeCompare`.

**ShipmentList**: `?status=` param pre-selects filter. Default = `active` (excludes `delivered`, `pending`, `returned`, `cancelled`). Date filtering is client-side (local timezone).

**Draft workflow**: create via `POST /shipments/draft`, edit via `PATCH /:id/draft`. After save, redirect to `/?status=pending`. Confirm via `POST /:id/confirm` → generates `LT-` ID → `in_progress`.

**Shipment list ordering**: backend returns ascending by tracking ID.

**`location` field on `ShipmentEvent`** is inconsistent: seed events store branch ID (e.g. `"caba"`); runtime events store `address.city` (e.g. `"Ciudad de Buenos Aires"`). Any resolution must try both: `branches.find(b => b.address.city === loc) ?? branches.find(b => b.id === loc)`.

**Public tracking page** (`/track`): uses `publicTracking.ts` (no token). Event history translated to user-friendly language. Deep-linking via `?id=LT-XXXX`.

**CSV export**: client-side, all active filters applied. Corrected values take precedence. File: `shipments_YYYY-MM-DD.csv`. No personal data exported (Ley 25.326).

**Customer autocomplete** in `NewShipment`: ≥7 digits → 400ms debounce → lookup → suggestion popover → user must click "Use data".

**DriverRoute** (`/driver/route`): search filters by tracking ID or recipient name (including corrected values).

**VehicleList** Load Shipments modal: type trailing part of tracking ID (e.g. `A1B2C3D4` → `LT-A1B2C3D4`), calls `POST /vehicles/by-plate/:plate/assign` per shipment.

---

## Git workflow

Base: `develop`. Production: `main` (auto-deploys to Amplify).

```
feature/<description>   fix/<description>   chore/<description>
hotfix/<description>    # branch from main, merge back to main AND develop
```

Conventional Commits: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`, `ci`. PRs require one review (hotfixes excepted).

---

## Production infrastructure

| Layer | Service |
|-------|---------|
| Frontend | AWS Amplify (auto-deploy on push to `main`) |
| HTTPS proxy | AWS CloudFront (TLS termination in front of EC2) |
| Backend | EC2 port 8080 |
| Database | RDS PostgreSQL 17.4 |

---

## Specs

`docs/specs/` — functional specs by domain, Given/When/Then format. New features should have a spec first. See `docs/specs/00-indice.md`.

---

## Seed data (startup)

`seed.Load()` populates on every restart (idempotent):

- **6 branches**: caba, cordoba, mendoza (`activo`); jujuy, posadas (`inactivo`); bariloche (`fuera_de_servicio`). Name format: `XXXX-NN` (e.g. `CDBA-01`, `CORD-01`).
- **15 sample shipments** covering key states (in_progress, at_branch, delivering, delivered, multi-hop). See `seed/seed.go`.
- **3 sample vehicles**: `AB123CD` furgoneta/caba, `EF456GH` camion/cordoba, `IJ789KL` motocicleta/caba (mantenimiento).
- Customers auto-upserted from all shipments.

## API reference

Full route list is in `cmd/server/main.go`. Key public endpoints:

| Method | Path | Notes |
|--------|------|-------|
| GET | /api/v1/public/track/:id | no auth |
| GET | /api/v1/public/track/:id/events | no auth |
| GET | /api/v1/public/branches | no auth |
| POST | /api/v1/auth/login | returns token + user |
| GET | /health | health check |
