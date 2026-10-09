import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { palette } from "../../utils/theme-tokens";

/**
 * The fleet, chat, notification and pending-submission screens speak only in
 * theme tokens (docs/arquitetura.md, theme section), like the shared components already do.
 *
 * The ways a screen stays light-only in the dark theme, each guarded here:
 * a numbered palette class or a hex colour (a white card under white ink), a
 * class NativeWind silently compiles to nothing (a token typo paints no
 * colour at all), a `<Text>` with no colour, which Android draws black,
 * invisible on the dark background, and a token pair under 4.5:1 in either
 * theme.
 */
const ROOT = resolve(__dirname, "..", "..");
const load = createRequire(join(ROOT, "package.json"));
const read = (file: string) => fs.readFileSync(join(ROOT, file), "utf8");

function tsxUnder(dir: string): string[] {
  return fs
    .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => `${dir}/${file.split("\\").join("/")}`);
}

const SCREENS = [
  "app/(protected)/(tabs)/chat.tsx",
  "app/(protected)/(tabs)/vehicles.tsx",
  "app/(protected)/checklist.tsx",
  "app/(protected)/fuel.tsx",
  "app/(protected)/notifications.tsx",
  "app/(protected)/pending-submissions.tsx",
  "components/screens/ai-precheck/precheck-notice.tsx",
  ...tsxUnder("components/screens/chat"),
  ...tsxUnder("components/screens/checklist"),
  ...tsxUnder("components/screens/fuel"),
  ...tsxUnder("components/screens/vehicles"),
  ...tsxUnder("components/shared"),
  "components/vehicle-card.tsx",
];

/**
 * The photo viewer is black in both themes, like every gallery: its white
 * controls and black backdrop are the design, not the light theme baked in.
 */
const FIXED_DARK_SURFACES = new Set(["components/screens/chat/chat-media-viewer.tsx"]);

const PALETTE_CLASS =
  /(?<![\w-])(?:bg|text|border|from|to|via)-(?:white|black(?!\/)|(?:gray|slate|zinc|neutral|stone|blue|sky|indigo|violet|purple|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal|cyan|primary|danger|success|warning)-\d{2,3})(?![\w-])/g;
