import React from "react";

import { View } from "react-native";
import { SkeletonCard } from "./skeleton-card";

export const VehicleSkeleton: React.FC = () => {
  return (
    <View
      className="bg-white rounded-lg 
      shadow-sm border border-gray-200 p-4 mb-3 mx-4"
    >
      {/* Header with brand and model */}
      <View
        className="flex-row 
        justify-between 
        items-start mb-3"
      >
        <View className="flex-1">
          <SkeletonCard className="h-5 w-32 rounded mb-1" />
          <SkeletonCard className="h-4 w-24 rounded" />
        </View>
        <SkeletonCard className="h-6 w-16 rounded-full" />
      </View>

      {/* License plate */}
      <View className="mb-3">
        <SkeletonCard className="h-4 w-20 rounded mb-1" />
        <SkeletonCard className="h-5 w-28 rounded" />
      </View>

      {/* Mileage info */}
      <View className="flex-row justify-between">
        <View>
          <SkeletonCard className="h-4 w-24 rounded mb-1" />
          <SkeletonCard className="h-5 w-32 rounded" />
        </View>
        <View className="items-end">
          <SkeletonCard className="h-4 w-20 rounded mb-1" />
          <SkeletonCard className="h-5 w-16 rounded" />
        </View>
      </View>
    </View>
  );
};

export const VehicleSkeletonList: React.FC<{ count?: number }> = ({
  count = 6,
}) => {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <VehicleSkeleton key={index} />
      ))}
    </>
  );
};
