package model

import "testing"

func TestCanRequestPickup(t *testing.T) {
	cases := []struct {
		name           string
		deliveryMethod DeliveryMethod
		status         Status
		finalBranchID  string
		wantOK         bool
	}{
		{
			name:           "last_mile en at_origin_hub puede solicitar pickup",
			deliveryMethod: DeliveryMethodLastMile,
			status:         StatusAtOriginHub,
			finalBranchID:  "cordoba",
			wantOK:         true,
		},
		{
			name:           "last_mile en in_transit puede solicitar pickup",
			deliveryMethod: DeliveryMethodLastMile,
			status:         StatusInTransit,
			finalBranchID:  "mendoza",
			wantOK:         true,
		},
		{
			name:           "last_mile en at_hub puede solicitar pickup",
			deliveryMethod: DeliveryMethodLastMile,
			status:         StatusAtHub,
			finalBranchID:  "cordoba",
			wantOK:         true,
		},
		{
			name:           "ya es branch_pickup — no permitir de nuevo",
			deliveryMethod: DeliveryMethodBranchPickup,
			status:         StatusAtHub,
			finalBranchID:  "cordoba",
			wantOK:         false,
		},
		{
			name:           "out_for_delivery — no permitir",
			deliveryMethod: DeliveryMethodLastMile,
			status:         StatusOutForDelivery,
			finalBranchID:  "cordoba",
			wantOK:         false,
		},
		{
			name:           "estado terminal — no permitir",
			deliveryMethod: DeliveryMethodLastMile,
			status:         StatusDelivered,
			finalBranchID:  "cordoba",
			wantOK:         false,
		},
		{
			name:           "sin FinalBranchID — no permitir",
			deliveryMethod: DeliveryMethodLastMile,
			status:         StatusAtOriginHub,
			finalBranchID:  "",
			wantOK:         false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &Shipment{
				DeliveryMethod: tc.deliveryMethod,
				Status:         tc.status,
				FinalBranchID:  tc.finalBranchID,
			}
			ok, msg := s.CanRequestPickup()
			if ok != tc.wantOK {
				t.Errorf("CanRequestPickup() = %v (%q), want %v", ok, msg, tc.wantOK)
			}
		})
	}
}
