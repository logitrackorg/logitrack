package db

import "database/sql"

// RunMigrations creates all tables if they do not exist.
func RunMigrations(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS events (
			id          TEXT NOT NULL,
			tracking_id TEXT NOT NULL,
			event_type  TEXT NOT NULL,
			payload     JSONB NOT NULL DEFAULT '{}',
			changed_by  TEXT NOT NULL DEFAULT '',
			timestamp   TIMESTAMPTZ NOT NULL,
			version     INTEGER NOT NULL,
			PRIMARY KEY (tracking_id, version)
		);
		CREATE INDEX IF NOT EXISTS events_id_idx ON events(id);

		CREATE TABLE IF NOT EXISTS shipments (
			tracking_id           TEXT PRIMARY KEY,
			status                TEXT NOT NULL,
			current_location      TEXT NOT NULL DEFAULT '',
			weight_kg             DECIMAL(10,3) NOT NULL DEFAULT 0,
			package_type          TEXT NOT NULL DEFAULT '',
			is_fragile            BOOLEAN NOT NULL DEFAULT FALSE,
			special_instructions  TEXT NOT NULL DEFAULT '',
			receiving_branch_id   TEXT NOT NULL DEFAULT '',
			origin_branch_id      TEXT NOT NULL DEFAULT '',
			created_at            TIMESTAMPTZ NOT NULL,
			updated_at            TIMESTAMPTZ NOT NULL,
			estimated_delivery_at TIMESTAMPTZ,
			delivered_at          TIMESTAMPTZ,
			sender                JSONB NOT NULL DEFAULT '{}',
			recipient             JSONB NOT NULL DEFAULT '{}',
			corrections           JSONB,
			shipment_type         TEXT NOT NULL DEFAULT 'normal',
			time_window           TEXT NOT NULL DEFAULT 'flexible',
			delivery_method       TEXT NOT NULL DEFAULT 'ultima_milla',
			priority              TEXT NOT NULL DEFAULT '',
			priority_score        FLOAT NOT NULL DEFAULT 0,
			priority_confidence   FLOAT NOT NULL DEFAULT 0,
			priority_factors      JSONB
		);

		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipment_type        TEXT NOT NULL DEFAULT 'normal';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS time_window          TEXT NOT NULL DEFAULT 'flexible';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS priority             TEXT NOT NULL DEFAULT '';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS priority_score       FLOAT NOT NULL DEFAULT 0;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS priority_confidence  FLOAT NOT NULL DEFAULT 0;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS priority_factors     JSONB;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_branch_id     TEXT NOT NULL DEFAULT '';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS has_incident         BOOLEAN NOT NULL DEFAULT FALSE;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS incident_type        TEXT NOT NULL DEFAULT '';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS parent_shipment_id   TEXT;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivery_attempts    INT NOT NULL DEFAULT 0;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS is_returning         BOOLEAN NOT NULL DEFAULT FALSE;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS final_branch_id      TEXT NOT NULL DEFAULT '';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivery_method      TEXT NOT NULL DEFAULT 'ultima_milla';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS price                NUMERIC(12,2);
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS price_breakdown      JSONB;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS price_currency       TEXT NOT NULL DEFAULT 'ARS';

		UPDATE shipments SET status = 'draft'          WHERE status = 'pending';
		UPDATE shipments SET status = 'at_origin_hub'  WHERE status = 'in_progress';
		UPDATE shipments SET status = 'loaded'         WHERE status = 'pre_transit';
		UPDATE shipments SET status = 'at_hub'         WHERE status = 'at_branch';
		UPDATE shipments SET status = 'out_for_delivery' WHERE status = 'delivering';

		CREATE TABLE IF NOT EXISTS system_config (
			id                   INTEGER PRIMARY KEY DEFAULT 1,
			max_delivery_attempts INTEGER NOT NULL DEFAULT 3
		);
		INSERT INTO system_config (id, max_delivery_attempts)
		VALUES (1, 3)
		ON CONFLICT (id) DO NOTHING;

		CREATE TABLE IF NOT EXISTS pricing_config (
			id                                 INTEGER PRIMARY KEY DEFAULT 1,
			base_fare                          NUMERIC(12,2) NOT NULL DEFAULT 10000,
			cost_per_km                        NUMERIC(12,2) NOT NULL DEFAULT 25,
			weight_surcharge_mid               NUMERIC(12,2) NOT NULL DEFAULT 5000,
			weight_surcharge_high              NUMERIC(12,2) NOT NULL DEFAULT 25000,
			last_mile_surcharge                NUMERIC(12,2) NOT NULL DEFAULT 5000,
			shipment_express_multiplier        NUMERIC(6,3)  NOT NULL DEFAULT 1.2,
			time_window_restrictive_multiplier NUMERIC(6,3)  NOT NULL DEFAULT 1.05,
			fragile_multiplier                 NUMERIC(6,3)  NOT NULL DEFAULT 1.20
		);
		INSERT INTO pricing_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
		ALTER TABLE pricing_config DROP COLUMN IF EXISTS package_envelope_multiplier;
		ALTER TABLE pricing_config DROP COLUMN IF EXISTS package_box_multiplier;
		ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS last_mile_surcharge NUMERIC(12,2) NOT NULL DEFAULT 800;

		DO $$
		BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns
			           WHERE table_name='pricing_config' AND column_name='time_window_restrictive_surcharge') THEN
				ALTER TABLE pricing_config RENAME COLUMN time_window_restrictive_surcharge TO time_window_restrictive_multiplier;
				UPDATE pricing_config SET time_window_restrictive_multiplier = time_window_restrictive_multiplier + 1
				WHERE time_window_restrictive_multiplier < 1;
			END IF;
			IF EXISTS (SELECT 1 FROM information_schema.columns
			           WHERE table_name='pricing_config' AND column_name='fragile_surcharge') THEN
				ALTER TABLE pricing_config RENAME COLUMN fragile_surcharge TO fragile_multiplier;
				UPDATE pricing_config SET fragile_multiplier = fragile_multiplier + 1
				WHERE fragile_multiplier < 1;
			END IF;
		END $$;

		CREATE TABLE IF NOT EXISTS routing_config (
			id                       INTEGER PRIMARY KEY DEFAULT 1,
			sla_force_horizon_hours  INTEGER       NOT NULL DEFAULT 24,
			priority_force_threshold NUMERIC(4,3)  NOT NULL DEFAULT 0.750,
			min_fill_rate            NUMERIC(4,3)  NOT NULL DEFAULT 0.400
		);
		INSERT INTO routing_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
		ALTER TABLE routing_config DROP COLUMN IF EXISTS respect_fragile_spread;
		ALTER TABLE routing_config DROP COLUMN IF EXISTS express_max_hours_in_branch;
		ALTER TABLE routing_config DROP COLUMN IF EXISTS max_shipments_per_driver;
		ALTER TABLE routing_config DROP COLUMN IF EXISTS max_weight_kg_per_driver;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS enforce_time_windows         BOOLEAN       NOT NULL DEFAULT TRUE;
		UPDATE routing_config SET enforce_time_windows = TRUE WHERE id = 1 AND enforce_time_windows = FALSE;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS morning_window_start_hour    INTEGER       NOT NULL DEFAULT 8;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS morning_window_end_hour      INTEGER       NOT NULL DEFAULT 14;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS afternoon_window_start_hour  INTEGER       NOT NULL DEFAULT 12;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS afternoon_window_end_hour    INTEGER       NOT NULL DEFAULT 18;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS service_time_minutes         INTEGER       NOT NULL DEFAULT 10;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS avg_speed_kmh                NUMERIC(6,2)  NOT NULL DEFAULT 25.0;
		ALTER TABLE routing_config ADD COLUMN IF NOT EXISTS last_mile_packing_strategy   TEXT          NOT NULL DEFAULT 'maximize_capacity';

		CREATE TABLE IF NOT EXISTS routing_plans (
			id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
			plan_date     DATE         NOT NULL UNIQUE,
			status        TEXT         NOT NULL DEFAULT 'pending',
			payload       JSONB        NOT NULL DEFAULT '{}',
			generated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
			applied_at    TIMESTAMPTZ,
			applied_by    TEXT,
			generation_log JSONB       NOT NULL DEFAULT '{}'
		);

		CREATE TABLE IF NOT EXISTS shipment_incidents (
			id            VARCHAR(50)  PRIMARY KEY,
			tracking_id   VARCHAR(50)  NOT NULL,
			incident_type TEXT         NOT NULL,
			description   TEXT         NOT NULL,
			reported_by   VARCHAR(100) NOT NULL,
			created_at    TIMESTAMPTZ  NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_incidents_tracking_id ON shipment_incidents(tracking_id);

		CREATE TABLE IF NOT EXISTS comments (
			id          TEXT NOT NULL,
			tracking_id TEXT NOT NULL,
			author      TEXT NOT NULL,
			body        TEXT NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL,
			PRIMARY KEY (tracking_id, id)
		);

		CREATE TABLE IF NOT EXISTS routes (
			id           TEXT PRIMARY KEY,
			date         TEXT NOT NULL,
			driver_id    TEXT NOT NULL,
			shipment_ids JSONB NOT NULL DEFAULT '[]',
			created_by   TEXT NOT NULL,
			created_at   TIMESTAMPTZ NOT NULL,
			status       TEXT NOT NULL DEFAULT 'pendiente',
			started_at   TIMESTAMPTZ
		);
		ALTER TABLE routes ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'pendiente';
		ALTER TABLE routes ADD COLUMN IF NOT EXISTS started_at           TIMESTAMPTZ;
		ALTER TABLE routes ADD COLUMN IF NOT EXISTS suggested_start_time TIMESTAMPTZ;
		CREATE INDEX IF NOT EXISTS routes_driver_date_idx ON routes(driver_id, date);

		CREATE TABLE IF NOT EXISTS customers (
			dni     TEXT PRIMARY KEY,
			name    TEXT NOT NULL DEFAULT '',
			phone   TEXT NOT NULL DEFAULT '',
			email   TEXT NOT NULL DEFAULT '',
			address JSONB NOT NULL DEFAULT '{}'
		);

		CREATE TABLE IF NOT EXISTS tokens (
			token      TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL,
			username   TEXT NOT NULL,
			role       TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS ml_configs (
			id              SERIAL PRIMARY KEY,
			factors         JSONB NOT NULL,
			alta_threshold  FLOAT NOT NULL DEFAULT 0.65,
			media_threshold FLOAT NOT NULL DEFAULT 0.35,
			is_active       BOOLEAN NOT NULL DEFAULT FALSE,
			created_by      TEXT NOT NULL,
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			notes           TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS ml_models (
			id          SERIAL PRIMARY KEY,
			config_id   INTEGER NOT NULL REFERENCES ml_configs(id),
			model_data  BYTEA NOT NULL,
			size_bytes  INTEGER NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS organization_config (
			id         INTEGER PRIMARY KEY DEFAULT 1,
			name       TEXT NOT NULL DEFAULT '',
			cuit       TEXT NOT NULL DEFAULT '',
			address    TEXT NOT NULL DEFAULT '',
			phone      TEXT NOT NULL DEFAULT '',
			email      TEXT NOT NULL DEFAULT '',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_by TEXT NOT NULL DEFAULT ''
		);
		INSERT INTO organization_config (id, name, cuit, address, phone, email, updated_by)
		VALUES (1, 'Transportes del Sur S.A.', '30-71234567-8', 'Av. San Martín 1450, Buenos Aires', '+54 11 4567-8900', 'operaciones@transportesdelsur.com.ar', 'system')
		ON CONFLICT (id) DO NOTHING;

		CREATE TABLE IF NOT EXISTS access_logs (
			id         TEXT PRIMARY KEY,
			username   TEXT NOT NULL,
			user_id    TEXT NOT NULL DEFAULT '',
			event_type TEXT NOT NULL,
			timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS access_logs_timestamp_idx ON access_logs(timestamp DESC);

		CREATE TABLE IF NOT EXISTS users (
			id         VARCHAR(10)  PRIMARY KEY,
			username   VARCHAR(100) UNIQUE NOT NULL,
			password   VARCHAR(255) NOT NULL,
			role       VARCHAR(50)  NOT NULL,
			branch_id  VARCHAR(50)
		);
		ALTER TABLE users ADD COLUMN IF NOT EXISTS status     VARCHAR(20)  NOT NULL DEFAULT 'activo';
		ALTER TABLE users ADD COLUMN IF NOT EXISTS email      VARCHAR(255);
		ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100) NOT NULL DEFAULT '';
		ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name  VARCHAR(100) NOT NULL DEFAULT '';
		ALTER TABLE users ADD COLUMN IF NOT EXISTS address    JSONB;
		ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT '';
		ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
		CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email) WHERE email IS NOT NULL AND email <> '';

		CREATE TABLE IF NOT EXISTS zones (
			id          UUID PRIMARY KEY,
			name        TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			polygon     JSONB NOT NULL,
			active      BOOLEAN NOT NULL DEFAULT TRUE,
			created_by  TEXT NOT NULL DEFAULT '',
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		ALTER TABLE zones DROP COLUMN IF EXISTS severity;

		ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS risky_zone_surcharge REAL NOT NULL DEFAULT 5000;

		-- Draft lifecycle: new system_config columns
		ALTER TABLE system_config ADD COLUMN IF NOT EXISTS draft_retention_days INTEGER NOT NULL DEFAULT 7;
		ALTER TABLE system_config ADD COLUMN IF NOT EXISTS draft_purge_days     INTEGER NOT NULL DEFAULT 30;
		UPDATE system_config SET draft_retention_days = 7, draft_purge_days = 30 WHERE id = 1 AND draft_retention_days = 0;

		-- Draft lifecycle: track PII purge timestamp on the projection
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS pii_purged_at TIMESTAMPTZ;

		-- Draft lifecycle: audit trail (CA-03)
		CREATE TABLE IF NOT EXISTS draft_audit_log (
			id           TEXT PRIMARY KEY,
			tracking_id  TEXT NOT NULL,
			action       TEXT NOT NULL,
			performed_by TEXT NOT NULL DEFAULT 'system',
			timestamp    TIMESTAMPTZ NOT NULL,
			details      JSONB NOT NULL DEFAULT '{}'
		);
		CREATE INDEX IF NOT EXISTS draft_audit_tracking_idx  ON draft_audit_log(tracking_id);
		CREATE INDEX IF NOT EXISTS draft_audit_timestamp_idx ON draft_audit_log(timestamp DESC);

		ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_type VARCHAR(50);
		ALTER TABLE users ALTER COLUMN driver_type DROP NOT NULL;

		CREATE TABLE IF NOT EXISTS inter_branch_trips (
			id                    TEXT PRIMARY KEY,
			driver_id             TEXT,
			vehicle_id            TEXT NOT NULL,
			license_plate         TEXT NOT NULL,
			origin_branch_id      TEXT NOT NULL,
			destination_branch_id TEXT NOT NULL,
			shipment_ids          JSONB NOT NULL DEFAULT '[]',
			status                TEXT NOT NULL DEFAULT 'pendiente',
			total_weight_kg       NUMERIC(10,3) NOT NULL DEFAULT 0,
			created_by            TEXT NOT NULL DEFAULT '',
			created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			started_at            TIMESTAMPTZ,
			completed_at          TIMESTAMPTZ,
			finished_by_user_id   TEXT
		);
		CREATE INDEX IF NOT EXISTS inter_branch_trips_driver_idx ON inter_branch_trips(driver_id) WHERE driver_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS inter_branch_trips_dest_idx   ON inter_branch_trips(destination_branch_id);
		CREATE INDEX IF NOT EXISTS inter_branch_trips_status_idx ON inter_branch_trips(status);

		-- Required by vehicle QR token generation
		CREATE EXTENSION IF NOT EXISTS pgcrypto;
		-- QR-based vehicle claim flow (vehicle columns are migrated in postgres_vehicle.go)
		ALTER TABLE inter_branch_trips ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'inter_branch';
		ALTER TABLE inter_branch_trips ALTER COLUMN destination_branch_id DROP NOT NULL;
		CREATE UNIQUE INDEX IF NOT EXISTS trips_one_active_per_vehicle
			ON inter_branch_trips(vehicle_id) WHERE status IN ('pendiente','en_transito');
		ALTER TABLE inter_branch_trips ADD COLUMN IF NOT EXISTS stops JSONB NOT NULL DEFAULT '[]'::jsonb;
		ALTER TABLE inter_branch_trips ADD COLUMN IF NOT EXISTS current_stop_index INTEGER NOT NULL DEFAULT 0;

		-- Cross-branch pickup: reserva del envío para un trip multi-hop
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS reserved_for_trip_id TEXT;
		CREATE INDEX IF NOT EXISTS shipments_reserved_for_trip_idx ON shipments(reserved_for_trip_id) WHERE reserved_for_trip_id IS NOT NULL;

		-- Mercado Pago: pagos asociados a envíos en pending_payment
		CREATE TABLE IF NOT EXISTS payments (
			id               TEXT PRIMARY KEY,
			tracking_id      TEXT NOT NULL,
			mp_preference_id TEXT NOT NULL UNIQUE,
			mp_payment_id    TEXT UNIQUE,
			init_point       TEXT NOT NULL,
			amount           NUMERIC(12,2) NOT NULL,
			currency         TEXT NOT NULL DEFAULT 'ARS',
			status           TEXT NOT NULL,
			created_at       TIMESTAMPTZ NOT NULL,
			approved_at      TIMESTAMPTZ,
			abandoned_at     TIMESTAMPTZ,
			abandoned_reason TEXT NOT NULL DEFAULT ''
		);
		CREATE INDEX IF NOT EXISTS idx_payments_tracking_id ON payments(tracking_id);
		CREATE INDEX IF NOT EXISTS idx_payments_status_created_at ON payments(status, created_at);
		ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_tracking_id TEXT;
		UPDATE payments SET original_tracking_id = tracking_id WHERE original_tracking_id IS NULL;

		-- Idempotencia de webhooks: evita procesar el mismo payment_id dos veces
		CREATE TABLE IF NOT EXISTS payment_events (
			mp_payment_id TEXT PRIMARY KEY,
			received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
			raw_payload   JSONB NOT NULL
		);

		-- Notification center (US: Centro de notificaciones in-app + Envío recibido en sucursal)
		CREATE TABLE IF NOT EXISTS notifications (
			id          TEXT PRIMARY KEY,
			user_id     TEXT NOT NULL,
			type        TEXT NOT NULL,
			title       TEXT NOT NULL,
			body        TEXT NOT NULL,
			resource_id TEXT NOT NULL DEFAULT '',
			read_at     TIMESTAMPTZ,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
		CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

		-- SLA en riesgo (LOGITRACK-404): columnas para deduplicación de notificaciones por ciclo
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sla_notified_at         TIMESTAMPTZ;
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sla_expired_notified_at TIMESTAMPTZ;

		-- Email transaccional: deduplicación de emails de confirmación de envío (CA-05)
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ;
	`)
	return err
}
