import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View, type LayoutChangeEvent } from "react-native";

interface BannerCollapseProps {
  visible: boolean;
  children: ReactNode;
}

/**
 * Shows and hides a banner by animating its real height to zero, so whatever
 * sits below it slides up to take its place instead of being left behind a
 * blank gap. Opacity alone cannot do this: an invisible view still occupies
 * layout.
 *
 * The content is measured from an absolutely-positioned child, never from
 * inside the animated container — a child measured while its parent's height
 * is mid-animation can report a clipped value, which then becomes the ceiling
 * that clips the text for good. Absolute positioning frees the child to lay
 * out at its natural size no matter what the container is doing.
 *
 * Height is a layout property, which rules out the native driver — but these
 * are thin strips and a 200ms tween is imperceptible on the JS thread.
 */
const BannerCollapse = ({ visible, children }: BannerCollapseProps) => {
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,

      // Slower on the way in than on the way out: arriving gently reads as
      // information, while lingering on the way out reads as a bug.
      duration: visible ? 260 : 200,
      useNativeDriver: false,
    }).start();
  }, [visible, progress]);

  const onLayout = (event: LayoutChangeEvent) => {
    // Rounded up so a fractional measurement never clips the last pixel row.
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (height > 0 && height !== contentHeight) setContentHeight(height);
  };

  return (
    <Animated.View
      // A collapsed strip must never swallow taps along the top of the screen.
      pointerEvents={visible ? "box-none" : "none"}
      style={{
        overflow: "hidden",
        opacity: progress,
        height: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, contentHeight],
        }),
      }}
    >
      <View
        style={{ position: "absolute", left: 0, right: 0, top: 0 }}
        onLayout={onLayout}
      >
        {children}
      </View>
    </Animated.View>
  );
};

export { BannerCollapse };
