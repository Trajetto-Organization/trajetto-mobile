import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { palette as themePalette } from "../../utils/theme-tokens";

/**
 * Text the driver has to read in the sun, measured against WCAG 1.4.3.
 *
 * Two kinds of colour live in the source while the screens convert to the
 * theme tokens (docs/arquitetura.md, theme section). A numbered palette class (`text-red-700`) is
 * light-only and measured on the light backgrounds, resolved through the
 * Tailwind palette NativeWind compiles from, so a shade change is measured,
 * not trusted. A semantic token (`text-destructive`) changes with the
 * scheme, so it is measured in BOTH themes on every surface it can sit on.
 */
const ROOT = resolve(__dirname, "..", "..");
const load = createRequire(join(ROOT, "package.json"));
const palette = load("tailwindcss/colors") as Record<string, Record<string, string> | string>;

// Normal-size text (text-xs / text-sm / text-base), WCAG AA.
const MIN_TEXT_CONTRAST = 4.5;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join("") : value;

  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** `white/90` over a solid background, composited the way the screen does. */
function over(color: Rgb, alpha: number, background: Rgb): Rgb {
  return color.map((channel, index) =>
    Math.round(channel * alpha + background[index] * (1 - alpha)),
  ) as Rgb;
}

/** `amber-700`, `white`, `white/90` → colour and opacity. */
function resolveClass(token: string): { rgb: Rgb; alpha: number } {
  const [name, opacity] = token.split("/");
  const alpha = opacity ? Number(opacity) / 100 : 1;

  if (name === "white") return { rgb: [255, 255, 255], alpha };
  if (name === "black") return { rgb: [0, 0, 0], alpha };

  const match = /^([a-z]+)-(\d{2,3})$/.exec(name);
  const scale = match ? palette[match[1]] : undefined;
  const hex = typeof scale === "object" ? scale[match![2]] : undefined;

  if (!hex) throw new Error(`unknown colour class: ${token}`);
  return { rgb: hexToRgb(hex), alpha };
}

const read = (file: string) => fs.readFileSync(join(ROOT, file), "utf8");

type ThemeToken = keyof (typeof themePalette)["light"];

/** `text-destructive` / `text-ink-soft` → its theme token; anything else → undefined. */
function semanticTextToken(className: string): ThemeToken | undefined {
  if (!className.startsWith("text-")) return undefined;

  const name = className
    .slice("text-".length)
    .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

  return name in themePalette.light ? (name as ThemeToken) : undefined;
}

// Where a semantic text colour can sit (docs/arquitetura.md, theme section).
const TOKEN_SURFACES: ThemeToken[] = ["background", "surface", "card", "subtle"];

/** A token's worst contrast over those surfaces, light and dark. */
function worstTokenContrast(token: ThemeToken): { ratio: number; where: string } {
  let worst = { ratio: Infinity, where: "" };

  for (const scheme of ["light", "dark"] as const) {
    for (const surface of TOKEN_SURFACES) {
      const ratio = contrast(hexToRgb(themePalette[scheme][token]), hexToRgb(themePalette[scheme][surface]));
      if (ratio < worst.ratio) worst = { ratio, where: `${scheme} ${surface}` };
    }
  }

  return worst;
}

/** `bg-warning` → the token it paints (`warningSurface`), per tailwind.config.js. */
function semanticBackgroundToken(name: string): ThemeToken | undefined {
  const surface = `${name}Surface`;
  if (surface in themePalette.light) return surface as ThemeToken;
  return name in themePalette.light ? (name as ThemeToken) : undefined;
}

/** `text-warning-foreground/90` → token and opacity. */
function semanticTextWithAlpha(className: string): { token: ThemeToken; alpha: number } | undefined {
  const [name, opacity] = className.split("/");
  const token = semanticTextToken(name);
  return token ? { token, alpha: opacity ? Number(opacity) / 100 : 1 } : undefined;
}

describe.each([
  ["the offline banner", "components/offline-banner.tsx"],
  ["the outbox banner", "components/outbox-banner.tsx"],
])("%s", (_, file) => {
  it("is readable: every text colour on each of its backgrounds reaches 4.5:1 in both themes", () => {
    const source = read(file);

    const backgrounds = [...source.matchAll(/(?<![\w-])bg-([a-z]+)(?![\w-])/g)]
      .map((match) => match[1])
      .map((name) => ({ name, token: semanticBackgroundToken(name) }));
    const texts = [...source.matchAll(/(?<![\w-])(text-[a-z]+(?:-[a-z]+)*(?:\/\d+)?)(?![\w-])/g)]
      .map((match) => ({ name: match[1], parsed: semanticTextWithAlpha(match[1]) }))
      .filter((text) => !/^text-(xs|sm|base|lg|xl|center)$/.test(text.name));

    expect(backgrounds.length).toBeGreaterThanOrEqual(1);
    expect(texts.length).toBeGreaterThanOrEqual(2);

    // A numbered or raw class here is the light theme baked in (docs/arquitetura.md, theme section).
    for (const background of backgrounds) expect(background.token, `bg-${background.name}`).toBeDefined();
    for (const text of texts) expect(text.parsed, text.name).toBeDefined();

    for (const scheme of ["light", "dark"] as const) {
      for (const background of backgrounds) {
        const surface = hexToRgb(themePalette[scheme][background.token!]);

        for (const { name, parsed } of texts) {
          const color = over(hexToRgb(themePalette[scheme][parsed!.token]), parsed!.alpha, surface);

          expect(contrast(color, surface), `${name} on bg-${background.name} (${scheme})`).toBeGreaterThanOrEqual(
            MIN_TEXT_CONTRAST,
          );
        }
      }
    }
  });
});

