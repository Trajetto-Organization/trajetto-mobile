import { useEffect } from "react";
import { View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { chatPresenceHintAccessibilityLabel } from "@/features/chat/chat-rules";
import { useThemeColors } from "@/hooks/use-theme";

/**
 * One full round trip of a bar, up and back down. Faster than the typing
 * bubble's cycle on purpose: dots think, a level meter reacts.
 */
const CYCLE_MS = 900;

/** What separates one bar from the next — a wave, not a blink. */
const STAGGER_MS = 110;

const BAR_INDEXES = [0, 1, 2, 3];

const BAR_WIDTH = 3;
const BAR_HEIGHT = 16;

/** How short a bar gets at the bottom of its travel. Never zero: a level
 * meter that empties reads as "stopped", which is the opposite of the news. */
const BAR_MIN_SCALE = 0.28;


/**
 * The heights the bars hold still at when the device asks for less motion.
 * Deliberately uneven: four bars of the same height read as a decoration,
 * four uneven ones still read as sound.
 */
const STATIC_SCALES = [0.45, 1, 0.65, 0.35];

interface LevelBarProps {
  progress: SharedValue<number>;
  staticScale: number;
  reduceMotion: boolean;
  /** The recording red (`destructive`), the same as the driver's own recording dot. */
  color: string;
}

const LevelBar = ({ progress, staticScale, reduceMotion, color }: LevelBarProps) => {
  const style = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: 0.9, transform: [{ scaleY: staticScale }] };
    }

    return {
      opacity: 0.55 + progress.value * 0.45,
      transform: [
        { scaleY: BAR_MIN_SCALE + progress.value * (1 - BAR_MIN_SCALE) },
      ],
    };
  }, [reduceMotion, staticScale]);

  return (
    <Animated.View
      style={[
        {
          width: BAR_WIDTH,
          height: BAR_HEIGHT,
          borderRadius: BAR_WIDTH / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
};

/**
 * "Gravando um áudio" as a picture: a microphone breathing next to a level
 * meter. It sits exactly where the typing bubble sits — the operation's side
 * of the conversation, anchored at the end of the list — and the header line
 * says the words.
 *
 * It is NOT the three dots with another label. A driver glancing at the
 * screen between two manoeuvres has to know, without reading, that what is
 * coming is a voice and not a sentence: the wait is different, and so is what
 * they should do with the phone. Hence a mic and a meter, in the recording
 * red the driver already knows from their own recording bar.
 *
 * The bars all run the same CYCLE_MS loop and differ only by their start
 * delay, which is what keeps the wave in phase instead of drifting apart over
 * a conversation left open for an hour. Every loop is cancelled on unmount:
 * an animation left spinning on a driver's phone is battery nobody agreed to
 * spend.
 */
const ChatRecordingIndicator = () => {
  const reduceMotion = useReducedMotion();
  const colors = useThemeColors();

  const first = useSharedValue(0);
  const second = useSharedValue(0);
  const third = useSharedValue(0);
  const fourth = useSharedValue(0);

  // The microphone itself, breathing on the same cycle as the meter.
  const pulse = useSharedValue(0);

  const bars = [first, second, third, fourth];

  useEffect(() => {
    if (reduceMotion) return;

    const wave = () =>
      withRepeat(
        withSequence(
          withTiming(1, { duration: CYCLE_MS / 2 }),
          withTiming(0, { duration: CYCLE_MS / 2 }),
        ),
        -1,
        false,
      );

    bars.forEach((bar, index) => {
      bar.value = withDelay(index * STAGGER_MS, wave());
    });

    pulse.value = wave();

    return () => {
      [...bars, pulse].forEach((value) => {
        cancelAnimation(value);
        value.value = 0;
      });
    };
    // The shared values are stable for the component's life; only the
    // accessibility setting can require rebuilding the loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const micStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1, transform: [{ scale: 1 }] };

    return {
      opacity: 0.7 + pulse.value * 0.3,
      transform: [{ scale: 0.94 + pulse.value * 0.12 }],
    };
  }, [reduceMotion]);

  return (
    <View
      className="w-full items-start px-4 pb-1.5"
      accessibilityRole="text"
      accessibilityLabel={chatPresenceHintAccessibilityLabel("recording")}
      accessibilityLiveRegion="polite"
    >
      <View
        className="flex-row items-center gap-2 rounded-2xl rounded-bl-md
        border border-border bg-card px-3.5 py-3"
      >
        <Animated.View style={micStyle}>
          <Ionicons name="mic" size={16} color={colors.destructive} />
        </Animated.View>

        <View className="flex-row items-center gap-1">
          {BAR_INDEXES.map((index) => (
            <LevelBar
              key={index}
              progress={bars[index]}
              staticScale={STATIC_SCALES[index]}
              reduceMotion={reduceMotion}
              color={colors.destructive}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

export { ChatRecordingIndicator };
