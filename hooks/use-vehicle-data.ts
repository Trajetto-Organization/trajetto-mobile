import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import type { Vehicle } from "../types/vehicle";

interface UseVehicleDataProps {
  vehicleId: string;
  businessId: string;
}

interface UseVehicleDataReturn {
  data: Vehicle | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useVehicleData = ({
  vehicleId,
  businessId,
}: UseVehicleDataProps): UseVehicleDataReturn => {
  const query = useQuery({
    queryKey: ["vehicle", businessId, vehicleId],
    enabled: Boolean(vehicleId && businessId),
    staleTime: 2 * 60 * 1000,
    queryFn: ({ signal }) =>
      apiClient.request<Vehicle>(
        `/vehicle/get-vehicle/${vehicleId}/business/${businessId}`,
        { method: "GET", signal },
      ),
  });

  const error = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Erro ao carregar dados do veículo"
    : null;

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error,
    refetch: async () => {
      await query.refetch();
    },
  };
};
