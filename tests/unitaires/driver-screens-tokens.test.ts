import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { palette } from "../../utils/theme-tokens";

/**
 * The driver's screens speak only in theme tokens (docs/arquitetura.md, theme section): sign-in,
 * two-factor, password recovery, the opening screen, the day's deliveries
 * and the stop's detail, proof, occurrence, "a caminho" and pauses.
 *
 * A numbered palette class or a hex colour is the light theme baked in: in
 * the dark theme it becomes a white card under white ink, or dark ink on a
 * dark screen. The few exceptions are listed with the reason they hold.
 */
const ROOT = resolve(__dirname, "..", "..");

function tsxUnder(dir: string): string[] {
  return fs
    .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `${dir}/${file.split("\\").join("/")}`);
}

const DRIVER_SCREENS = [
  "app/index.tsx",
  ...tsxUnder("app/(auth)"),
  "app/(protected)/(tabs)/deliveries.tsx",
  "app/(protected)/delivery-detail.tsx",
  "app/(protected)/delivery-proof.tsx",
  "app/(protected)/delivery-occurrence.tsx",
  ...tsxUnder("components/screens/deliveries"),
  ...tsxUnder("components/screens/occurrences"),
  ...tsxUnder("components/screens/pauses"),
];

/** A literal colour that stays on purpose, and why. */
interface Allowed {
  file: string;
  value: string;
  reason: string;
}

const ALLOWED: Allowed[] = [
  {
    file: "components/screens/deliveries/signature-pad.tsx",
    value: "#ffffff",
    reason: "the pad is white paper in both themes: the saved PNG is the proof read on white",
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
    file: "components/screens/pauses/pause-control.tsx",
    value: "bg-black/50",
    reason: "modal backdrop, dark in both themes (docs/arquitetura.md, theme section, rule 10)",
  },
];

const PALETTE_CLASS =
  /(?<![\w-])(?:bg|text|border|from|to|via|placeholder|divide|ring)-(?:white|black(?:\/\d+)?|(?:gray|slate|zinc|neutral|stone|blue|sky|indigo|violet|purple|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal|cyan|primary|danger|success|warning)-\d{2,3})(?![\w-])/g;

// Shadows are black in both themes, and Android ignores their colour anyway.
const HEX = /["'](#[0-9a-fA-F]{3,8})["']/g;
const NAMED_COLOR_PROP = /\b(?:color|tintColor|backgroundColor|borderColor|focusColor)\s*[=:]\s*\{?\s*["'](?:white|black|gray|red|blue|green)["']/g;

const read = (file: string) => fs.readFileSync(join(ROOT, file), "utf8");

const isAllowed = (file: string, value: string) =>
  ALLOWED.some((entry) => entry.file === file && entry.value === value);

type Token = keyof (typeof palette)["light"];

/** `text-ink-soft` → `inkSoft`; undefined when it is not a colour token. */
function tokenOf(name: string): Token | undefined {
  const camel = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return camel in palette.light ? (camel as Token) : undefined;
}

// Filled surfaces read with white `*-foreground` text (tailwind.config.js
// maps `bg-primary` to `primarySurface`); every other background is read
// with the readable tokens.
const FILLED = new Set(["primary", "destructive", "success", "warning", "deliveries", "fleet"]);

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    const channel = (s: number) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b2);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Every `<Text ...>` opening tag, attributes included (braces balanced). */
function textTags(source: string): string[] {
  const tags: string[] = [];
  const opener = /<Text(?=[\s>])/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source))) {
    let depth = 0;
    let end = match.index;

    for (let at = match.index; at < source.length; at++) {
      const char = source[at];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) {
        end = at;
        break;
      }
    }
    tags.push(source.slice(match.index, end + 1));
  }

  return tags;
}

