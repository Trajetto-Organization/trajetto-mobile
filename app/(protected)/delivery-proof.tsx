import { useMemo, useState } from "react";
import { Image, ScrollView, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";

import {
  Button,
  ImagePickerBottomSheet,
  Input,
  UploadProgressBar,
} from "../../components/ui";
import { SignaturePad } from "../../components/screens/deliveries";

import { useImageCapture } from "@/features/media/use-image-capture";
import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";

import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";
import type { UploadFile } from "@/features/media/upload-to-storage";

/**
 * Writes the drawn signature to a cache file so the outbox can own a copy
 * like any other photo — the queue copies files, never data URLs.
 */
const saveSignatureToFile = (dataUrl: string): UploadFile => {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

  const directory = new Directory(Paths.cache, "trajetto-signatures");
  directory.create({ intermediates: true, idempotent: true });

  const file = new File(directory, `${randomUUID()}.png`);
  file.write(bytes);

  return {
    uri: file.uri,
    fileName: file.name,
    fileSize: file.size ?? bytes.length,
    mimeType: "image/png",
  };
};

/**
 * Proof of delivery as a routed screen — not an RN Modal — because the
 * image picker bottom sheet and the toasts render through the app root's
 * portal, and a native Modal sits above that portal and hides them. The
 * checklist and refuelling made the same choice for the same reason.
 */
const DeliveryProofScreen = () => {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { businessId, deliveries } = useMyDeliveries();
  const actions = useDeliveryActions(businessId);

  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [signature, setSignature] = useState<UploadFile | null>(null);

  const [receivedBy, setReceivedBy] = useState<string>("");

  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [isSignatureOpen, setIsSignatureOpen] = useState<boolean>(false);

  const delivery = useMemo(
    () => deliveries.find((entry) => entry.id === id) ?? null,
    [deliveries, id],
  );

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
    if (!photo) return;

    const done = await actions.submitProof({
      deliveryId: delivery.id,
      recipientName: delivery.recipient_name,
      photo,
      signature,
      receivedBy,
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
              Comprovar entrega
            </Text>
            <Text className="text-xs text-gray-500" numberOfLines={1}>
              {delivery.recipient_name}
            </Text>
          </View>
        </View>

        <StatusBanners />

        <ScrollView className="flex-1 px-4 py-4">
          {/* Receipt photo — the proof itself */}
          <Text className="mb-1 text-sm font-medium text-gray-900">
            Foto do canhoto <Text className="text-red-500">*</Text>
          </Text>
          <Text className="mb-2 text-xs text-gray-500">
            Fotografe o canhoto assinado da nota. É a prova da entrega.
          </Text>

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
                Tirar foto do canhoto
              </Text>
            </TouchableOpacity>
          )}

          {/* On-screen signature — completes the proof */}
          <Text className="mb-1 text-sm font-medium text-gray-900">
            Assinatura na tela (opcional)
          </Text>

          {signature ? (
            <View className="mb-4">
              <Image
                source={{ uri: signature.uri }}
                className="h-28 w-full rounded-xl border border-gray-200 bg-white"
                resizeMode="contain"
              />
              <TouchableOpacity
                onPress={() => setIsSignatureOpen(true)}
                disabled={actions.isSubmitting}
                className="mt-2 self-start"
              >
                <Text className="text-sm font-medium text-primary-600">
                  Assinar novamente
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setIsSignatureOpen(true)}
              disabled={actions.isSubmitting}
              accessibilityRole="button"
              className="mb-4 items-center rounded-xl border-2 border-dashed
              border-gray-300 bg-white py-6"
            >
              <Ionicons name="create-outline" size={26} color="#6b7280" />
              <Text className="mt-1 text-sm text-gray-600">
                Colher assinatura do recebedor
              </Text>
            </TouchableOpacity>
          )}

          <Input
            label="Quem recebeu (opcional)"
            placeholder="Nome de quem assinou"
            value={receivedBy}
            onChangeText={setReceivedBy}
          />

          {actions.uploadProgress && (
            <View className="mt-4">
              <UploadProgressBar progress={actions.uploadProgress} />
            </View>
          )}
        </ScrollView>

        <View className="border-t border-gray-200 bg-white px-4 py-3">
          <Button
            onPress={handleSubmit}
            disabled={!photo || actions.isSubmitting}
            loading={actions.isSubmitting}
            fullWidth
          >
            Confirmar entrega
          </Button>
        </View>

        <ImagePickerBottomSheet
          visible={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          onTakePhoto={capture.takePhoto}
          onPickFromGallery={capture.pickFromGallery}
          title="Foto do canhoto"
          description="Fotografe o canhoto assinado da nota fiscal."
        />

        <SignaturePad
          visible={isSignatureOpen}
          onClose={() => setIsSignatureOpen(false)}
          onCapture={(dataUrl) => setSignature(saveSignatureToFile(dataUrl))}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default DeliveryProofScreen;
