package seed

import (
	"time"

	"github.com/logitrack/core/internal/geo"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func LoadBranches(repo repository.BranchRepository) {
	type branchDef struct {
		id, name, street, city, province, postalCode string
		status                                        model.BranchStatus
	}
	defs := []branchDef{
		{"caba", "CDBA-01", "Av. Corrientes 1234", "Ciudad de Buenos Aires", "Buenos Aires", "C1043", model.BranchStatusActive},
		{"cordoba", "CORD-01", "Av. Colón 567", "Córdoba", "Córdoba", "X5000", model.BranchStatusActive},
		{"mendoza", "MEND-01", "Av. San Martín 1200", "Mendoza", "Mendoza", "M5500", model.BranchStatusActive},
		{"jujuy", "JUJY-01", "Av. Fascio 200", "San Salvador de Jujuy", "Jujuy", "Y4600", model.BranchStatusInactive},
		{"posadas", "POSA-01", "Av. Mitre 1500", "Posadas", "Misiones", "N3300", model.BranchStatusInactive},
		{"bariloche", "BARI-01", "Av. Bustillo 1200", "San Carlos de Bariloche", "Río Negro", "R8400", model.BranchStatusOutOfService},
	}
	for _, d := range defs {
		lat, lng, confidence := geo.GeocodeBranch(d.city, d.province)
		b := model.Branch{
			ID:   d.id,
			Name: d.name,
			Address: model.Address{
				Street:        d.street,
				City:          d.city,
				Province:      d.province,
				PostalCode:    d.postalCode,
				Lat:           lat,
				Lng:           lng,
				GeoConfidence: confidence,
			},
			Province:  d.province,
			Status:    d.status,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		_ = repo.Create(b)
	}
}
