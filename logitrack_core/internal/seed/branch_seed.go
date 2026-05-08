package seed

import (
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func LoadBranches(repo repository.BranchRepository) {
	branches := []model.Branch{
		// Active hubs
		{ID: "caba", Name: "CDBA-01", Address: model.Address{Street: "Av. Corrientes 1234", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043"}, Province: "Buenos Aires", Status: model.BranchStatusActive, MaxCapacity: 8, Latitude: fPtr(-34.6037), Longitude: fPtr(-58.3816)},
		{ID: "cordoba", Name: "CORD-01", Address: model.Address{Street: "Av. Colón 567", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"}, Province: "Córdoba", Status: model.BranchStatusActive, MaxCapacity: 20, Latitude: fPtr(-31.4201), Longitude: fPtr(-64.1888)},
		{ID: "mendoza", Name: "MEND-01", Address: model.Address{Street: "Av. San Martín 1200", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500"}, Province: "Mendoza", Status: model.BranchStatusActive, MaxCapacity: 5, Latitude: fPtr(-32.8908), Longitude: fPtr(-68.8272)},
		// Inactive branches
		{ID: "jujuy", Name: "JUJY-01", Address: model.Address{Street: "Av. Fascio 200", City: "San Salvador de Jujuy", Province: "Jujuy", PostalCode: "Y4600"}, Province: "Jujuy", Status: model.BranchStatusInactive, MaxCapacity: 15, Latitude: fPtr(-24.1858), Longitude: fPtr(-65.2995)},
		{ID: "posadas", Name: "POSA-01", Address: model.Address{Street: "Av. Mitre 1500", City: "Posadas", Province: "Misiones", PostalCode: "N3300"}, Province: "Misiones", Status: model.BranchStatusInactive, MaxCapacity: 15, Latitude: fPtr(-27.3671), Longitude: fPtr(-55.8965)},
		// Out of service
		{ID: "bariloche", Name: "BARI-01", Address: model.Address{Street: "Av. Bustillo 1200", City: "San Carlos de Bariloche", Province: "Río Negro", PostalCode: "R8400"}, Province: "Río Negro", Status: model.BranchStatusOutOfService, MaxCapacity: 20, Latitude: fPtr(-41.1335), Longitude: fPtr(-71.3103)},
	}
	for _, b := range branches {
		b.CreatedAt = time.Now()
		b.UpdatedAt = time.Now()
		_ = repo.Create(b) // ignore duplicate errors on re-seed
	}
}
