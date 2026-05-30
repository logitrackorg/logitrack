package model

import "testing"

func TestCanRequestPickup_NotAtFinalBranch(t *testing.T) {
	cases := []struct {
		name            string
		status          Status
		currentLocation string
		finalBranchID   string
		wantOK          bool
	}{
		{
			name:            "at_origin_hub con location distinta al destino",
			status:          StatusAtOriginHub,
			currentLocation: "caba",
			finalBranchID:   "cordoba",
			wantOK:          false,
		},
		{
			name:            "in_transit sin estar en destino",
			status:          StatusInTransit,
			currentLocation: "caba",
			finalBranchID:   "mendoza",
			wantOK:          false,
		},
		{
			name:            "at_hub en sucursal destino",
			status:          StatusAtHub,
			currentLocation: "cordoba",
			finalBranchID:   "cordoba",
			wantOK:          true,
		},
		{
			name:            "location vacía (envío recién creado) no bloquea",
			status:          StatusAtOriginHub,
			currentLocation: "",
			finalBranchID:   "cordoba",
			wantOK:          true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &Shipment{
				DeliveryMethod:  DeliveryMethodLastMile,
				Status:          tc.status,
				CurrentLocation: tc.currentLocation,
				FinalBranchID:   tc.finalBranchID,
			}
			ok, msg := s.CanRequestPickup()
			if ok != tc.wantOK {
				t.Errorf("CanRequestPickup() = %v (%q), want %v", ok, msg, tc.wantOK)
			}
		})
	}
}
