import { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import * as Location from "expo-location";

interface LocationPickerProps {
  onLocationChange: (
    location: {
      latitude: number;
      longitude: number;
      wasManuallyAdjusted: boolean;
      originalLatitude?: number;
      originalLongitude?: number;
    } | null,
  ) => void;
  onLoadingChange?: (isLoading: boolean) => void; // 🔄 Notifies you when it´s charging
  error?: string;
}

export const LocationPicker: React.FC<LocationPickerProps> = ({
  onLocationChange,
  onLoadingChange,
  error,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [locationStatus, setLocationStatus] = useState<string>(
    "Obtendo localização...",
  );

  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // 📍 Notify parent whenever location changes (including when it becomes null)
  useEffect(() => {
    if (currentLocation) {
      onLocationChange({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        wasManuallyAdjusted: false,
      });
    } else {
      onLocationChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation]); // Only depend on currentLocation, not onLocationChange

  // 🔄 Notify parent whenever loading state changes
  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(isLoading);
    }
  }, [isLoading, onLoadingChange]);

  const requestLocationPermission = useCallback(async () => {
    try {
      setIsLoading(true);
      setLocationStatus("Verificando serviços de localização...");

      // Check if location services are enabled on the device
      const servicesEnabled = await Location.hasServicesEnabledAsync();

      if (!servicesEnabled) {
        setIsLoading(false);
        setLocationStatus("Serviços de localização desativados");
        setCurrentLocation(null);

        Alert.alert(
          "GPS Desativado",
          "Os serviços de localização estão desativados no seu dispositivo. Ative o GPS nas configurações para registrar o abastecimento.",
          [
            {
              text: "Tentar Novamente",
              onPress: requestLocationPermission,
            },
            {
              text: "Cancelar",
              style: "cancel",
            },
          ],
        );

        return;
      }

      // Request permission
      setLocationStatus("Solicitando permissão...");
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setIsLoading(false);
        setLocationStatus("Permissão de localização negada");

        setCurrentLocation(null);
        Alert.alert(
          "Permissão Negada",
          "A localização é obrigatória para registrar o abastecimento. Por favor, ative a permissão de localização nas configurações do app.",
          [{ text: "OK" }],
        );

        return;
      }

      // Get current location
      setLocationStatus("Capturando localização GPS...");
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      setCurrentLocation(coords);
      setLocationStatus("Localização capturada com sucesso!");

      setIsLoading(false);
    } catch {
      setIsLoading(false);
      setCurrentLocation(null);

      setLocationStatus("Erro ao obter localização");
      Alert.alert(
        "Erro de Localização",
        "Não foi possível obter sua localização. Verifique se o GPS está ativado e tente novamente.",
        [
          {
            text: "Tentar Novamente",
            onPress: requestLocationPermission,
          },
          {
            text: "Cancelar",
            style: "cancel",
          },
        ],
      );
    }
  }, []);

  useEffect(() => {
    void requestLocationPermission();
  }, [requestLocationPermission]);

  const handleRefreshLocation = () => {
    requestLocationPermission();
  };

  return (
    <View className="mb-4">
      <Text
        className="text-sm font-medium 
        text-gray-700 mb-2"
      >
        📍 Localização do Abastecimento <Text className="text-red-500">*</Text>
      </Text>

      <View
        className={`border rounded-lg p-4 ${
          error
            ? "border-red-500 bg-red-50"
            : currentLocation
              ? "border-green-500 bg-green-50"
              : "border-gray-300 bg-gray-50"
        }`}
      >
        {isLoading ? (
          <View className="flex-row items-center">
            <ActivityIndicator size="small" color="#3b82f6" />
            <Text className="ml-3 text-sm text-gray-600">{locationStatus}</Text>
          </View>
        ) : currentLocation ? (
          <View>
            {/* Success State */}
            <View className="flex-row items-center mb-3">
              <Ionicons name="checkmark-circle" size={24} color="#10b981" />
              <Text className="ml-2 text-sm font-medium text-green-700">
                {locationStatus}
              </Text>
            </View>

            {/* Location Details */}
            <View className="bg-white rounded-md p-3 mb-3">
              <View className="flex-row items-center mb-1">
                <Ionicons name="location" size={16} color="#6b7280" />
                <Text className="ml-2 text-xs text-gray-600">
                  Latitude: {currentLocation.latitude.toFixed(6)}
                </Text>
              </View>
              <View className="flex-row items-center">
                <Ionicons name="location" size={16} color="#6b7280" />
                <Text className="ml-2 text-xs text-gray-600">
                  Longitude: {currentLocation.longitude.toFixed(6)}
                </Text>
              </View>
            </View>

            {/* Refresh Button */}
            <TouchableOpacity
              onPress={handleRefreshLocation}
              className="flex-row items-center 
              justify-center bg-blue-500 rounded-md py-2"
            >
              <Ionicons name="refresh" size={18} color="white" />
              <Text className="ml-2 text-sm font-medium text-white">
                Atualizar Localização
              </Text>
            </TouchableOpacity>

            {/* Info Note */}
            <View className="mt-3 bg-blue-50 rounded-md p-2">
              <Text className="text-xs text-blue-700">
                💡 A localização foi capturada automaticamente pelo GPS do seu
                dispositivo.
              </Text>
            </View>
          </View>
        ) : (
          <View>
            {/* Error State */}
            <View className="flex-row items-center mb-3">
              <Ionicons name="alert-circle" size={24} color="#ef4444" />
              <Text className="ml-2 text-sm font-medium text-red-700">
                {locationStatus}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleRefreshLocation}
              className="flex-row items-center justify-center 
              bg-blue-500 rounded-md py-2"
            >
              <Ionicons name="refresh" size={18} color="white" />
              <Text className="ml-2 text-sm font-medium text-white">
                Tentar Novamente
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error Message from Parent */}
        {error && (
          <View className="mt-3 bg-red-100 rounded-md p-2">
            <Text className="text-xs text-red-700">⚠️ {error}</Text>
          </View>
        )}
      </View>

      {/* Important Information */}
      <View
        className="mt-2 bg-yellow-50 border 
        border-yellow-200 rounded-md p-3"
      >
        <Text
          className="text-xs text-yellow-800 
          font-medium mb-1"
        >
          ⚠️ Localização Obrigatória
        </Text>
        <Text className="text-xs text-yellow-700">
          A localização GPS é obrigatória para registrar o abastecimento.
          Certifique-se de que o GPS do dispositivo está ativado.
        </Text>
      </View>
    </View>
  );
};
