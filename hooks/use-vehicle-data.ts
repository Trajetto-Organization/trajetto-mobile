import { useState, useEffect } from "react";
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
  refetch: () => void;
}

export const useVehicleData = ({
  vehicleId,
  businessId,
}: UseVehicleDataProps): UseVehicleDataReturn => {
  const [data, setData] = useState<Vehicle | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVehicleData = async () => {
    if (!vehicleId || !businessId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<Vehicle>(
        `/vehicle/get-vehicle/${vehicleId}/business/${businessId}`,
      );

      setData(response);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Erro ao carregar dados do veículo";

      setError(errorMessage);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicleData();
  }, [vehicleId, businessId]);

  const refetch = () => {
    fetchVehicleData();
  };

  return {
    data,
    isLoading,
    error,
    refetch,
  };
};
