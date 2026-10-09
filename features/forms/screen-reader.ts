import { AccessibilityInfo } from "react-native";

/**
 * The screen-reader side of bringing a field into view (decision 16.700): a
 * photo area, a select or a Sim/Não gets no keyboard focus, so TalkBack is
 * moved to it and told why. Kept apart so the focus hook stays testable in
 * plain Node.
 */
function moveScreenReaderTo(node: unknown): void {
  try {
    AccessibilityInfo.sendAccessibilityEvent(
      node as Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0],
      "focus",
    );
  } catch {
    // A node already unmounted: the announcement still says what is wrong.
  }
}

function announceToScreenReader(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}

export { announceToScreenReader, moveScreenReaderTo };
