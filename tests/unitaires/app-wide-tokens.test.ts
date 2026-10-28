import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every screen and component in the app speaks in theme tokens, not only the
 * ones a per-package list names (docs/arquitetura.md, theme section).
 *
 * The token suites (driver screens, fleet and chat, shared UI) each guard the
 * files they list. A MASTER's company selection was in none of them and kept
 * its white cards and gray ink while the header, drawer and modals around it
 * switched to dark: half the screen followed the theme. This sweep has no
 * list to forget: a new file is covered the day it is created, and a literal
 * colour that stays has to say why here.
 */
const ROOT = resolve(__dirname, "..", "..");

function tsxUnder(dir: string): string[] {
  return fs
    .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `${dir}/${file.split("\\").join("/")}`);
}

const ALL_FILES = [
  ...tsxUnder("app"),
  ...tsxUnder("components"),
  ...tsxUnder("providers"),
];

/** Files whose colours are the same in both themes by design, and why. */
const FIXED_SURFACES: Record<string, string> = {
  "components/screens/chat/chat-media-viewer.tsx":
    "the photo viewer is black in both themes, like every gallery",
  "components/animated-splash-screen.tsx":
    "the splash is brand blue in both themes (decision 16.304)",
};

/** A literal colour that stays on purpose in an otherwise themed file, and why. */
const ALLOWED: { file: string; value: string; reason: string }[] = [
  {
    file: "components/screens/deliveries/signature-pad.tsx",
    value: "#ffffff",
    reason:
      "the pad is white paper in both themes: the saved PNG is the proof read on white",
  },
  {
    file: "components/screens/deliveries/signature-pad.tsx",
    value: "#111827",
    reason: "the pen is dark ink on that paper, in both themes",
  },
  {
    file: "app/(protected)/delivery-proof.tsx",
    value: "bg-white",
    reason: "the signature preview keeps its white paper behind the dark ink",
  },
  {
    file: "components/ui/skeleton-card.tsx",
    value: "rgba(",
    reason:
      "the shimmer highlight, one value per scheme picked by useColorSchemeName",
  },
];

// `bg-black/50` and other translucent blacks are backdrops and image scrims,
// dark in both themes (rule 10); a solid black or any numbered shade is not.
const PALETTE_CLASS =
  /(?<![\w-])(?:bg|text|border|from|to|via|placeholder|divide|ring)-(?:white|black(?!\/)|(?:gray|slate|zinc|neutral|stone|blue|sky|indigo|violet|purple|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal|cyan|primary|danger|success|warning)-\d{2,3})(?![\w-])/g;
const HEX = /["'](#[0-9a-fA-F]{3,8})["']/g;
const RGBA = /["'](rgba?\()/g;
// `color="white"` is a hex in disguise: React Native takes CSS colour names.
const NAMED =
  /\b(?:[cC]olor|backgroundColor|borderColor|tintColor)\s*[=:]\s*\{?\s*["'](?:white|black|red|blue|green|gray|grey)["']/g;

const read = (file: string) => fs.readFileSync(join(ROOT, file), "utf8");
const themed = ALL_FILES.filter((file) => !(file in FIXED_SURFACES));
const isAllowed = (file: string, value: string) =>
  ALLOWED.some((entry) => entry.file === file && entry.value === value);

describe("the whole app's colours", () => {
  it("sweep every screen and component, and every exception still exists", () => {
    expect(ALL_FILES.length).toBeGreaterThanOrEqual(95);
    expect(ALL_FILES).toContain("app/(protected)/select-business.tsx");
    expect(ALL_FILES).toContain("components/business-card.tsx");

    for (const file of Object.keys(FIXED_SURFACES))
      expect(fs.existsSync(join(ROOT, file)), file).toBe(true);
    for (const entry of ALLOWED) {
      expect(
        read(entry.file).includes(entry.value),
        `${entry.file}: ${entry.value} (stale allow-list)`,
      ).toBe(true);
    }
  });

  it("use no light-only palette class outside the fixed surfaces", () => {
    const offenders = themed.flatMap((file) =>
      [...read(file).matchAll(PALETTE_CLASS)]
        .map((match) => match[0])
        .filter((value) => !isAllowed(file, value))
        .map((value) => `${file}: ${value}`),
    );

    expect(offenders).toEqual([]);
  });

  it("hard-code no colour value outside shadows, the fixed surfaces and the allow-list", () => {
    const offenders = themed.flatMap((file) =>
      read(file)
        .split("\n")
        // Shadows are black in both themes, and Android ignores their colour anyway.
        .filter((line) => !/shadowColor/.test(line))
        .flatMap((line) => [
          ...[...line.matchAll(HEX)].map((match) => match[1]),
          ...[...line.matchAll(RGBA)].map((match) => match[1]),
          ...[...line.matchAll(NAMED)].map((match) => match[0]),
        ])
        .filter((value) => !isAllowed(file, value))
        .map((value) => `${file}: ${value}`),
    );

    expect(offenders).toEqual([]);
  });

  it("never fake a gradient NativeWind cannot draw (it paints nothing on native)", () => {
    expect(themed.filter((file) => /bg-gradient-to-/.test(read(file)))).toEqual(
      [],
    );
  });
});
