import { describe, expect, it } from "vitest";

import { palette } from "../../utils/theme-tokens";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_OPTIONS,
  navigationColors,
  parseThemePreference,
  resolveColorScheme,
  segmentedThumbMotion,
  statusBarStyleFor,
  themeColors,
  toastColors,
} from "../../utils/theme-rules";

describe("theme preference", () => {
  it("defaults to following the system", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
  });

  it("offers Claro, Escuro and Sistema, in that order", () => {
    expect(THEME_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      ["light", "Claro"],
      ["dark", "Escuro"],
      ["system", "Sistema"],
    ]);
  });

  it("parses a stored value and falls back to system on anything unknown", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");

    for (const junk of [undefined, null, "", "DARK", "auto", 1, {}]) {
      expect(parseThemePreference(junk)).toBe("system");
    }
  });
});

describe("the painted scheme", () => {
  it("is the picked one whatever the phone says", () => {
    expect(resolveColorScheme("dark", "light")).toBe("dark");
    expect(resolveColorScheme("light", "dark")).toBe("light");
  });

  it("follows the phone under system, light when the phone has no answer", () => {
    expect(resolveColorScheme("system", "dark")).toBe("dark");
    expect(resolveColorScheme("system", "light")).toBe("light");
    expect(resolveColorScheme("system", null)).toBe("light");
    expect(resolveColorScheme("system", undefined)).toBe("light");
  });
});

describe("chrome that follows the scheme", () => {
  it("puts dark status bar icons on light and light icons on dark", () => {
    expect(statusBarStyleFor("light")).toBe("dark");
    expect(statusBarStyleFor("dark")).toBe("light");
  });

  it("gives React Navigation the page background, so no white card flashes in dark", () => {
    expect(navigationColors("dark").background).toBe(palette.dark.background);
    expect(navigationColors("light").background).toBe(palette.light.background);
    expect(navigationColors("dark").text).toBe(palette.dark.ink);
  });

  it("hands colour props the palette of the scheme on screen", () => {
    expect(themeColors("dark")).toBe(palette.dark);
    expect(themeColors("light")).toBe(palette.light);
  });

  it("paints toasts on the themed card instead of the library's white", () => {
    const dark = toastColors("dark", "error");

    expect(dark.background).toBe(palette.dark.card);
    expect(dark.title).toBe(palette.dark.ink);
    expect(dark.accent).toBe(palette.dark.destructive);
    expect(toastColors("light", "success").accent).toBe(palette.light.success);
    expect(toastColors("light", "info").accent).toBe(palette.light.primary);
  });
});

describe("the segmented control's thumb", () => {
  it("jumps, without sliding, on the first measured layout", () => {
    // The drawer unmounts its content on close: every opening is a first
    // layout, and sliding there crossed from "Claro" to "Sistema" each time.
    expect(segmentedThumbMotion(null, { index: 2, segmentWidth: 100 })).toBe("snap");
  });

  it("does nothing before the track is measured", () => {
    expect(segmentedThumbMotion(null, { index: 2, segmentWidth: 0 })).toBe("none");
  });

  it("slides when the driver picks another option on the same track", () => {
    expect(segmentedThumbMotion({ index: 2, segmentWidth: 100 }, { index: 0, segmentWidth: 100 })).toBe(
      "animate",
    );
  });

  it("jumps when the track's width changes (rotation, resize)", () => {
    expect(segmentedThumbMotion({ index: 1, segmentWidth: 100 }, { index: 1, segmentWidth: 180 })).toBe("snap");
    expect(segmentedThumbMotion({ index: 1, segmentWidth: 100 }, { index: 2, segmentWidth: 180 })).toBe("snap");
  });

  it("does nothing when neither the option nor the width changed", () => {
    expect(segmentedThumbMotion({ index: 1, segmentWidth: 100 }, { index: 1, segmentWidth: 100 })).toBe("none");
  });
});