describe("the driver's screens", () => {
  it("cover the files this rule is about", () => {
    expect(DRIVER_SCREENS.length).toBeGreaterThanOrEqual(15);
    for (const file of DRIVER_SCREENS) expect(fs.existsSync(join(ROOT, file)), file).toBe(true);
    for (const entry of ALLOWED) {
      expect(read(entry.file).includes(entry.value), `${entry.file}: ${entry.value} (stale allow-list)`).toBe(true);
    }
  });

  it("use no light-only palette class", () => {
    const offenders = DRIVER_SCREENS.flatMap((file) =>
      [...read(file).matchAll(PALETTE_CLASS)]
        .map((match) => match[0])
        .filter((value) => !isAllowed(file, value))
        .map((value) => `${file}: ${value}`),
    );

    expect(offenders).toEqual([]);
  });

  it("hard-code no colour value outside shadows and the allow-list", () => {
    const offenders = DRIVER_SCREENS.flatMap((file) =>
      read(file)
        .split("\n")
        .filter((line) => !/shadowColor/.test(line))
        .flatMap((line) => [
          ...[...line.matchAll(HEX)].map((match) => match[1]),
          ...[...line.matchAll(NAMED_COLOR_PROP)].map((match) => match[0]),
        ])
        .filter((value) => !isAllowed(file, value))
        .map((value) => `${file}: ${value}`),
    );

    expect(offenders).toEqual([]);
  });

  it("never fake a gradient NativeWind cannot draw, nor leave the status bar on auto", () => {
    const offenders = DRIVER_SCREENS.filter((file) =>
      /bg-gradient-to-|style="auto"/.test(read(file)),
    );

    expect(offenders).toEqual([]);
  });

  it("give every Text a colour (Android paints an uncoloured Text black, unreadable in dark)", () => {
    const offenders = DRIVER_SCREENS.flatMap((file) =>
      textTags(read(file))
        .filter((tag) => !/(?<![\w-])text-(?!xs|sm|base|lg|xl|[23]xl|center|right|left)[a-z]+(?:-[a-z]+)*/.test(tag))
        .filter((tag) => !/style=\{\{[^}]*\bcolor\s*:/.test(tag))
        // A tone table's text class (`${tone.title}`, `${chip.text}`): its
        // values sit in this file and are measured by the contrast test.
        .filter((tag) => !/\$\{\s*\w+\.(?:text|title)\s*\}/.test(tag))
        .map((tag) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`),
    );

    expect(offenders).toEqual([]);
  });

  it("read at 4.5:1 in both themes: every text token on every background the screen uses", () => {
    const failures: string[] = [];

    for (const file of DRIVER_SCREENS) {
      const source = read(file);
      const texts = new Set(
        [...source.matchAll(/(?<![\w-])text-([a-z]+(?:-[a-z]+)*)(?![\w/-])/g)]
          .map((match) => match[1])
          .filter((name) => tokenOf(name) !== undefined),
      );
      const backgrounds = new Set(
        [...source.matchAll(/(?<![\w-])bg-([a-z]+(?:-[a-z]+)*)(?![\w/-])/g)]
          .map((match) => match[1])
          // `bg-border` is a skeleton or a track, never behind text.
          .filter((name) => name !== "border" && (FILLED.has(name) || tokenOf(name) !== undefined)),
      );

      // The screen's own background is always under it.
      backgrounds.add("background");

      for (const scheme of ["light", "dark"] as const) {
        const colors = palette[scheme];

        for (const text of texts) {
          const isForeground = text.endsWith("-foreground");

          for (const background of backgrounds) {
            const filled = FILLED.has(background);
            if (isForeground !== filled) continue;

            const fg = colors[tokenOf(text)!];
            const bg = colors[(filled ? `${background}Surface` : tokenOf(background)!) as Token];
            const ratio = contrast(fg, bg);

            if (ratio < 4.5) failures.push(`${file}: text-${text} on bg-${background} (${scheme}) ${ratio.toFixed(2)}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
