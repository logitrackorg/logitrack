package seed

import (
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
)

func LoadBranches(repo repository.BranchRepository) {
	branches := []model.Branch{
		// Buenos Aires
		{ID: "caba", Name: "CDBA-01", Address: model.Address{Street: "Av. Corrientes 1234", City: "Ciudad de Buenos Aires", Province: "Buenos Aires", PostalCode: "C1043"}, Province: "Buenos Aires", Status: model.BranchStatusActive},
		{ID: "san-pedro", Name: "SNPO-01", Address: model.Address{Street: "Mendoza 450", City: "San Pedro", Province: "Buenos Aires", PostalCode: "B2930"}, Province: "Buenos Aires", Status: model.BranchStatusActive},
		{ID: "la-plata", Name: "LPLA-01", Address: model.Address{Street: "Calle 7 Nro. 890", City: "La Plata", Province: "Buenos Aires", PostalCode: "B1900"}, Province: "Buenos Aires", Status: model.BranchStatusActive},
		{ID: "mar-del-plata", Name: "MDPL-01", Address: model.Address{Street: "Av. Independencia 2500", City: "Mar del Plata", Province: "Buenos Aires", PostalCode: "B7600"}, Province: "Buenos Aires", Status: model.BranchStatusActive},
		{ID: "bahia-blanca", Name: "BBLA-01", Address: model.Address{Street: "Hipólito Yrigoyen 120", City: "Bahía Blanca", Province: "Buenos Aires", PostalCode: "B8000"}, Province: "Buenos Aires", Status: model.BranchStatusActive},
		// Córdoba
		{ID: "cordoba", Name: "CORD-01", Address: model.Address{Street: "Av. Colón 567", City: "Córdoba", Province: "Córdoba", PostalCode: "X5000"}, Province: "Córdoba", Status: model.BranchStatusActive},
		{ID: "villa-maria", Name: "VMAR-01", Address: model.Address{Street: "Av. Sabattini 890", City: "Villa María", Province: "Córdoba", PostalCode: "X5900"}, Province: "Córdoba", Status: model.BranchStatusActive},
		{ID: "rio-cuarto", Name: "RCUA-01", Address: model.Address{Street: "Ruta 36 Km 600", City: "Río Cuarto", Province: "Córdoba", PostalCode: "X5800"}, Province: "Córdoba", Status: model.BranchStatusActive},
		// Santa Fe
		{ID: "rosario", Name: "ROSA-01", Address: model.Address{Street: "Bv. Oroño 1200", City: "Rosario", Province: "Santa Fe", PostalCode: "S2000"}, Province: "Santa Fe", Status: model.BranchStatusActive},
		{ID: "santa-fe", Name: "SFFE-01", Address: model.Address{Street: "Bv. Pellegrini 3000", City: "Santa Fe", Province: "Santa Fe", PostalCode: "S3000"}, Province: "Santa Fe", Status: model.BranchStatusActive},
		{ID: "rafaela", Name: "RAFA-01", Address: model.Address{Street: "Blvd. Racedo 450", City: "Rafaela", Province: "Santa Fe", PostalCode: "S2300"}, Province: "Santa Fe", Status: model.BranchStatusActive},
		// Mendoza
		{ID: "mendoza", Name: "MEND-01", Address: model.Address{Street: "Av. San Martín 1200", City: "Mendoza", Province: "Mendoza", PostalCode: "M5500"}, Province: "Mendoza", Status: model.BranchStatusActive},
		{ID: "san-rafael", Name: "SRAF-01", Address: model.Address{Street: "Av. Hipólito Yrigoyen 800", City: "San Rafael", Province: "Mendoza", PostalCode: "M5600"}, Province: "Mendoza", Status: model.BranchStatusActive},
		// Tucumán
		{ID: "tucuman", Name: "TUCU-01", Address: model.Address{Street: "Av. Sarmiento 500", City: "San Miguel de Tucumán", Province: "Tucumán", PostalCode: "T4000"}, Province: "Tucumán", Status: model.BranchStatusActive},
		// Salta
		{ID: "salta", Name: "SALT-01", Address: model.Address{Street: "Av. Belgrano 900", City: "Salta", Province: "Salta", PostalCode: "A4400"}, Province: "Salta", Status: model.BranchStatusActive},
		// Jujuy
		{ID: "jujuy", Name: "JUJY-01", Address: model.Address{Street: "Av. Fascio 200", City: "San Salvador de Jujuy", Province: "Jujuy", PostalCode: "Y4600"}, Province: "Jujuy", Status: model.BranchStatusActive},
		// Misiones
		{ID: "posadas", Name: "POSA-01", Address: model.Address{Street: "Av. Mitre 1500", City: "Posadas", Province: "Misiones", PostalCode: "N3300"}, Province: "Misiones", Status: model.BranchStatusActive},
		{ID: "puerto-iguazu", Name: "PIGA-01", Address: model.Address{Street: "Av. Victoria Aguirre 300", City: "Puerto Iguazú", Province: "Misiones", PostalCode: "N3370"}, Province: "Misiones", Status: model.BranchStatusActive},
		// Corrientes
		{ID: "corrientes", Name: "CORR-01", Address: model.Address{Street: "Av. 3 de Abril 1200", City: "Corrientes", Province: "Corrientes", PostalCode: "W3400"}, Province: "Corrientes", Status: model.BranchStatusActive},
		// Entre Ríos
		{ID: "parana", Name: "PRAN-01", Address: model.Address{Street: "Av. Ramírez 1800", City: "Paraná", Province: "Entre Ríos", PostalCode: "E3100"}, Province: "Entre Ríos", Status: model.BranchStatusActive},
		{ID: "concordia", Name: "CONC-01", Address: model.Address{Street: "Av. Uruguay 500", City: "Concordia", Province: "Entre Ríos", PostalCode: "E3200"}, Province: "Entre Ríos", Status: model.BranchStatusActive},
		// Santiago del Estero
		{ID: "santiago", Name: "SGOE-01", Address: model.Address{Street: "Av. Belgrano 1100", City: "Santiago del Estero", Province: "Santiago del Estero", PostalCode: "G4200"}, Province: "Santiago del Estero", Status: model.BranchStatusActive},
		// San Juan
		{ID: "san-juan", Name: "SJUA-01", Address: model.Address{Street: "Av. Libertador 450", City: "San Juan", Province: "San Juan", PostalCode: "J5400"}, Province: "San Juan", Status: model.BranchStatusActive},
		// La Rioja
		{ID: "la-rioja", Name: "LRIJ-01", Address: model.Address{Street: "Av. Rivadavia 700", City: "La Rioja", Province: "La Rioja", PostalCode: "F5300"}, Province: "La Rioja", Status: model.BranchStatusActive},
		// Catamarca
		{ID: "catamarca", Name: "CATM-01", Address: model.Address{Street: "Av. Belgrano 300", City: "San Fernando del Valle de Catamarca", Province: "Catamarca", PostalCode: "K4700"}, Province: "Catamarca", Status: model.BranchStatusActive},
		// Neuquén
		{ID: "neuquen", Name: "NEUQ-01", Address: model.Address{Street: "Av. Argentina 500", City: "Neuquén", Province: "Neuquén", PostalCode: "Q8300"}, Province: "Neuquén", Status: model.BranchStatusActive},
		// Río Negro
		{ID: "bariloche", Name: "BARI-01", Address: model.Address{Street: "Av. Bustillo 1200", City: "San Carlos de Bariloche", Province: "Río Negro", PostalCode: "R8400"}, Province: "Río Negro", Status: model.BranchStatusActive},
		{ID: "viedma", Name: "VIED-01", Address: model.Address{Street: "Av. San Martín 800", City: "Viedma", Province: "Río Negro", PostalCode: "R8500"}, Province: "Río Negro", Status: model.BranchStatusActive},
		// Chubut
		{ID: "rawson", Name: "RAWS-01", Address: model.Address{Street: "Av. San Martín 100", City: "Rawson", Province: "Chubut", PostalCode: "U9103"}, Province: "Chubut", Status: model.BranchStatusActive},
		{ID: "comodoro", Name: "CRIV-01", Address: model.Address{Street: "Av. Rivadavia 2000", City: "Comodoro Rivadavia", Province: "Chubut", PostalCode: "U9000"}, Province: "Chubut", Status: model.BranchStatusActive},
		// Santa Cruz
		{ID: "rio-gallegos", Name: "RIGL-01", Address: model.Address{Street: "Av. San Martín 800", City: "Río Gallegos", Province: "Santa Cruz", PostalCode: "Z9400"}, Province: "Santa Cruz", Status: model.BranchStatusActive},
		{ID: "caleta-olivia", Name: "CAOL-01", Address: model.Address{Street: "Av. San Martín 1500", City: "Caleta Olivia", Province: "Santa Cruz", PostalCode: "Z9011"}, Province: "Santa Cruz", Status: model.BranchStatusActive},
		// Tierra del Fuego
		{ID: "ushuaia", Name: "USHU-01", Address: model.Address{Street: "Av. Maipú 500", City: "Ushuaia", Province: "Tierra del Fuego", PostalCode: "V9410"}, Province: "Tierra del Fuego", Status: model.BranchStatusActive},
		{ID: "rio-grande", Name: "RGRA-01", Address: model.Address{Street: "Av. San Martín 700", City: "Río Grande", Province: "Tierra del Fuego", PostalCode: "V9420"}, Province: "Tierra del Fuego", Status: model.BranchStatusActive},
		// Formosa
		{ID: "formosa", Name: "FORM-01", Address: model.Address{Street: "Av. González Lelong 300", City: "Formosa", Province: "Formosa", PostalCode: "P3600"}, Province: "Formosa", Status: model.BranchStatusActive},
		// Chaco
		{ID: "resistencia", Name: "RESI-01", Address: model.Address{Street: "Av. 9 de Julio 1000", City: "Resistencia", Province: "Chaco", PostalCode: "H3500"}, Province: "Chaco", Status: model.BranchStatusActive},
	}
	for _, b := range branches {
		b.CreatedAt = time.Now()
		b.UpdatedAt = time.Now()
		_ = repo.Create(b) // ignore duplicate errors on re-seed
	}
}
