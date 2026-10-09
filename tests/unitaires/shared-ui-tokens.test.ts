import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The shared building blocks speak only in theme tokens (docs/arquitetura.md, theme section).
 *
 * A numbered palette class (`bg-white`, `text-gray-900`, `bg-blue-500`) or
 * a hex colour is the light theme baked in: in the dark theme it becomes a
 * white card under white ink. The screens convert in their own packages;
 * these components are what every screen is built from, so they hold the line.
 */
const ROOT = resolve(__dirname, "..", "..");

function tsxUnder(dir: string): string[] {
  return fs
    .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `${dir}/${file.split("\\").join("/")}`);
}

const SHARED = [
  ...tsxUnder("components/ui"),
  "components/header.tsx",
  "components/notification-bell.tsx",
  "components/legal-links.tsx",
  // App-wide chrome every screen shows. The animated splash is left out on
  // purpose: it is brand blue in both themes (decision 16.304).
  "components/offline-banner.tsx",
  "components/outbox-banner.tsx",
  "components/status-banners.tsx",
  "components/protected-route.tsx",
  "components/upgrade-required-screen.tsx",
  "app/(protected)/(tabs)/_layout.tsx",
  "providers/toast-provider.tsx",
  "providers/theme-provider.tsx",
];

const PALETTE_CLASS =
  /(?<![\w-])(?:bg|text|border|from|to|via)-(?:white|black(?!\/)|(?:gray|slate|zinc|neutral|stone|blue|sky|indigo|violet|purple|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal|cyan|primary|danger|success|warning)-\d{2,3})(?![\w-])/g;

// Shadows are black in both themes, and Android ignores their colour anyway.
const HEX = /["'](#[0-9a-fA-F]{3,8})["']/g;
const ALLOWED_HEX_LINE = /shadowColor/;

describe("the shared UI components", () => {
  it("cover the files this rule is about", () => {
    expect(SHARED.length).toBeGreaterThanOrEqual(25);
    for (const file of SHARED) expect(fs.existsSync(join(ROOT, file)), file).toBe(true);
  });

  it("use no light-only palette class (bg-black/50 backdrops excepted)", () => {
    const offenders = SHARED.flatMap((file) =>
      [...fs.readFileSync(join(ROOT, file), "utf8").matchAll(PALETTE_CLASS)].map(
        (match) => `${file}: ${match[0]}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("hard-code no colour value outside shadows", () => {
    const offenders = SHARED.flatMap((file) =>
      fs
        .readFileSync(join(ROOT, file), "utf8")
        .split("\n")
        .filter((line) => !ALLOWED_HEX_LINE.test(line))
        .flatMap((line) => [...line.matchAll(HEX)].map((match) => `${file}: ${match[1]}`)),
    );

    expect(offenders).toEqual([]);
  });

  it("never fake a gradient NativeWind cannot draw", () => {
    // `bg-gradient-to-*` compiles to nothing on native: the card fell back
    // to transparent and showed whatever was behind it.
    const offenders = SHARED.filter((file) =>
      /bg-gradient-to-/.test(fs.readFileSync(join(ROOT, file), "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
