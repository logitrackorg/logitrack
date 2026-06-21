package repository

import (
	"database/sql"
	"time"
)

// PhotoRecord holds the minimal data needed to purge a delivery photo.
type PhotoRecord struct {
	TrackingID string
	PhotoPath  string
}

type PhotoLifecycleRepository interface {
	// ExpirePhotos marks as expired all delivered shipments with a delivery photo
	// whose delivered_at is before cutoff and photo_expired_at is still NULL.
	// Returns the tracking IDs of expired shipments.
	ExpirePhotos(cutoff time.Time) ([]string, error)

	// FindPhotosToPurge returns records whose photo_expired_at is before cutoff
	// and photo_purged_at is still NULL.
	FindPhotosToPurge(cutoff time.Time) ([]PhotoRecord, error)

	// MarkPhotoPurged sets photo_purged_at = NOW() and clears the photo path
	// from the event payload for the given tracking ID.
	MarkPhotoPurged(trackingID string) error
}

type postgresPhotoLifecycleRepository struct {
	db *sql.DB
}

func NewPostgresPhotoLifecycleRepository(db *sql.DB) PhotoLifecycleRepository {
	return &postgresPhotoLifecycleRepository{db: db}
}

func (r *postgresPhotoLifecycleRepository) ExpirePhotos(cutoff time.Time) ([]string, error) {
	rows, err := r.db.Query(`
		UPDATE shipments
		SET    photo_expired_at = NOW(), updated_at = NOW()
		WHERE  status           = 'delivered'
		  AND  delivered_at     < $1
		  AND  photo_expired_at IS NULL
		  AND  EXISTS (
		           SELECT 1 FROM events
		           WHERE  events.tracking_id = shipments.tracking_id
		             AND  events.event_type  = 'status_changed'
		             AND  events.payload->>'to_status' = 'delivered'
		             AND  events.payload->>'delivery_photo_path' != ''
		             AND  events.payload->>'delivery_photo_path' IS NOT NULL
		       )
		RETURNING tracking_id`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *postgresPhotoLifecycleRepository) FindPhotosToPurge(cutoff time.Time) ([]PhotoRecord, error) {
	rows, err := r.db.Query(`
		SELECT s.tracking_id,
		       e.payload->>'delivery_photo_path' AS photo_path
		FROM   shipments s
		JOIN   events    e ON e.tracking_id = s.tracking_id
		                   AND e.event_type  = 'status_changed'
		                   AND e.payload->>'to_status' = 'delivered'
		                   AND e.payload->>'delivery_photo_path' != ''
		                   AND e.payload->>'delivery_photo_path' IS NOT NULL
		WHERE  s.photo_expired_at < $1
		  AND  s.photo_purged_at  IS NULL`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []PhotoRecord
	for rows.Next() {
		var rec PhotoRecord
		if err := rows.Scan(&rec.TrackingID, &rec.PhotoPath); err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, rows.Err()
}

func (r *postgresPhotoLifecycleRepository) MarkPhotoPurged(trackingID string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	_, err = tx.Exec(`
		UPDATE shipments
		SET    photo_purged_at = NOW(), updated_at = NOW()
		WHERE  tracking_id = $1`, trackingID)
	if err != nil {
		return err
	}

	// Clear the photo path from the event payload so it cannot be reconstructed.
	_, err = tx.Exec(`
		UPDATE events
		SET    payload = payload - 'delivery_photo_path' - 'delivery_photo_name' - 'delivery_photo_mime'
		WHERE  tracking_id = $1
		  AND  event_type  = 'status_changed'
		  AND  payload->>'to_status' = 'delivered'`, trackingID)
	if err != nil {
		return err
	}

	return tx.Commit()
}
