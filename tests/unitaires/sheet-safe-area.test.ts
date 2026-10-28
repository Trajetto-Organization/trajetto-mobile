import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SHEET_BOTTOM_GAP, sheetBottomPadding } from "../../utils/sheet-layout";

/**
 * Found on the phone: fully expanded, the photo sheet of Abastecimento,
 * Checklist and the chat left "Cancelar" touching Android's navigation bar,
 * and the chat's "Sobre o quê?" list ended behind it. Each sheet sized and
 * padded itself; the app draws edge-to-edge, so the sheet runs down behind
 * the bar and up behind the status bar unless told otherwise.
 *
 * One shared sheet (components/ui/sheet.tsx) now owns the safe area for
 * every expansion state: its body clears the navigation bar by a fixed gap,
 * and the sheet never rises behind the status bar.
 */
const ROOT = resolve(__dirname, "..", "..");
const read = (path: string) => fs.readFileSync(join(ROOT, path), "utf8");

const SHEET = "components/ui/sheet.tsx";

const SHEET_USERS = [
  "components/ui/image-picker-bottom-sheet.tsx",
  "components/ui/user-settings-drawer.tsx",
  "components/screens/chat/ticket-picker-sheet.tsx",
];

describe("a sheet's bottom padding", () => {
  it("is only the gap on a phone without a navigation bar (no excess space)", () => {
    expect(sheetBottomPadding(0)).toBe(SHEET_BOTTOM_GAP);
    expect(SHEET_BOTTOM_GAP).toBeGreaterThanOrEqual(12);
    expect(SHEET_BOTTOM_GAP).toBeLessThanOrEqual(24);
  });

  it("clears a three-button bar by the same gap instead of touching it", () => {
    // The old Math.max(48, 16) gave 48: the button's edge on the bar's edge.
    expect(sheetBottomPadding(48)).toBe(48 + SHEET_BOTTOM_GAP);
  });

  it("clears the gesture bar too", () => {
    expect(sheetBottomPadding(24)).toBe(24 + SHEET_BOTTOM_GAP);
  });

  it("never pads less than the gap, whatever the reported inset", () => {
    expect(sheetBottomPadding(-8)).toBe(SHEET_BOTTOM_GAP);
  });
});

describe("the shared sheet", () => {
  const source = () => read(SHEET);

  it("keeps the sheet below the status bar when fully expanded", () => {
    expect(source()).toMatch(/topInset=\{insets\.top\}/);
  });

  it("pads both bodies, fixed and content-sized, from the bottom inset", () => {
    const sheet = source();

    expect(sheet).toMatch(
      /const paddingBottom = sheetBottomPadding\(insets\.bottom\);/,
    );
    expect(sheet).toMatch(
      /<BottomSheetScrollView[^>]*contentContainerStyle=\{\{ paddingBottom \}\}/,
    );
    expect(sheet).toMatch(/<BottomSheetView style=\{\{ paddingBottom \}\}>/);
  });

  it("scrolls a fixed-height body and sizes the other to its content, never cutting it", () => {
    const sheet = source();

    // Rule 14: a body that can outgrow its height scrolls inside fixed snap
    // points; the content-sized one is exactly as tall as its content.
    expect(sheet).toMatch(/const scrolls = snapPoints !== undefined;/);
    expect(sheet).toMatch(/enableDynamicSizing=\{!scrolls\}/);
  });

  it("closes on back, follows the theme and reports the swipe-down", () => {
    const sheet = source();

    expect(sheet).toMatch(/useCloseOnBack\(visible, onClose\);/);
    expect(sheet).toMatch(/backgroundColor: colors\.surface/);
    expect(sheet).toMatch(/backgroundColor: colors\.input/);
    expect(sheet).toMatch(/if \(index === -1\) onClose\(\);/);
  });

  it.each(SHEET_USERS)(
    "is what %s is built on, with no safe area of its own",
    (path) => {
      const sheet = read(path);

      expect(sheet).toMatch(
        /<Sheet\b[^>]*visible=\{visible\}[^>]*onClose=\{onClose\}/s,
      );
      expect(sheet).not.toMatch(/<BottomSheetModal\b/);
      expect(sheet).not.toMatch(/useSafeAreaInsets|paddingBottom/);
    },
  );

  it("is the only BottomSheetModal in the app", () => {
    const files = ["components", "app"].flatMap((dir) =>
      fs
        .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".tsx"))
        .map((file) => `${dir}/${file.split("\\").join("/")}`),
    );

    expect(
      files.filter((file) => /<BottomSheetModal\b/.test(read(file))),
    ).toEqual([SHEET]);
  });
});
