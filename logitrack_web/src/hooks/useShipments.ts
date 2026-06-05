import useSWR from "swr";
import { shipmentApi, type Shipment } from "../api/shipments";

export interface ShipmentFilters {
  date_from?: string;
  date_to?: string;
  branch_id?: string;
  include_expired?: string;
}

export function useShipments(filters?: ShipmentFilters) {
  const { data, error, isLoading, mutate } = useSWR<Shipment[]>(
    ["shipments", filters],
    () => shipmentApi.list(filters),
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  );

  return {
    shipments: data,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}
