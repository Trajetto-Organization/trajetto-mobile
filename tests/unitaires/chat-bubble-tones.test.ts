import { describe, expect, it } from "vitest";

import { bubbleTones, withAlpha } from "../../features/chat/bubble-tones";
import { palette } from "../../utils/theme-tokens";

/**
 * What the chat draws on a bubble, measured in both themes on the surface it
 * really sits on: the brand blue (`bg-primary`) for the driver's own messages,
 * the card for the operation's.
 */
type Rgb = [number, number, number];

function parse(color: string): { rgb: Rgb; alpha: number } {
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  const hex = color.replace("#", "");
  return { rgb: [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb, alpha: 1 };
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast of `color` (maybe translucent) composited over a solid `surface`. */
function contrastOver(color: string, surface: string): number {
  const { rgb, alpha } = parse(color);
  const below = parse(surface).rgb;
  const shown = rgb.map((channel, index) => Math.round(channel * alpha + below[index] * (1 - alpha))) as Rgb;
  const [light, dark] = [luminance(shown), luminance(below)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const SCHEMES = ["light", "dark"] as const;

describe("withAlpha", () => {
  it("dims a token without hard-coding a colour", () => {
    expect(withAlpha("#2563eb", 0.5)).toBe("rgba(37, 99, 235, 0.5)");
    expect(withAlpha("#ffffff", 0.85)).toBe("rgba(255, 255, 255, 0.85)");
  });
});

describe.each(SCHEMES)("the driver's own (blue) bubble in the %s theme", (scheme) => {
  const colors = palette[scheme];
  const tones = bubbleTones(colors, true);
  const surface = colors.primarySurface;

  it("keeps the body, the clock and the error text at 4.5:1 on the brand blue", () => {
    expect(contrastOver(tones.tint, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOver(tones.meta, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOver(tones.danger, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the checks and the played bars visible (3:1, non-text)", () => {
    expect(contrastOver(tones.check, surface)).toBeGreaterThanOrEqual(3);
    expect(contrastOver(tones.fill, surface)).toBeGreaterThanOrEqual(3);
  });

  it("tells read from delivered by brightness", () => {
    expect(contrastOver(tones.checkRead, surface)).toBeGreaterThan(contrastOver(tones.check, surface));
  });

  it("is the same in both themes, because the bubble is", () => {
    expect(tones).toEqual(bubbleTones(palette[scheme === "light" ? "dark" : "light"], true));
  });
});

describe.each(SCHEMES)("the operation's (card) bubble in the %s theme", (scheme) => {
  const colors = palette[scheme];
  const tones = bubbleTones(colors, false);

  it("reads at 4.5:1 on the card", () => {
    for (const tone of [tones.tint, tones.meta, tones.danger, tones.checkRead]) {
      expect(contrastOver(tone, colors.card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("follows the theme: dark tones are light ink, light tones dark ink", () => {
    const ink = luminance(parse(tones.tint).rgb);
    if (scheme === "dark") expect(ink).toBeGreaterThan(0.5);
    else expect(ink).toBeLessThan(0.1);
  });

  it("tells read from delivered by colour", () => {
    expect(tones.checkRead).not.toBe(tones.check);
  });
});
