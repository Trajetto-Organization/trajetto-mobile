import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useThemeColors } from "../../hooks/use-theme";
import { cn } from "../../utils/cn";
import { segmentedThumbMotion, type ThumbPlacement } from "../../utils/theme-rules";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Read by TalkBack for the group ("Tema"). */
  accessibilityLabel: string;
  className?: string;
  /** Maestro handle: each option gets `<testID>-<value>`. */
  testID?: string;
}

// The track's inner padding (p-1), which the sliding thumb has to respect.
const TRACK_PADDING = 4;

/**
 * A row of mutually exclusive options with a thumb that slides to the chosen
 * one, like the web's ThemeSegmented. The thumb moves on the UI thread
 * (Reanimated), and Reanimated's default honours the system's reduced
 * motion, where it jumps instead.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  className,
  testID,
}: SegmentedControlProps<T>) {
  const colors = useThemeColors();
  const [trackWidth, setTrackWidth] = useState(0);

  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const segmentWidth = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / options.length : 0;

  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width !== trackWidth) setTrackWidth(width);
  };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      className={cn("flex-row rounded-xl bg-subtle p-1", className)}
    >
      {segmentWidth > 0 && (
        <SegmentedThumb index={index} segmentWidth={segmentWidth} />
      )}

      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            testID={testID ? `${testID}-${option.value}` : undefined}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            className="min-h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg px-2 py-2"
          >
            {option.icon && (
              <Ionicons name={option.icon} size={16} color={selected ? colors.ink : colors.muted} />
            )}
            <Text
              className={cn(
                "text-sm",
                selected ? "font-semibold text-ink" : "font-medium text-muted",
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface SegmentedThumbProps {
  index: number;
  segmentWidth: number;
}

/**
 * Mounted only once the track is measured, already at its place: the first
 * frame needs no shared-value update. Found on the emulator: on the first
 * opening of the settings drawer after a cold start, the thumb hidden until
 * an effect set its opacity never showed ("Sistema" selected, no thumb);
 * Reanimated dropped that first update for a view mounted mid-way through
 * the sheet's presentation. Later moves (another pick, a new width) go
 * through segmentedThumbMotion as before.
 */
function SegmentedThumb({ index, segmentWidth }: SegmentedThumbProps) {
  const colors = useThemeColors();
  const offset = useSharedValue(index * segmentWidth);
  const previous = useRef<ThumbPlacement>({ index, segmentWidth });

  useEffect(() => {
    const next = { index, segmentWidth };
    const motion = segmentedThumbMotion(previous.current, next);
    if (motion === "none") return;
    previous.current = next;

    const target = index * segmentWidth;
    offset.value = motion === "snap" ? target : withTiming(target, { duration: 180 });
  }, [index, segmentWidth, offset]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      // Styled by value, not className: Reanimated's views are not
      // NativeWind-interop'd, and a class here would silently do nothing.
      style={[
        {
          position: "absolute",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          top: TRACK_PADDING,
          bottom: TRACK_PADDING,
          left: TRACK_PADDING,
          width: segmentWidth,
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.08,
          shadowRadius: 2,
          elevation: 1,
        },
        thumbStyle,
      ]}
    />
  );
}
