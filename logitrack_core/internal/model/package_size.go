package model

// =============================================================================
// Tamaños de envío.
//
// La idea: en logística real las cajas no son binarias (sobre|caja). Los couriers
// argentinos (Mercado Envíos, Andreani, OCA) usan tiers de tamaño con dimensiones
// y peso máximo predefinidos.
// =============================================================================

// PackageSize es el tier de tamaño de un envío. Reemplaza al viejo binario
// envelope|box. Cada tier tiene dimensiones y peso máximo definidos en
// PackageSizeSpecs.
type PackageSize string

const (
	PackageSizeSobre PackageSize = "sobre"
	PackageSizeS     PackageSize = "S"
	PackageSizeM     PackageSize = "M"
	PackageSizeL     PackageSize = "L"
	PackageSizeXL    PackageSize = "XL"
)

// PackageSizeSpec describe el tier: dimensiones físicas + peso máximo soportado.
type PackageSizeSpec struct {
	Label       string  // texto corto para UI: "S", "M", "Sobre"
	LengthCm    float64 // largo en cm
	WidthCm     float64 // ancho en cm
	HeightCm    float64 // alto en cm
	MaxWeightKg float64 // tope de peso que tolera esta caja
}

// PackageSizeSpecs es el catálogo de tiers. Editar acá implica revisión de
// pricing y UI del selector.
var PackageSizeSpecs = map[PackageSize]PackageSizeSpec{
	PackageSizeSobre: {Label: "Sobre", LengthCm: 32, WidthCm: 24, HeightCm: 2, MaxWeightKg: 2},
	PackageSizeS:     {Label: "S", LengthCm: 30, WidthCm: 20, HeightCm: 15, MaxWeightKg: 3},
	PackageSizeM:     {Label: "M", LengthCm: 40, WidthCm: 30, HeightCm: 20, MaxWeightKg: 8},
	PackageSizeL:     {Label: "L", LengthCm: 50, WidthCm: 40, HeightCm: 30, MaxWeightKg: 25},
	PackageSizeXL:    {Label: "XL", LengthCm: 60, WidthCm: 50, HeightCm: 40, MaxWeightKg: 50},
}

// VolumeM3 devuelve el volumen del tier en m³.
func (s PackageSize) VolumeM3() float64 {
	spec, ok := PackageSizeSpecs[s]
	if !ok {
		return 0
	}
	// cm³ → m³: dividir por 1_000_000
	return spec.LengthCm * spec.WidthCm * spec.HeightCm / 1_000_000
}

// IsEnvelope es true para el tier sobre.
func (s PackageSize) IsEnvelope() bool {
	return s == PackageSizeSobre
}

// IsValid es true si el size está en el catálogo.
func (s PackageSize) IsValid() bool {
	_, ok := PackageSizeSpecs[s]
	return ok
}

// MaxWeightKg devuelve el tope de peso del tier (0 si tier inválido).
func (s PackageSize) MaxWeightKg() float64 {
	spec, ok := PackageSizeSpecs[s]
	if !ok {
		return 0
	}
	return spec.MaxWeightKg
}

// PackageSizeFromLegacy convierte el viejo PackageType + WeightKg al tier
// equivalente. Usado en migraciones de DB y al leer datos antiguos.
//   - envelope → sobre
//   - box + weight ≤ 3 → S
//   - box + weight ≤ 8 → M
//   - box + weight ≤ 25 → L
//   - box + weight > 25 → XL
func PackageSizeFromLegacy(legacy string, weightKg float64) PackageSize {
	if legacy == "envelope" {
		return PackageSizeSobre
	}
	switch {
	case weightKg <= 3:
		return PackageSizeS
	case weightKg <= 8:
		return PackageSizeM
	case weightKg <= 25:
		return PackageSizeL
	default:
		return PackageSizeXL
	}
}

