import { useCallback, useEffect, useRef, useMemo } from "react";

import { View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";

import { useThemeColors } from "../../hooks/use-theme";
import { useCloseOnBack } from "../../hooks/use-close-on-back";

interface ImagePickerBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onTakePhoto: () => void;
  onPickFromGallery: () => void;
  title?: string; // 📸 Custom title for the bottom sheet
  description?: string; // 📝 Custom description
}

export const ImagePickerBottomSheet: React.FC<ImagePickerBottomSheetProps> = ({
  visible,
  onClose,
  onTakePhoto,
  onPickFromGallery,
  title = "Foto do Odômetro", // Default title
  description = "Como deseja adicionar a foto?", // Default description
}) => {
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets(); // 📱 Get safe area insets
  const colors = useThemeColors();

  // Snap points for the bottom sheet
  const snapPoints = useMemo(() => ["42%"], []);

  useCloseOnBack(visible, onClose);

  useEffect(() => {
    if (visible) {
      bottomSheetModalRef.current?.present();
    } else {
      bottomSheetModalRef.current?.dismiss();
    }
  }, [visible]);

  // Callback when the sheet is closed
  const handleSheetChanges = useCallback(
    (index: number) => {
      if (index === -1) {
        onClose();
      }
    },
    [onClose],
  );

  // Render custom backdrop
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleTakePhoto = () => {
    onClose();
    setTimeout(() => onTakePhoto(), 200); // Small delay to smooth the transition
  };

  const handlePickFromGallery = () => {
    onClose();
    setTimeout(() => onPickFromGallery(), 200); // Small delay to smooth the transition
  };

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChanges}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      backgroundStyle={{
        backgroundColor: colors.surface,
        borderRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: colors.input,
        width: 48,
        height: 6,
      }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        {/* Header */}
        <View className="px-6 pt-2 pb-4">
          <View className="items-center">
            <View
              className="w-16 h-16 bg-primary rounded-full
              items-center justify-center shadow-lg mb-4"
            >
              <Ionicons name="camera" size={32} color={colors.primaryForeground} />
            </View>
            <Text className="text-xl font-bold text-ink mb-2">
              {title}
            </Text>
            <Text className="text-muted text-center">{description}</Text>
          </View>
        </View>

        {/* Options */}
        <View className="px-6 gap-3 mb-4">
          {/* Camera Option */}
          <TouchableOpacity
            onPress={handleTakePhoto}
            testID="image-picker-camera"
            accessibilityRole="button"
            activeOpacity={0.8}
            className="flex-row items-center bg-subtle
            rounded-2xl p-4 border border-border"
          >
            <View
              className="w-12 h-12 bg-primary-soft
              rounded-full items-center justify-center mr-4"
            >
              <Ionicons name="camera" size={24} color={colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-ink mb-1">
                Tirar Foto
              </Text>
              <Text className="text-sm text-muted">
                Use a câmera do dispositivo
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>

          {/* Gallery Option */}
          <TouchableOpacity
            onPress={handlePickFromGallery}
            testID="image-picker-gallery"
            accessibilityRole="button"
            activeOpacity={0.8}
            className="flex-row items-center bg-subtle
            rounded-2xl p-4 border border-border"
          >
            <View
              className="w-12 h-12 bg-subtle border border-border
              rounded-full items-center justify-center mr-4"
            >
              <Ionicons name="image" size={24} color={colors.inkSoft} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-ink mb-1">
                Escolher da Galeria
              </Text>
              <Text className="text-sm text-muted">
                Selecione uma foto existente
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </TouchableOpacity>
        </View>

        {/* Cancel Button */}
        <View
          className="px-6"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <TouchableOpacity
            onPress={onClose}
            className="bg-subtle rounded-2xl py-4 px-6"
            activeOpacity={0.8}
          >
            <Text className="text-center text-ink-soft font-semibold">
              Cancelar
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
};
