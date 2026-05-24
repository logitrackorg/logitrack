package repository

import (
	"database/sql"
	"time"
)

// TripType identifica el tipo de viaje para el estado de deduplicación (CA-06).
const (
	TripTypeLastMile    = "ultima_milla"
	TripTypeInterBranch = "inter_sucursal"
)

// DispatchVolumeState representa el estado de deduplicación para un par origen→destino.
type DispatchVolumeState struct {
	OriginBranchID string
	DestKey        string     // branch_id para inter-sucursal, "ultima_milla" para última milla
	TripType       string     // TripTypeLastMile | TripTypeInterBranch
	NotifiedAt     *time.Time // nil = no notificado, non-nil = notificado
}

// DispatchVolumeRepository persiste el estado de deduplicación de volumen mínimo de
// despacho por par (origen, destino, tipo) — CA-04, CA-05, CA-06 de LOGITRACK-409.
type DispatchVolumeRepository interface {
	// IsNotified devuelve true si el par ya fue notificado.
	IsNotified(originBranchID, destKey, tripType string) (bool, error)
	// SetNotified marca el par como notificado con el timestamp dado.
	SetNotified(originBranchID, destKey, tripType string, t time.Time) error
	// ResetNotified borra el estado notificado del par (nil notified_at).
	ResetNotified(originBranchID, destKey, tripType string) error
	// GetAllNotified devuelve todos los pares notificados de una sucursal origen.
	GetAllNotified(originBranchID string) ([]DispatchVolumeState, error)
}

type postgresDispatchVolumeRepository struct {
	db *sql.DB
}

// NewPostgresDispatchVolumeRepository crea un nuevo repositorio Postgres para dispatch_volume_state.
func NewPostgresDispatchVolumeRepository(db *sql.DB) DispatchVolumeRepository {
	return &postgresDispatchVolumeRepository{db: db}
}

func (r *postgresDispatchVolumeRepository) IsNotified(originBranchID, destKey, tripType string) (bool, error) {
	var notifiedAt sql.NullTime
	err := r.db.QueryRow(`
		SELECT notified_at FROM dispatch_volume_state
		WHERE origin_branch_id = $1 AND dest_key = $2 AND trip_type = $3`,
		originBranchID, destKey, tripType,
	).Scan(&notifiedAt)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return notifiedAt.Valid, nil
}

func (r *postgresDispatchVolumeRepository) SetNotified(originBranchID, destKey, tripType string, t time.Time) error {
	_, err := r.db.Exec(`
		INSERT INTO dispatch_volume_state (origin_branch_id, dest_key, trip_type, notified_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (origin_branch_id, dest_key, trip_type)
		DO UPDATE SET notified_at = EXCLUDED.notified_at`,
		originBranchID, destKey, tripType, t,
	)
	return err
}

func (r *postgresDispatchVolumeRepository) ResetNotified(originBranchID, destKey, tripType string) error {
	_, err := r.db.Exec(`
		UPDATE dispatch_volume_state SET notified_at = NULL
		WHERE origin_branch_id = $1 AND dest_key = $2 AND trip_type = $3`,
		originBranchID, destKey, tripType,
	)
	return err
}

func (r *postgresDispatchVolumeRepository) GetAllNotified(originBranchID string) ([]DispatchVolumeState, error) {
	rows, err := r.db.Query(`
		SELECT origin_branch_id, dest_key, trip_type, notified_at
		FROM dispatch_volume_state
		WHERE origin_branch_id = $1 AND notified_at IS NOT NULL`,
		originBranchID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var states []DispatchVolumeState
	for rows.Next() {
		var s DispatchVolumeState
		var notifiedAt sql.NullTime
		if err := rows.Scan(&s.OriginBranchID, &s.DestKey, &s.TripType, &notifiedAt); err != nil {
			continue
		}
		if notifiedAt.Valid {
			s.NotifiedAt = &notifiedAt.Time
		}
		states = append(states, s)
	}
	return states, rows.Err()
}
