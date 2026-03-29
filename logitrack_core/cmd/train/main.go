package main

import (
	"fmt"
	"os"

	"github.com/logitrack/core/internal/ml"
	"github.com/logitrack/core/internal/model"
)

func main() {
	modelPath := "model.json"
	if len(os.Args) > 1 {
		modelPath = os.Args[1]
	}

	fmt.Println("============================================================")
	fmt.Println("LogiTrack ML — Shipment Priority Model Training")
	fmt.Println("============================================================")

	if err := ml.TrainAndSave(modelPath); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: %v\n", err)
		os.Exit(1)
	}

	// Quick validation
	fmt.Println("\n--- Sample predictions ---")
	svc := ml.NewMLService(modelPath)

	testCases := []model.CreateShipmentRequest{
		{
			Sender: model.Customer{
				Address: model.Address{Province: "Ciudad de Buenos Aires"},
			},
			Recipient: model.Customer{
				Address: model.Address{Province: "Santa Cruz"},
			},
			ShipmentType: model.ShipmentTypeExpress,
			TimeWindow:   model.TimeWindowMorning,
			PackageType:  model.PackageBox,
			WeightKg:     5.2,
			IsFragile:    true,
		},
		{
			Sender: model.Customer{
				Address: model.Address{Province: "Buenos Aires"},
			},
			Recipient: model.Customer{
				Address: model.Address{Province: "Ciudad de Buenos Aires"},
			},
			ShipmentType: model.ShipmentTypeNormal,
			TimeWindow:   model.TimeWindowFlexible,
			PackageType:  model.PackageEnvelope,
			WeightKg:     0.3,
			IsFragile:    false,
		},
		{
			Sender: model.Customer{
				Address: model.Address{Province: "Mendoza"},
			},
			Recipient: model.Customer{
				Address: model.Address{Province: "Tierra del Fuego"},
			},
			ShipmentType: model.ShipmentTypeExpress,
			TimeWindow:   model.TimeWindowAfternoon,
			PackageType:  model.PackagePallet,
			WeightKg:     30.0,
			IsFragile:    true,
			ColdChain:    true,
		},
	}

	names := []string{
		"Express long-distance fragile",
		"Normal short-distance envelope",
		"Express far-distance pallet fragile+cold",
	}

	for i, tc := range testCases {
		prediction := svc.PredictFromCreateRequest(tc)
		fmt.Printf("\n  %s:\n", names[i])
		if prediction != nil {
			fmt.Printf("    Priority: %s (confidence: %.2f, score: %.2f)\n",
				prediction.Priority, prediction.Confidence, prediction.Score)
		} else {
			fmt.Println("    ERROR: prediction returned nil")
		}
	}

	fmt.Println("\n============================================================")
	fmt.Printf("Training complete. Model saved to %s\n", modelPath)
	fmt.Println("The backend will load this model automatically on startup.")
	fmt.Println("============================================================")
}
