import { memo } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import type { ImagePickerAsset } from "expo-image-picker";

interface ChecklistPhotoSectionProps {
  fieldName: string;
  label: string;
  images: ImagePickerAsset[];
  isRequired: boolean;
  reason?: string;
  onImagePicker: (fieldName: string) => void;
  onRemoveImage: (fieldName: string, imageIndex: number) => void;
}

export const ChecklistPhotoSection = memo(
  function ChecklistPhotoSection({
    fieldName,
    label,
    images,
    isRequired,
    reason,
    onImagePicker,
    onRemoveImage,
  }: ChecklistPhotoSectionProps) {
    return (
      <View className="mb-4">
        <View className="mb-2">
          <View className="flex-row items-center flex-wrap">
            <Text className="text-sm font-medium text-gray-700">
              📷 {label}
              {isRequired && <Text className="text-red-500"> *</Text>}
            </Text>
          </View>
          {reason ? (
            <Text className="text-xs text-gray-500 mt-1 flex-wrap">
              {reason}
            </Text>
          ) : null}
        </View>

        {images.length > 0 ? (
          <View className="flex-row flex-wrap gap-2 mb-2">
            {images.map((image, index) => (
              <View key={`${image.uri}-${index}`} className="relative">
                <Image
                  source={image.uri}
                  recyclingKey={image.uri}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  style={{ width: 80, height: 80, borderRadius: 8 }}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Remover ${label}`}
                  onPress={() => onRemoveImage(fieldName, index)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full items-center justify-center"
                >
                  <Ionicons name="close" size={12} color="white" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => onImagePicker(fieldName)}
          className={`border-2 border-dashed rounded-lg p-3 items-center ${
            isRequired ? "border-red-300 bg-red-50" : "border-gray-300"
          }`}
        >
          <Ionicons
            name="camera"
            size={24}
            color={isRequired ? "#ef4444" : "#9ca3af"}
          />
          <Text
            className={`text-sm mt-1 ${
              isRequired ? "text-red-600" : "text-gray-600"
            }`}
          >
            {images.length > 0 ? "Adicionar mais fotos" : "Adicionar foto"}
          </Text>
          {isRequired ? (
            <Text className="text-xs text-red-500 mt-1">Obrigatório</Text>
          ) : null}
        </TouchableOpacity>
      </View>
    );
  },
);
