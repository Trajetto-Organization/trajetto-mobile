import { useCallback, useEffect, useRef, useMemo } from "react";

import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";

interface ImagePickerBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onTakePhoto: () => void;
  onPickFromGallery: () => void;
}

export const ImagePickerBottomSheet: React.FC<ImagePickerBottomSheetProps> = ({
  visible,
  onClose,
  onTakePhoto,
  onPickFromGallery,
}) => {
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);

  // Snap points for the bottom sheet
  const snapPoints = useMemo(() => ["42%"], []);

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
    [onClose]
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
    []
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
        backgroundColor: "#ffffff",
        borderRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: "#d1d5db",
        width: 48,
        height: 6,
      }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        {/* Header */}
        <View className="px-6 pt-2 pb-4">
          <View className="items-center">
            <View
              className="w-16 h-16 bg-gradient-to-br
              from-primary-500 to-primary-600 rounded-full
              items-center justify-center shadow-lg mb-4"
            >
              <Ionicons name="camera" size={32} color="white" />
            </View>
            <Text className="text-xl font-bold text-gray-900 mb-2">
              Foto do Odômetro
            </Text>
            <Text className="text-gray-600 text-center">
              Como deseja adicionar a foto?
            </Text>
          </View>
        </View>

        {/* Options */}
        <View className="px-6 gap-3 mb-4">
          {/* Camera Option */}
          <TouchableOpacity
            onPress={handleTakePhoto}
            activeOpacity={0.8}
            className="flex-row items-center bg-gray-50
            rounded-2xl p-4 border border-gray-200"
          >
            <View
              className="w-12 h-12 bg-blue-100
              rounded-full items-center justify-center mr-4"
            >
              <Ionicons name="camera" size={24} color="#3b82f6" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-gray-900 mb-1">
                Tirar Foto
              </Text>
              <Text className="text-sm text-gray-500">
                Use a câmera do dispositivo
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>

          {/* Gallery Option */}
          <TouchableOpacity
            onPress={handlePickFromGallery}
            activeOpacity={0.8}
            className="flex-row items-center bg-gray-50
            rounded-2xl p-4 border border-gray-200"
          >
            <View
              className="w-12 h-12 bg-purple-100
              rounded-full items-center justify-center mr-4"
            >
              <Ionicons name="image" size={24} color="#8b5cf6" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-gray-900 mb-1">
                Escolher da Galeria
              </Text>
              <Text className="text-sm text-gray-500">
                Selecione uma foto existente
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {/* Cancel Button */}
        <View className="px-6 pb-4">
          <TouchableOpacity
            onPress={onClose}
            className="bg-gray-100 rounded-2xl py-4 px-6"
            activeOpacity={0.8}
          >
            <Text className="text-center text-gray-700 font-semibold">
              Cancelar
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
};
