import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TOAST_LAYOUT,
  TOAST_STATUS_BAR_GAP,
  toastTopOffset,
} from "../../utils/toast-layout";

/**
 * Found on the phone: an error toast's title sat glued to its message
 * ("Erro" right on top of "Credenciais inválidas"). react-native-toast-message's
 * BaseToast is a fixed 60x340 box with a 2px gap under the title and no line
 * height; our larger title and three-line message overflowed it.
 */
const ROOT = resolve(__dirname, "..", "..");
const provider = () =>
  fs.readFileSync(join(ROOT, "providers/toast-provider.tsx"), "utf8");

describe("the toast card's geometry", () => {
  it("grows with its text instead of the library's fixed 60px box", () => {
    expect(TOAST_LAYOUT.card.height).toBe("auto");
    expect(TOAST_LAYOUT.card.minHeight).toBeGreaterThanOrEqual(60);
  });

  it("follows the screen's width (a fixed 340px ran past a 320dp phone), capped on tablets", () => {
    expect(TOAST_LAYOUT.card.width).toMatch(/^\d+%$/);
    expect(Number.parseInt(TOAST_LAYOUT.card.width, 10)).toBeLessThan(100);
    expect(TOAST_LAYOUT.card.maxWidth).toBeGreaterThanOrEqual(340);
  });

  it("keeps a real gap between title and message, and none under a lone title", () => {
    expect(TOAST_LAYOUT.content.gap).toBeGreaterThanOrEqual(4);
    // The library's 2px margin under the title is replaced, not added to.
    expect(TOAST_LAYOUT.title.marginBottom).toBe(0);
  });

  it("gives both lines a line height, so the gap holds at any font scale", () => {
    for (const line of [TOAST_LAYOUT.title, TOAST_LAYOUT.message]) {
      expect(line.lineHeight).toBeGreaterThanOrEqual(
        Math.ceil(line.fontSize * 1.3),
      );
    }
  });

  it("pads the text away from the card's edges on every side", () => {
    expect(TOAST_LAYOUT.content.paddingVertical).toBeGreaterThanOrEqual(10);
    expect(TOAST_LAYOUT.content.paddingHorizontal).toBeGreaterThanOrEqual(12);
  });

  it("rests just below the status bar, whatever its height", () => {
    expect(toastTopOffset(0)).toBe(TOAST_STATUS_BAR_GAP);
    expect(toastTopOffset(24)).toBe(24 + TOAST_STATUS_BAR_GAP);
    expect(toastTopOffset(48)).toBe(48 + TOAST_STATUS_BAR_GAP);
    expect(toastTopOffset(-5)).toBe(TOAST_STATUS_BAR_GAP);
  });
});

describe("the toast provider", () => {
  it("builds success, error and info from the same themed card", () => {
    const source = provider();

    expect(source).toMatch(/success: themedToast\(scheme, "success"\)/);
    expect(source).toMatch(/error: themedToast\(scheme, "error"\)/);
    expect(source).toMatch(/info: themedToast\(scheme, "info"\)/);
  });

  it("applies the layout table to the card, the text column and both lines", () => {
    const source = provider();

    expect(source).toMatch(/style=\{\[\s*TOAST_LAYOUT\.card,/);
    expect(source).toMatch(/contentContainerStyle=\{TOAST_LAYOUT\.content\}/);
    expect(source).toMatch(/text1Style=\{\[TOAST_LAYOUT\.title,/);
    expect(source).toMatch(/text2Style=\{\[TOAST_LAYOUT\.message,/);
    expect(source).toMatch(/text1NumberOfLines=\{TOAST_LAYOUT\.titleLines\}/);
    expect(source).toMatch(/text2NumberOfLines=\{TOAST_LAYOUT\.messageLines\}/);
    // No size of its own left beside the table.
    expect(source).not.toMatch(/fontSize:/);
  });

  it("places the toasts from the safe area, not the library's fixed 40px", () => {
    const source = provider();

    expect(source).toMatch(/useSafeAreaInsets\(\)/);
    expect(source).toMatch(
      /<Toast config=\{config\} topOffset=\{toastTopOffset\(insets\.top\)\} \/>/,
    );
  });
});
