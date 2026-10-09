import { useEffect } from "react";
import { View } from "react-native";

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

/** One full round trip of the wave, rest included. */
const CYCLE_MS = 1400;

/** Half a bounce: up in LIFT_MS, back down in LIFT_MS. */
const LIFT_MS = 220;

/** What separates one dot from the next — the wave, not a blink. */
const STAGGER_MS = 160;

const DOT_INDEXES = [0, 1, 2];

const DOT_SIZE = 7;
const DOT_TRAVEL = 5;

/**
 * The opacities the dots hold still at when the device asks for less motion.
 * Different on purpose: three identical dots read as a decoration, three
 * fading ones still read as "someone is typing".
 */
const STATIC_OPACITIES = [1, 0.7, 0.45];

interface TypingDotProps {
  progress: SharedValue<number>;
  staticOpacity: number;
  reduceMotion: boolean;
  color: string;
}

const TypingDot = ({
  progress,
  staticOpacity,
  reduceMotion,
  color,
}: TypingDotProps) => {
  const style = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: staticOpacity, transform: [{ translateY: 0 }] };
    }

    return {
      opacity: 0.4 + progress.value * 0.6,
      transform: [{ translateY: -DOT_TRAVEL * progress.value }],
    };
  }, [reduceMotion, staticOpacity]);

  return (
    <Animated.View
      style={[
        {
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
};

/**
 * The WhatsApp-shaped "digitando" bubble, on the operation's side of the
 * conversation. The header line stays where it is — this is the in-thread
 * counterpart of it, anchored at the end of the list.
 *
 * Every dot runs the same CYCLE_MS loop and differs only by its start delay,
 * which is what keeps the wave in phase instead of drifting apart over a
 * conversation that stays open for an hour. The loops are cancelled on
 * unmount: an animation left spinning on a driver's phone is battery nobody
 * agreed to spend.
 */
const ChatTypingIndicator = () => {
  const reduceMotion = useReducedMotion();
  const colors = useThemeColors();

  const first = useSharedValue(0);
  const second = useSharedValue(0);
  const third = useSharedValue(0);

  const dots = [first, second, third];

  useEffect(() => {
    if (reduceMotion) return;

    dots.forEach((dot, index) => {
      dot.value = withDelay(
        index * STAGGER_MS,
        withRepeat(
          withSequence(
            withTiming(1, { duration: LIFT_MS }),
            withTiming(0, { duration: LIFT_MS }),
            // The rest of the cycle, spent on the ground. Written as a delay
            // so all three loops last exactly CYCLE_MS whatever their offset.
            withDelay(
              CYCLE_MS - 2 * LIFT_MS,
              withTiming(0, { duration: 0 }),
            ),
          ),
          -1,
          false,
        ),
      );
    });

    return () => {
      dots.forEach((dot) => {
        cancelAnimation(dot);
        dot.value = 0;
      });
    };
    // The shared values are stable for the component's life; only the
    // accessibility setting can require rebuilding the loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <View
      className="w-full items-start px-4 pb-1.5"
      accessibilityRole="text"
      accessibilityLabel={chatPresenceHintAccessibilityLabel("typing")}
      accessibilityLiveRegion="polite"
    >
      <View
        className="flex-row items-center gap-1.5 rounded-2xl rounded-bl-md
        border border-border bg-card px-3.5 py-3"
      >
        {DOT_INDEXES.map((index) => (
          <TypingDot
            key={index}
            progress={dots[index]}
            staticOpacity={STATIC_OPACITIES[index]}
            reduceMotion={reduceMotion}
            color={colors.muted}
          />
        ))}
      </View>
    </View>
  );
};

export { ChatTypingIndicator };
