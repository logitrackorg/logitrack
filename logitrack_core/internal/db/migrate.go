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
			cold_chain            BOOLEAN NOT NULL DEFAULT FALSE,
			priority              TEXT NOT NULL DEFAULT '',
			priority_score        FLOAT NOT NULL DEFAULT 0,
			priority_confidence   FLOAT NOT NULL DEFAULT 0,
			priority_factors      JSONB
		);

		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipment_type        TEXT NOT NULL DEFAULT 'normal';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS time_window          TEXT NOT NULL DEFAULT 'flexible';
		ALTER TABLE shipments ADD COLUMN IF NOT EXISTS cold_chain           BOOLEAN NOT NULL DEFAULT FALSE;
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
			created_at   TIMESTAMPTZ NOT NULL
		);
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
	`)
	return err
}
