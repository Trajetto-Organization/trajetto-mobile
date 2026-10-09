import { memo } from "react";
import { Text, TouchableOpacity, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";

import type { ImagePickerAsset } from "expo-image-picker";

import { useThemeColors } from "@/hooks/use-theme";

interface ChecklistPhotoSectionProps {
  fieldName: string;
  label: string;
  images: ImagePickerAsset[];
  isRequired: boolean;
  reason?: string;

  /**
   * The missing-photo message, only once it should show (decision 16.700):
   * a required area stays neutral, asterisk only, until it is invalid.
   */
  error?: string;
  onImagePicker: (fieldName: string) => void;
  onRemoveImage: (fieldName: string, imageIndex: number) => void;
}

export const ChecklistPhotoSection = memo(function ChecklistPhotoSection({
  fieldName,
  label,
  images,
  isRequired,
  reason,
  error,
  onImagePicker,
  onRemoveImage,
}: ChecklistPhotoSectionProps) {
  const colors = useThemeColors();
  const isInvalid = Boolean(error);

  return (
    <View className="mb-4">
      <View className="mb-2">
        <View className="flex-row items-center flex-wrap">
          <Text className="text-sm font-medium text-ink-soft">
            📷 {label}
            {isRequired && <Text className="text-destructive"> *</Text>}
          </Text>
        </View>
        {reason ? (
          <Text className="text-xs text-muted mt-1 flex-wrap">{reason}</Text>
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
                className="absolute -top-2 -right-2 w-6 h-6 bg-destructive 
                rounded-full items-center justify-center"
              >
                <Ionicons name="close" size={12} color={colors.destructiveForeground} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        accessibilityRole="button"
        // Keeps what the visible text tells sighted users: the action and the required state.
        accessibilityLabel={`${label}, ${
          images.length > 0 ? "adicionar mais fotos" : "adicionar foto"
        }${isRequired ? ", obrigatório" : ""}${error ? ". " + error : ""}`}
        testID={`checklist-photo-${fieldName}`}
        onPress={() => onImagePicker(fieldName)}
        className={`border-2 border-dashed rounded-lg p-3 items-center ${
          isInvalid ? "border-destructive/40 bg-destructive-soft" : "border-input"
        }`}
      >
        <Ionicons
          name="camera"
          size={24}
          color={isInvalid ? colors.destructive : colors.muted}
        />
        <Text
          className={`text-sm mt-1 ${
            isInvalid ? "text-destructive" : "text-muted"
          }`}
        >
          {images.length > 0 ? "Adicionar mais fotos" : "Adicionar foto"}
        </Text>
        {isInvalid ? (
          <Text className="text-xs text-destructive mt-1">{error}</Text>
        ) : null}
      </TouchableOpacity>
    </View>
  );
});