/** Every .tsx under app/ and components/, relative to the app root. */
function screenFiles(): string[] {
  return ["app", "components"].flatMap((dir) =>
    fs
      .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => join(dir, file)),
  );
}

describe("the required mark", () => {
  /**
   * `Nome *` (decision 3.3): the asterisk is the only thing that says a
   * field is required, and in text-red-500 it measured 3.6:1 on the forms'
   * gray-50 — below AA, for a driver reading in the sun.
   */
  it("reaches 4.5:1 on the forms' backgrounds, in both themes once tokenized", () => {
    const marks = screenFiles().flatMap((file) =>
      [...read(file).matchAll(/<Text className="([^"]*)">\s*\*\s*<\/Text>/g)].map((match) => ({
        file,
        shade: /\btext-([a-z]+-\d{2,3})\b/.exec(match[1])?.[1],
        token: match[1]
          .split(/\s+/)
          .map(semanticTextToken)
          .find((token) => token !== undefined),
      })),
    );

    // Proof, occurrence and fuel screens, the location picker and the shared
    // Input, Select, DatePicker and checklist photo fields.
    expect(marks.length).toBeGreaterThanOrEqual(8);

    for (const { file, shade, token } of marks) {
      expect(shade ?? token, `${file}: asterisco sem cor`).toBeDefined();

      if (token) {
        const { ratio, where } = worstTokenContrast(token);
        expect(ratio, `${token} on ${where} in ${file}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        continue;
      }

      for (const background of ["white", "gray-50"]) {
        const ratio = contrast(resolveClass(shade!).rgb, resolveClass(background).rgb);

        expect(ratio, `text-${shade} on bg-${background} in ${file}`).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        );
      }
    }
  });

  // Red only once the photo is actually missing (decision 16.700), never for "required" alone.
  it("reads the missing-photo message on the checklist's red photo button (bg-destructive-soft), in both themes", () => {
    const source = read("components/screens/checklist/checklist-photo-section.tsx");
    const tokens = [
      /<Text className="text-xs (text-[a-z-]+) mt-1">\{error\}<\/Text>/.exec(source)?.[1],
      /isInvalid \? "(text-[a-z-]+)" : "text-muted"/.exec(source)?.[1],
    ];

    expect(source).toMatch(/isInvalid \? "border-destructive\/40 bg-destructive-soft"/);

    for (const className of tokens) {
      expect(className, "cor do texto do botão obrigatório").toBeDefined();

      const token = semanticTextToken(className!);
      expect(token, `${className} é token do tema`).toBeDefined();

      for (const scheme of ["light", "dark"] as const) {
        const ratio = contrast(
          hexToRgb(themePalette[scheme][token!]),
          hexToRgb(themePalette[scheme].destructiveSoft),
        );

        expect(ratio, `${className} on bg-destructive-soft (${scheme})`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    }
  });
});

describe("placeholders in text fields", () => {
  it("reach 4.5:1 on the field, in both themes when they come from a token", () => {
    const files = ["app", "components"].flatMap((dir) =>
      fs
        .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".tsx"))
        .map((file) => join(dir, file)),
    );

    // placeholderTextColor="#6b7280" at a light-only call site, and the
    // token form: `placeholderTextColor={colors.muted}`, or the Input's own
    // default `placeholderTextColor ?? colors.muted`.
    const colours = files.flatMap((file) =>
      [...read(file).matchAll(/placeholderTextColor\s*=\s*\{?\s*"(#[0-9a-fA-F]{3,6})"/g)].map(
        (match) => ({ file, colour: match[1] }),
      ),
    );
    const tokens = files.flatMap((file) =>
      [...read(file).matchAll(/placeholderTextColor(?:\s*=\s*\{|\s*\?\?)\s*colors\.([a-zA-Z]+)/g)].map(
        (match) => ({ file, token: match[1] }),
      ),
    );

    expect(colours.length + tokens.length).toBeGreaterThanOrEqual(4);

    for (const { file, colour } of colours) {
      const ratio = contrast(hexToRgb(colour), [255, 255, 255]);
      expect(ratio, `${colour} in ${file}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }

    for (const { file, token } of tokens) {
      expect(token in themePalette.light, `${token} in ${file}`).toBe(true);

      const { ratio, where } = worstTokenContrast(token as ThemeToken);
      expect(ratio, `${token} on ${where} in ${file}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });
});