const HEX = /["'](#[0-9a-fA-F]{3,8})["']/g;
const RGBA = /["']rgba?\(/g;
// `color="white"` is a hex in disguise: React Native takes CSS colour names.
const NAMED = /(?:[cC]olor|backgroundColor)\s*[=:]\s*\{?\s*["'](?:white|black|red|blue|green|gray|grey)["']/g;

describe("the fleet, chat and notification screens", () => {
  it("cover the files this rule is about", () => {
    expect(SCREENS.length).toBeGreaterThanOrEqual(30);
    for (const file of SCREENS) expect(fs.existsSync(join(ROOT, file)), file).toBe(true);
  });

  it("use no light-only palette class (bg-black/50 backdrops excepted)", () => {
    const offenders = SCREENS.filter((file) => !FIXED_DARK_SURFACES.has(file)).flatMap((file) =>
      [...read(file).matchAll(PALETTE_CLASS)].map((match) => `${file}: ${match[0]}`),
    );

    expect(offenders).toEqual([]);
  });

  it("hard-code no colour value outside shadows and the fixed-dark viewer", () => {
    const offenders = SCREENS.filter((file) => !FIXED_DARK_SURFACES.has(file)).flatMap((file) =>
      read(file)
        .split("\n")
        .filter((line) => !/shadowColor/.test(line))
        .flatMap((line) => [...line.matchAll(HEX), ...line.matchAll(RGBA), ...line.matchAll(NAMED)].map((match) => `${file}: ${match[0]}`)),
    );

    expect(offenders).toEqual([]);
  });

  it("never fake a gradient NativeWind cannot draw, nor leave the status bar on auto", () => {
    const offenders = SCREENS.filter((file) =>
      /bg-gradient-to-|(?<![\w-])(?:from|via|to)-[a-z]+-\d|style="auto"/.test(read(file)),
    );

    expect(offenders).toEqual([]);
  });
});

/** Every string literal in a file, where class names live (incl. ternaries and maps). */
function stringLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    if (ts.isTemplateExpression(node)) {
      out.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const COLOUR_CLASS = /^(?:bg|text|border(?:-[trblxy])?)-(?!(?:xs|sm|base|lg|xl|\dxl|center|left|right|justify|\d|\[)|opacity)[a-z]+(?:-[a-z0-9]+)*(?:\/\d+)?$/;

/** Colour classes in use: bg-*, text-* and border-* that name a colour, not a size. */
function colourClasses(): string[] {
  const names = new Set<string>();
  for (const file of SCREENS) {
    for (const literal of stringLiterals(file)) {
      for (const name of literal.split(/\s+/)) {
        const bare = name.replace(/^(?:dark|active|disabled|focus):/, "");
        if (COLOUR_CLASS.test(bare) && !/^border(?:-[trblxy])?$/.test(bare)) names.add(bare);
      }
    }
  }
  return [...names].filter((name) => !/^(?:text|bg|border)-(?:transparent)$/.test(name));
}

describe("the NativeWind build of those screens' colour classes", () => {
  let rules: Map<string, unknown>;
  let used: string[];

  beforeAll(async () => {
    used = colourClasses();
    const previousOs = process.env.NATIVEWIND_OS;
    process.env.NATIVEWIND_OS = "android";

    try {
      const postcss = load("postcss");
      const tailwind = load("tailwindcss");
      const loadConfig = load("tailwindcss/loadConfig");
      const { cssToReactNativeRuntime } = load("react-native-css-interop/css-to-rn");

      const config = loadConfig(join(ROOT, "tailwind.config.js"));
      const css = await postcss([
        tailwind({ ...config, content: [{ raw: used.join(" "), extension: "html" }] }),
      ]).process(read("global.css"), { from: undefined });

      const compiled = cssToReactNativeRuntime(css.css, {
        ignorePropertyWarningRegex: ["^--tw-"],
        grouping: ["^group(/.*)?"],
      });
      rules = compiled.rules instanceof Map ? compiled.rules : new Map(Object.entries(compiled.rules));
    } finally {
      if (previousOs === undefined) delete process.env.NATIVEWIND_OS;
      else process.env.NATIVEWIND_OS = previousOs;
    }
  }, 60_000);

  it("compiles every colour class those screens use (a typo paints nothing)", () => {
    expect(used.length).toBeGreaterThanOrEqual(25);
    expect(used.filter((name) => !rules.has(name))).toEqual([]);
  });
});

const TEXT_COLOUR = /(?<![\w-])text-(?!(?:xs|sm|base|lg|xl|\dxl|center|left|right|justify)(?![\w-]))[a-z]+(?:-[a-z0-9]+)*(?:\/\d+)?(?![\w-])/;

/**
 * `<Text>` elements that pick no colour and have no `<Text>` parent to
 * inherit one from (an emoji alone excepted, docs/arquitetura.md, theme section, rule 3). A colour can come from the className (any branch of a
 * ternary or a lookup counts) or from `style`.
 */
function uncolouredTexts(file: string): string[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];

  const hasColour = (attributes: ts.JsxAttributes): boolean =>
    attributes.properties.some((attribute) => {
      if (ts.isJsxSpreadAttribute(attribute)) return true;
      const name = attribute.name.getText(source);
      const value = attribute.initializer?.getText(source) ?? "";
      if (name === "style") return /color/i.test(value) || /Style\b|style\b/.test(value);
      if (name !== "className") return false;
      if (TEXT_COLOUR.test(value)) return true;
      // A class built elsewhere (a lookup or a helper) is checked by the palette rules.
      return /\{[^}]*\b(?:[a-zA-Z]+(?:\.|\[)|[a-zA-Z]+\()/.test(value) && !/^"/.test(value);
    });

  // An emoji draws its own colours: a Text holding only one needs none.
  const onlyEmoji = (node: ts.Node): boolean =>
    ts.isJsxElement(node) &&
    node.children.length > 0 &&
    node.children.every((child) => ts.isJsxText(child) && !/[\p{L}\p{N}]/u.test(child.text));

  const visit = (node: ts.Node, insideText: boolean) => {
    let inside = insideText;
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined;
    if (opening && opening.tagName.getText(source) === "Text") {
      if (!insideText && !hasColour(opening.attributes) && !onlyEmoji(node)) {
        const { line } = source.getLineAndCharacterOfPosition(opening.getStart(source));
        offenders.push(`${file}:${line + 1}`);
      }
      inside = true;
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  return offenders;
}

describe("text on those screens", () => {
  it("always has a colour (Android draws an uncoloured Text black, unreadable in dark)", () => {
    expect(SCREENS.flatMap(uncolouredTexts)).toEqual([]);
  });
});

type Token = keyof (typeof palette)["light"];

/** `text-ink-soft` → `inkSoft`; undefined when it is not a colour token. */
function tokenOf(name: string): Token | undefined {
  const camel = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return camel in palette.light ? (camel as Token) : undefined;
}

// Filled surfaces (`bg-primary` paints `primarySurface`) are read with the
// white `*-foreground` text; every other background with the readable tokens.
const FILLED = new Set(["primary", "destructive", "success", "warning", "deliveries", "fleet"]);

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("contrast on those screens", () => {
  it("reads at 4.5:1 in both themes: every text token on every background the file uses", () => {
    const failures: string[] = [];

    for (const file of SCREENS.filter((name) => !FIXED_DARK_SURFACES.has(name))) {
      const source = read(file);
      const texts = new Set(
        [...source.matchAll(/(?<![\w-])text-([a-z]+(?:-[a-z]+)*)(?![\w/-])/g)]
          .map((match) => match[1])
          .filter((name) => tokenOf(name) !== undefined),
      );
      const backgrounds = new Set(
        [...source.matchAll(/(?<![\w-])bg-([a-z]+(?:-[a-z]+)*)(?![\w/-])/g)]
          .map((match) => match[1])
          // `bg-border` and `bg-muted` are tracks and dots, never behind text.
          .filter((name) => name !== "border" && name !== "muted" && (FILLED.has(name) || tokenOf(name) !== undefined)),
      );
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
