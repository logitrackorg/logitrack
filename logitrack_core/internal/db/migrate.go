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
			tracking_id          TEXT PRIMARY KEY,
			status               TEXT NOT NULL,
			current_location     TEXT NOT NULL DEFAULT '',
			weight_kg            DECIMAL(10,3) NOT NULL DEFAULT 0,
			package_type         TEXT NOT NULL DEFAULT '',
			is_fragile           BOOLEAN NOT NULL DEFAULT FALSE,
			special_instructions TEXT NOT NULL DEFAULT '',
			receiving_branch_id  TEXT NOT NULL DEFAULT '',
			created_at           TIMESTAMPTZ NOT NULL,
			updated_at           TIMESTAMPTZ NOT NULL,
			estimated_delivery_at TIMESTAMPTZ,
			delivered_at         TIMESTAMPTZ,
			sender               JSONB NOT NULL DEFAULT '{}',
			recipient            JSONB NOT NULL DEFAULT '{}',
			corrections          JSONB
		);

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
	`)
	return err
}
