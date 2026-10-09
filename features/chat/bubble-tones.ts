import { palette } from "../../utils/theme-tokens";
import type { ThemeColors } from "../../utils/theme-rules";

/**
 * The colours drawn ON a chat bubble, for the props that take a value
 * (icons, the voice-note player) instead of a class.
 *
 * The driver's own bubble is the brand-blue surface in both themes
 * (`primarySurface`), so what sits on it is white in both themes too, dimmed
 * for the secondary bits. The operation's bubble is a themed card, so its
 * tones are the theme's own. Read and delivered stay apart the WhatsApp way:
 * on the blue bubble by brightness (full white is read), on the card by
 * colour (primary is read).
 */
export interface BubbleTones {
  /** Body text and the player's icons. */
  tint: string;
  /** Clock, "Aviso em massa", the player's time line. */
  meta: string;
  /** Pending, sent and delivered checks. */
  check: string;
  /** The read double check. */
  checkRead: string;
  /** The voice note's unplayed bars. */
  track: string;
  /** The voice note's played bars and knob. */
  fill: string;
  /** A broken voice note. */
  danger: string;
  /** Round play button and speed pill. */
  buttonBackground: string;
}

/** `#2563eb` + 0.5 → `rgba(37, 99, 235, 0.5)`: a token, dimmed. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * How bright the secondary text on the blue bubble is. 0.95 (the class `text-primary-foreground/95`) keeps the
 * clock at 4.5:1 on the brand blue (tests/unitaires/chat-bubble-tones.test.ts);
 * the old blue-100 measured 4.2:1 there.
 */
export const OWN_BUBBLE_META_ALPHA = 0.95;

export function bubbleTones(colors: ThemeColors, onOwnBubble: boolean): BubbleTones {
  if (onOwnBubble) {
    const white = colors.primaryForeground;

    return {
      tint: white,
      meta: withAlpha(white, OWN_BUBBLE_META_ALPHA),
      check: withAlpha(white, 0.7),
      checkRead: white,
      track: withAlpha(white, 0.35),
      fill: white,
      // The blue bubble does not change with the theme, so neither does the
      // red that reads on it: the light theme's pale tint, never the dark
      // theme's deep one.
      danger: palette.light.destructiveSoft,
      buttonBackground: withAlpha(white, 0.2),
    };
  }

  return {
    tint: colors.inkSoft,
    meta: colors.muted,
    check: colors.muted,
    checkRead: colors.primary,
    track: colors.input,
    fill: colors.primary,
    danger: colors.destructive,
    buttonBackground: colors.subtle,
  };
}
