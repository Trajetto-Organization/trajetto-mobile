import React from "react";
import { View, Text, Image } from "react-native";

interface AvatarProps {
  name: string;
  avatar?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatar,
  size = "md",
  className = "",
}) => {
  const getInitials = (fullName: string): string => {
    const names = fullName.trim().split(" ");
    if (names.length === 1) {
      return names[0].substring(0, 2).toUpperCase();
    }
    return (
      names[0].charAt(0) + names[names.length - 1].charAt(0)
    ).toUpperCase();
  };

  const getSizeClasses = () => {
    switch (size) {
      case "sm":
        return {
          container: "w-8 h-8",
          text: "text-xs",
        };
      case "md":
        return {
          container: "w-11 h-11",
          text: "text-sm",
        };
      case "lg":
        return {
          container: "w-14 h-14",
          text: "text-base",
        };
      case "xl":
        return {
          container: "w-20 h-20",
          text: "text-xl",
        };
      default:
        return {
          container: "w-11 h-11",
          text: "text-sm",
        };
    }
  };

  const sizeClasses = getSizeClasses();

  if (avatar) {
    return (
      <View
        className={`${sizeClasses.container} 
        rounded-full overflow-hidden ${className}`}
      >
        <Image
          source={{ uri: avatar }}
          className="w-full h-full"
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View
      className={`${sizeClasses.container} rounded-full bg-gray-100 
      items-center justify-center shadow-sm ${className}`}
      style={{
        backgroundColor: "#f1f5f9", // slate-100
      }}
    >
      <Text className={`${sizeClasses.text} font-medium text-gray-600`}>
        {getInitials(name)}
      </Text>
    </View>
  );
};
