import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { cssVariableName, hexToChannels, palette } from "../../utils/theme-tokens";

/**
 * The colour tokens, end to end: the palette reads in both themes (WCAG AA),
 * and NativeWind really compiles it into variables that flip with the scheme.
 *
 * The second half runs the same pipeline Metro does (Tailwind with the
 * NativeWind preset for Android, then react-native-css-interop's compiler)
 * on global.css, so a broken selector or a class that silently resolves to
 * nothing fails here instead of on a driver's phone.
 */
const ROOT = resolve(__dirname, "..", "..");
const load = createRequire(join(ROOT, "package.json"));

type Scheme = keyof typeof palette;
type Token = keyof (typeof palette)["light"];

const SCHEMES: Scheme[] = ["light", "dark"];
const MIN_TEXT_CONTRAST = 4.5;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const SURFACES: Token[] = ["background", "surface", "card", "subtle"];
const TEXT_TOKENS: Token[] = [
  "ink",
  "inkSoft",
  "muted",
  "primary",
  "destructive",
  "success",
  "warning",
  "deliveries",
  "fleet",
];
const ACCENTS = ["primary", "destructive", "success", "warning", "deliveries", "fleet"] as const;

describe("the palette", () => {
  it("defines the same tokens in light and dark", () => {
    expect(Object.keys(palette.dark).sort()).toEqual(Object.keys(palette.light).sort());
  });

  it("uses six-digit hex everywhere (the CSS variables are built from it)", () => {
    for (const scheme of SCHEMES) {
      for (const [token, hex] of Object.entries(palette[scheme])) {
        expect(hex, `${scheme}.${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  for (const scheme of SCHEMES) {
    it(`reads at 4.5:1 for every text token on every surface (${scheme})`, () => {
      const colors = palette[scheme];

      for (const text of TEXT_TOKENS) {
        for (const surface of SURFACES) {
          expect(contrast(colors[text], colors[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(
            MIN_TEXT_CONTRAST,
          );
        }
      }
    });

    it(`keeps white text readable on every filled surface and accents readable on their soft tint (${scheme})`, () => {
      const colors = palette[scheme];

      for (const accent of ACCENTS) {
        expect(
          contrast(colors[`${accent}Surface`], "#ffffff"),
          `white on ${accent}Surface`,
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        expect(contrast(colors[accent], colors[`${accent}Soft`]), `${accent} on ${accent}Soft`).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        );
      }

      for (const accent of ["primary", "destructive", "success", "warning"] as const) {
        expect(colors[`${accent}Foreground`]).toBe("#ffffff");
      }
    });
  }

  it("is a real dark theme: dark surfaces under light ink", () => {
    for (const surface of SURFACES) {
      expect(luminance(palette.dark[surface])).toBeLessThan(0.05);
      expect(luminance(palette.light[surface])).toBeGreaterThan(0.85);
    }
    expect(luminance(palette.dark.ink)).toBeGreaterThan(0.9);
  });
});

interface CompiledStyles {
  rootVariables: Record<string, { light?: unknown; dark?: unknown }>;
  flags: Record<string, string>;
  rules: Map<string, unknown> | Record<string, unknown>;
}

// One class per token and kind, plus the legacy shades that must survive.
const PROBE_CLASSES = [
  "bg-background",
  "bg-surface",
  "bg-card",
  "bg-subtle",
  "text-ink",
  "text-ink-soft",
  "text-muted",
  "border-border",
  "border-input",
  "bg-input",
  "bg-border",
  ...ACCENTS.flatMap((accent) => [`bg-${accent}`, `text-${accent}`, `bg-${accent}-soft`, `border-${accent}`]),
  ...["primary", "destructive", "success", "warning"].map((accent) => `text-${accent}-foreground`),
  "bg-card/80",
  "bg-primary-600",
  "text-success-700",
];

describe("the NativeWind build of the tokens", () => {
  let compiled: CompiledStyles;
  let rules: Map<string, unknown>;

  beforeAll(async () => {
    const previousOs = process.env.NATIVEWIND_OS;
    process.env.NATIVEWIND_OS = "android";

    try {
      const postcss = load("postcss");
      const tailwind = load("tailwindcss");
      const loadConfig = load("tailwindcss/loadConfig");
      const { cssToReactNativeRuntime } = load("react-native-css-interop/css-to-rn");

      const config = loadConfig(join(ROOT, "tailwind.config.js"));
      const source = fs.readFileSync(join(ROOT, "global.css"), "utf8");
      const css = await postcss([
        tailwind({ ...config, content: [{ raw: PROBE_CLASSES.join(" "), extension: "html" }] }),
      ]).process(source, { from: undefined });

      compiled = cssToReactNativeRuntime(css.css, {
        ignorePropertyWarningRegex: ["^--tw-"],
        grouping: ["^group(/.*)?"],
      });
      rules = compiled.rules instanceof Map ? compiled.rules : new Map(Object.entries(compiled.rules));
    } finally {
      if (previousOs === undefined) delete process.env.NATIVEWIND_OS;
      else process.env.NATIVEWIND_OS = previousOs;
    }
  }, 60_000);

  it("runs in class mode, the only one colorScheme.set accepts", () => {
    expect(compiled.flags.darkMode).toBe("class dark");
  });

  it("compiles every probed class (none silently resolves to nothing)", () => {
    const missing = PROBE_CLASSES.filter((name) => !rules.has(name));
    expect(missing).toEqual([]);
  });

  it("carries a light and a dark value for every token, equal to the palette", () => {
    const used = Object.keys(compiled.rootVariables);
    expect(used.length).toBeGreaterThanOrEqual(20);

    for (const token of Object.keys(palette.light) as Token[]) {
      const variable = compiled.rootVariables[cssVariableName(token)];
      if (!variable) continue; // Only variables a probed class reads are emitted.

      const asChannels = (value: unknown) => (value as number[]).join(" ");
      expect(asChannels(variable.light), `${token} light`).toBe(hexToChannels(palette.light[token]));
      expect(asChannels(variable.dark), `${token} dark`).toBe(hexToChannels(palette.dark[token]));
    }

    for (const token of ["background", "card", "ink", "muted", "primary", "primarySurface"] as Token[]) {
      expect(compiled.rootVariables[cssVariableName(token)], token).toBeDefined();
    }
  });

  it("paints bg-X with the deep surface and text-X with the readable colour", () => {
    const variableOf = (name: string) => JSON.stringify(rules.get(name)).match(/--color-[a-z-]+/)?.[0];

    for (const accent of ACCENTS) {
      expect(variableOf(`bg-${accent}`), `bg-${accent}`).toBe(`--color-${accent}-surface`);
      expect(variableOf(`text-${accent}`), `text-${accent}`).toBe(`--color-${accent}`);
      expect(variableOf(`bg-${accent}-soft`), `bg-${accent}-soft`).toBe(`--color-${accent}-soft`);
    }
    expect(variableOf("text-ink-soft")).toBe("--color-ink-soft");
  });
});
