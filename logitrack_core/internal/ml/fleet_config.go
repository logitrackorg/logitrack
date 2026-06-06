package ml

// FleetFactorOrder defines the order of features in FleetSample.Features.
// The order must be identical during training and inference.
var FleetFactorOrder = []string{
	"day_of_week",
	"total_shipments",
	"sla_delay_pct",
	"orphan_shipments",
	"idle_drivers",
	"active_drivers_load",
}

const (
	FleetDatasetSize    = 2000
	FleetLabelNoiseRate = 0.05 // 5 % — simulates real-world label variability
	FleetRandomState    = int64(99)
	FleetNumTrees       = 100
	FleetNumClasses     = 5
)

// Fleet class indices — must match FleetClassToStatus.
const (
	FleetClassCritical   = 0
	FleetClassWarning    = 1
	FleetClassPreventive = 2
	FleetClassIdle       = 3
	FleetClassStable     = 4
)

// Normalization ceilings (practical maxima observed in production).
const (
	fleetMaxShipments  = 500.0
	fleetMaxDelay      = 30.0 // % — values above 30 % are saturated to 1.0
	fleetMaxOrphans    = 50.0
	fleetMaxIdleDriver = 10.0
	fleetMaxLoad       = 35.0 // avg packages per busy driver
)
