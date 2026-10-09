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

import {
  LocationCaptureError,
  REFUEL_LAST_KNOWN,
  readLocation,
} from "@/features/tracking/capture-location";
import { readingCopy } from "@/features/tracking/location-reading-copy";
import { useThemeColors } from "@/hooks/use-theme";

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
  const colors = useThemeColors();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [locationStatus, setLocationStatus] = useState<string>(
    "Obtendo localização...",
  );

  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Fresh fix or the phone's last position: the card says which.
  const [readingNote, setReadingNote] = useState<string | null>(null);

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

      // Bounded, with the phone's last known position as fallback only when
      // it is recent and precise enough to be the station itself: under a
      // canopy the first fix could take minutes and the form sat spinning
      // with no way out (MOB-13). The permission request is inside it too.
      setLocationStatus("Capturando localização GPS...");
      const reading = await readLocation({
        required: true,
        accuracy: Location.Accuracy.High,
        lastKnown: REFUEL_LAST_KNOWN,
      });

      // `required` throws rather than answering null; kept for the types.
      if (!reading) throw new Error("Location unavailable");

      const copy = readingCopy(reading.source, REFUEL_LAST_KNOWN);

      setCurrentLocation({
        latitude: reading.latitude,
        longitude: reading.longitude,
      });
      setLocationStatus(copy.status);
      setReadingNote(copy.note);

      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
      setCurrentLocation(null);
      setReadingNote(null);

      if (error instanceof LocationCaptureError && error.reason === "denied") {
        setLocationStatus("Permissão de localização negada");

        Alert.alert(
          "Permissão Negada",
          "A localização é obrigatória para registrar o abastecimento. Por favor, ative a permissão de localização nas configurações do app.",
          [{ text: "OK" }],
        );

        return;
      }

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
        text-ink-soft mb-2"
      >
        📍 Localização do Abastecimento <Text className="text-destructive">*</Text>
      </Text>

      <View
        className={`border rounded-lg p-4 ${
          error
            ? "border-destructive bg-destructive-soft"
            : currentLocation
              ? "border-success bg-success-soft"
              : "border-input bg-subtle"
        }`}
      >
        {isLoading ? (
          <View className="flex-row items-center">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text className="ml-3 text-sm text-muted">{locationStatus}</Text>
          </View>
        ) : currentLocation ? (
          <View>
            {/* Success State */}
            <View className="flex-row items-center mb-3">
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
              <Text className="ml-2 text-sm font-medium text-success">
                {locationStatus}
              </Text>
            </View>

            {/* Location Details */}
            <View className="bg-card rounded-md p-3 mb-3">
              <View className="flex-row items-center mb-1">
                <Ionicons name="location" size={16} color={colors.muted} />
                <Text className="ml-2 text-xs text-muted">
                  Latitude: {currentLocation.latitude.toFixed(6)}
                </Text>
              </View>
              <View className="flex-row items-center">
                <Ionicons name="location" size={16} color={colors.muted} />
                <Text className="ml-2 text-xs text-muted">
                  Longitude: {currentLocation.longitude.toFixed(6)}
                </Text>
              </View>
            </View>

            {/* Refresh Button */}
            <TouchableOpacity
              onPress={handleRefreshLocation}
              className="flex-row items-center 
              justify-center bg-primary rounded-md py-2"
            >
              <Ionicons name="refresh" size={18} color={colors.primaryForeground} />
              <Text className="ml-2 text-sm font-medium text-primary-foreground">
                Atualizar Localização
              </Text>
            </TouchableOpacity>

            {/* Info Note: which kind of reading this is */}
            {readingNote && (
              <View className="mt-3 bg-primary-soft rounded-md p-2">
                <Text className="text-xs text-primary">💡 {readingNote}</Text>
              </View>
            )}
          </View>
        ) : (
          <View>
            {/* Error State */}
            <View className="flex-row items-center mb-3">
              <Ionicons name="alert-circle" size={24} color={colors.destructive} />
              <Text className="ml-2 text-sm font-medium text-destructive">
                {locationStatus}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleRefreshLocation}
              className="flex-row items-center justify-center 
              bg-primary rounded-md py-2"
            >
              <Ionicons name="refresh" size={18} color={colors.primaryForeground} />
              <Text className="ml-2 text-sm font-medium text-primary-foreground">
                Tentar Novamente
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error Message from Parent */}
        {error && (
          <View className="mt-3 bg-destructive-soft rounded-md p-2">
            <Text className="text-xs text-destructive">⚠️ {error}</Text>
          </View>
        )}
      </View>

      {/* Important Information */}
      <View
        className="mt-2 bg-warning-soft border 
        border-warning/40 rounded-md p-3"
      >
        <Text
          className="text-xs text-warning 
          font-medium mb-1"
        >
          ⚠️ Localização Obrigatória
        </Text>
        <Text className="text-xs text-warning">
          A localização GPS é obrigatória para registrar o abastecimento.
          Certifique-se de que o GPS do dispositivo está ativado.
        </Text>
      </View>
    </View>
  );
};
