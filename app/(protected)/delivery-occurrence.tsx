import { useMemo, useState } from "react";
import { Image, ScrollView, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";

import {
  Button,
  ImagePickerBottomSheet,
  Input,
  Select,
  UploadProgressBar,
} from "../../components/ui";

import { useImageCapture } from "@/features/media/use-image-capture";
import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";

import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";
import { occurrenceNeedsPhoto } from "@/features/deliveries/delivery-rules";

import type { UploadFile } from "@/features/media/upload-to-storage";

/**
 * A typed report of what went wrong at the stop, as a routed screen — not
 * an RN Modal — because the image picker bottom sheet and the toasts render
 * through the app root's portal, and a native Modal sits above that portal
 * and hides them. A photo-required type refuses a bare report before
 * anything enters the queue; a blocking type warns that the delivery flips
 * to Insucesso.
 */
const DeliveryOccurrenceScreen = () => {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { businessId, deliveries, occurrenceTypes } = useMyDeliveries();
  const actions = useDeliveryActions(businessId);

  const [occurrenceTypeId, setOccurrenceTypeId] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);

  const delivery = useMemo(
    () => deliveries.find((entry) => entry.id === id) ?? null,
    [deliveries, id],
  );

  const selectedType = useMemo(
    () => occurrenceTypes.find((type) => type.id === occurrenceTypeId) ?? null,
    [occurrenceTypes, occurrenceTypeId],
  );

  const missingPhoto = selectedType
    ? occurrenceNeedsPhoto(selectedType, photo ? 1 : 0)
    : false;

  const capture = useImageCapture({
    onCapture: (asset) => {
      setPhoto({
        uri: asset.uri,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        mimeType: asset.mimeType,
      });
      setIsPickerOpen(false);
    },
  });

  if (!delivery) {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-gray-50 px-8">
          <Ionicons name="checkmark-done-outline" size={44} color="#9ca3af" />
          <Text className="mt-3 text-center text-base font-medium text-gray-700">
            Esta entrega saiu da sua lista
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-gray-500">
            Ela foi concluída ou saiu da rota. A lista do dia está atualizada.
          </Text>
          <Button onPress={() => router.back()}>Voltar</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  const handleSubmit = async () => {
    if (!occurrenceTypeId || missingPhoto) return;

    const done = await actions.reportOccurrence({
      deliveryId: delivery.id,
      recipientName: delivery.recipient_name,
      occurrenceTypeId,
      description,
      photo,
    });

    if (done) router.back();
  };

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-semibold text-gray-900">
              Registrar ocorrência
            </Text>
            <Text className="text-xs text-gray-500" numberOfLines={1}>
              {delivery.recipient_name}
            </Text>
          </View>
        </View>

        <StatusBanners />

        <ScrollView className="flex-1 px-4 py-4">
          <Select
            label="Tipo de ocorrência"
            placeholder="Selecione o que aconteceu"
            value={occurrenceTypeId}
            onValueChange={setOccurrenceTypeId}
            options={occurrenceTypes.map((type) => ({
              label: type.name,
              value: type.id,
            }))}
            required
          />

          {selectedType?.description ? (
            <Text className="mb-2 mt-1 text-xs text-gray-500">
              {selectedType.description}
            </Text>
          ) : null}

          {selectedType?.blocks_delivery ? (
            <View
              className="mb-3 mt-1 flex-row items-center rounded-lg
              bg-red-50 px-3 py-2"
            >
              <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
              <Text className="ml-2 flex-1 text-xs text-red-700">
                Ocorrência impeditiva: a entrega passa para Insucesso ao
                registrar.
              </Text>
            </View>
          ) : null}

          <View className="mt-2">
            <Input
              label="Descrição (opcional)"
              placeholder="Conte o que aconteceu"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </View>

          <Text className="mb-1 mt-3 text-sm font-medium text-gray-900">
            Foto{" "}
            {selectedType?.requires_photo ? (
              <Text className="text-red-500">*</Text>
            ) : (
              <Text className="font-normal text-gray-500">(opcional)</Text>
            )}
          </Text>

          {selectedType?.requires_photo ? (
            <Text className="mb-2 text-xs text-gray-500">
              Este tipo de ocorrência exige foto anexada ao registro.
            </Text>
          ) : null}

          {photo ? (
            <View className="mb-4">
              <Image
                source={{ uri: photo.uri }}
                className="h-48 w-full rounded-xl"
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={() => setIsPickerOpen(true)}
                disabled={actions.isSubmitting}
                className="mt-2 self-start"
              >
                <Text className="text-sm font-medium text-primary-600">
                  Trocar foto
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setIsPickerOpen(true)}
              disabled={actions.isSubmitting}
              accessibilityRole="button"
              className="mb-4 items-center rounded-xl border-2 border-dashed
              border-gray-300 bg-white py-8"
            >
              <Ionicons name="camera-outline" size={28} color="#6b7280" />
              <Text className="mt-1 text-sm text-gray-600">
                Fotografar a ocorrência
              </Text>
            </TouchableOpacity>
          )}

          {actions.uploadProgress && (
            <View className="mt-2">
              <UploadProgressBar progress={actions.uploadProgress} />
            </View>
          )}
        </ScrollView>

        <View className="border-t border-gray-200 bg-white px-4 py-3">
          <Button
            onPress={handleSubmit}
            disabled={!occurrenceTypeId || missingPhoto || actions.isSubmitting}
            loading={actions.isSubmitting}
            fullWidth
          >
            Registrar ocorrência
          </Button>
        </View>

        <ImagePickerBottomSheet
          visible={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          onTakePhoto={capture.takePhoto}
          onPickFromGallery={capture.pickFromGallery}
          title="Foto da ocorrência"
          description="Fotografe o que aconteceu na entrega."
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default DeliveryOccurrenceScreen;
