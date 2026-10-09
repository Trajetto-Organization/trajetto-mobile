import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";

interface UploadProgressBarProps {
  progress: { uploaded: number; total: number } | null;
}

/**
 * Shows how far along a submission actually is.
 *
 * The photos leave the device one by one now, which on a truck-stop connection
 * is the slowest part of registering a checklist — slow enough that a bare
 * spinner reads as a hang, and a driver who thinks the app froze will kill it
 * and start over. A counter that moves is the difference between waiting and
 * giving up.
 *
 * The fill is a full-width bar translated left and clipped by the track, rather
 * than an animated `width`. Width is a layout property and cannot run on the
 * native driver, so it would stutter exactly when the JS thread is busiest.
 */
const UploadProgressBar: React.FC<UploadProgressBarProps> = ({ progress }) => {
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const fill = useRef(new Animated.Value(0)).current;

  const ratio =
    progress && progress.total > 0 ? progress.uploaded / progress.total : 0;

  useEffect(() => {
    // Back to zero between submissions: this component survives the gap (the
    // parent keeps rendering it, it just returns null), so without the reset
    // the next upload would start with the previous bar already full.
    if (!progress) {
      fill.setValue(0);
      return;
    }

    Animated.timing(fill, {
      toValue: ratio,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, ratio, fill]);

  if (!progress || progress.total === 0) return null;

  const { uploaded, total } = progress;
  const percentage = Math.round(ratio * 100);

  // The refuelling screen sends a single photo and the checklist sends up to
  // twenty, so both wordings show up in practice.
  const isSingle = total === 1;

  // Once the photos are up, the wait is the record being saved. Saying
  // "enviando fotos" through that would be a lie the driver can see, since the
  // bar is already full.
  const label =
    uploaded < total
      ? `Enviando ${isSingle ? "foto" : "fotos"}… ${uploaded} de ${total}`
      : `${isSingle ? "Foto enviada" : "Fotos enviadas"}. Salvando…`;

  return (
    <View
      className="mb-3"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: uploaded, text: label }}
    >
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-xs font-medium text-muted">{label}</Text>

        <Text
          className="text-xs font-semibold text-primary"
          // Keeps the percentage from shifting as digits change width.
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {percentage}%
        </Text>
      </View>

      <View
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        className="h-1.5 overflow-hidden rounded-full bg-border"
      >
        {/* Held back until measured — at width zero the translation below
            resolves to zero too, which would flash a full bar. */}
        {trackWidth > 0 && (
          <Animated.View
            className="h-full rounded-full bg-primary"
            style={{
              width: trackWidth,
              transform: [
                {
                  translateX: fill.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-trackWidth, 0],
                  }),
                },
              ],
            }}
          />
        )}
      </View>
    </View>
  );
};

export { UploadProgressBar };
export type { UploadProgressBarProps };
