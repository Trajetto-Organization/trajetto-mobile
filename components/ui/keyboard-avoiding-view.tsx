import { useEffect, useState, type ComponentProps } from "react";
import { Keyboard, KeyboardAvoidingView as NativeKeyboardAvoidingView } from "react-native";

type KeyboardAvoidingViewProps = ComponentProps<typeof NativeKeyboardAvoidingView>;

/** Whether the soft keyboard is up, from React Native's own show/hide events. */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return visible;
}

/**
 * React Native's KeyboardAvoidingView, active only while the keyboard is up.
 *
 * Found on the emulator: after the keyboard closed, every form kept a ~48dp
 * band under its footer. With edge-to-edge, Android's keyboardDidHide reports
 * the keyboard top at the visible frame's height, which excludes the status
 * and navigation bars, so the view keeps that much bottom padding until the
 * next keyboard event. Disabled, it renders no padding at all.
 */
export function KeyboardAvoidingView({ enabled = true, ...props }: KeyboardAvoidingViewProps) {
  const keyboardVisible = useKeyboardVisible();

  return <NativeKeyboardAvoidingView {...props} enabled={enabled && keyboardVisible} />;
}
