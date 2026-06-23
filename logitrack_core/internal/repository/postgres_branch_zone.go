package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/logitrack/core/internal/model"
)

type postgresBranchZoneRepository struct {
	db *sql.DB
}

func NewPostgresBranchZoneRepository(db *sql.DB) BranchZoneRepository {
	return &postgresBranchZoneRepository{db: db}
}

func (r *postgresBranchZoneRepository) ListByBranch(branchID string, includeInactive bool) ([]model.BranchZone, error) {
	query := `SELECT id, branch_id, zone_type, name, active, created_at, updated_at
	          FROM branch_zones WHERE branch_id = $1`
	if !includeInactive {
		query += ` AND active = TRUE`
	}
	query += ` ORDER BY zone_type ASC`

	rows, err := r.db.Query(query, branchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var zones []model.BranchZone
	for rows.Next() {
		z, err := scanBranchZone(rows)
		if err != nil {
			return nil, err
		}
		zones = append(zones, z)
	}
	return zones, rows.Err()
}

func (r *postgresBranchZoneRepository) GetByBranchAndType(branchID string, zoneType model.BranchZoneType) (model.BranchZone, error) {
	row := r.db.QueryRow(`SELECT id, branch_id, zone_type, name, active, created_at, updated_at
	                      FROM branch_zones WHERE branch_id = $1 AND zone_type = $2`, branchID, string(zoneType))
	z, err := scanBranchZoneRow(row)
	if err == sql.ErrNoRows {
		return model.BranchZone{}, fmt.Errorf("zona %q no encontrada en sucursal %s", zoneType, branchID)
	}
	return z, err
}

func (r *postgresBranchZoneRepository) Create(zone model.BranchZone) error {
	_, err := r.db.Exec(`INSERT INTO branch_zones (id, branch_id, zone_type, name, active, created_at, updated_at)
	                    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		zone.ID, zone.BranchID, string(zone.ZoneType), zone.Name,
		zone.Active, zone.CreatedAt, zone.UpdatedAt)
	return err
}

func (r *postgresBranchZoneRepository) renameZone(id, name string, updatedAt time.Time) error {
	_, err := r.db.Exec(`UPDATE branch_zones SET name = $1, updated_at = $2 WHERE id = $3`,
		name, updatedAt, id)
	return err
}

func (r *postgresBranchZoneRepository) SetActiveForBranch(branchID string, active bool) error {
	_, err := r.db.Exec(`UPDATE branch_zones SET active = $1, updated_at = $2 WHERE branch_id = $3`,
		active, time.Now(), branchID)
	return err
}

func (r *postgresBranchZoneRepository) EnsureZonesForBranch(branchID string) error {
	existing, err := r.ListByBranch(branchID, true)
	if err != nil {
		return err
	}
	existingByType := map[model.BranchZoneType]model.BranchZone{}
	for _, z := range existing {
		existingByType[z.ZoneType] = z
	}

	allTypes := []model.BranchZoneType{
		model.ZoneEntrada,
		model.ZoneSalida,
		model.ZoneRevision,
		model.ZoneDevolucion,
	}
	now := time.Now()
	for _, zt := range allTypes {
		if z, ok := existingByType[zt]; ok {
			// Zona ya existe: realinear el nombre mostrado al canónico si cambió.
			if canonical := model.BranchZoneNames[zt]; z.Name != canonical {
				if err := r.renameZone(z.ID, canonical, now); err != nil {
					return fmt.Errorf("renombrando zona %q de sucursal %s: %w", zt, branchID, err)
				}
			}
			continue
		}
		zone := model.BranchZone{
			ID:        uuid.New().String(),
			BranchID:  branchID,
			ZoneType:  zt,
			Name:      model.BranchZoneNames[zt],
			Active:    true,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := r.Create(zone); err != nil {
			return fmt.Errorf("creando zona %q para sucursal %s: %w", zt, branchID, err)
		}
	}
	return nil
}

func scanBranchZone(s interface {
	Scan(dest ...interface{}) error
},
) (model.BranchZone, error) {
	var z model.BranchZone
	var zoneType string
	var createdAt, updatedAt time.Time
	err := s.Scan(&z.ID, &z.BranchID, &zoneType, &z.Name, &z.Active, &createdAt, &updatedAt)
	if err != nil {
		return model.BranchZone{}, err
	}
	z.ZoneType = model.BranchZoneType(zoneType)
	z.CreatedAt = createdAt
	z.UpdatedAt = updatedAt
	return z, nil
}

func scanBranchZoneRow(row *sql.Row) (model.BranchZone, error) {
	var z model.BranchZone
	var zoneType string
	var createdAt, updatedAt time.Time
	err := row.Scan(&z.ID, &z.BranchID, &zoneType, &z.Name, &z.Active, &createdAt, &updatedAt)
	if err != nil {
		return model.BranchZone{}, err
	}
	z.ZoneType = model.BranchZoneType(zoneType)
	z.CreatedAt = createdAt
	z.UpdatedAt = updatedAt
	return z, nil
}
