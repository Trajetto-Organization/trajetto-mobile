/**
 * The app's semantic colour tokens, light and dark — the single source.
 *
 * CommonJS on purpose: tailwind.config.js (Node, no TypeScript) turns these
 * into the `--color-*` CSS variables NativeWind swaps per scheme, and the app
 * imports the same object for the few props that take a colour value instead
 * of a class (icons, placeholders, bottom sheets, ActivityIndicator). One file,
 * so the class and the prop can never drift apart.
 *
 * Neutrals mirror the web app (trajetto-ui globals.css, logged-in palette);
 * the brand blue stays the app's #2563eb, and the module accents are the
 * site's (Entregas pink, Frotas violet). Every pair a screen uses is measured
 * against WCAG AA in tests/unitaires/theme-tokens.test.ts — change a value
 * and that test says whether it still reads in the sun.
 *
 * The rule the split encodes (docs/arquitetura.md, theme section):
 * - `X` is the readable colour: text, icons and borders on background/card.
 * - `XSurface` fills a control behind `XForeground` (white) text. In the dark
 *   theme the readable colour is lighter and the surface stays deep, because
 *   one colour cannot do both jobs there.
 * - `XSoft` is a tinted background for a chip or a banner, read with `X`.
 */

/** @typedef {"light" | "dark"} ColorSchemeName */

const light = {
  background: "#f8f9fc",
  surface: "#ffffff",
  card: "#ffffff",
  subtle: "#f1f5f9",
  ink: "#020817",
  inkSoft: "#334155",
  muted: "#506795",
  border: "#e2e8f0",
  input: "#cbd5e1",

  primary: "#2563eb",
  primarySurface: "#2563eb",
  primaryForeground: "#ffffff",
  primarySoft: "#eff6ff",

  destructive: "#c81e1e",
  destructiveSurface: "#c81e1e",
  destructiveForeground: "#ffffff",
  destructiveSoft: "#fef2f2",

  success: "#15803d",
  successSurface: "#15803d",
  successForeground: "#ffffff",
  successSoft: "#f0fdf4",

  warning: "#b45309",
  warningSurface: "#b45309",
  warningForeground: "#ffffff",
  warningSoft: "#fffbeb",

  deliveries: "#d81b60",
  deliveriesSurface: "#d81b60",
  deliveriesSoft: "#fdf2f6",

  fleet: "#6a3fe0",
  fleetSurface: "#6a3fe0",
  fleetSoft: "#f4f0fe",
};

/** @type {typeof light} */
const dark = {
  background: "#0f1624",
  surface: "#131b2a",
  card: "#171f31",
  subtle: "#1e293b",
  ink: "#f8fafc",
  inkSoft: "#cbd5e1",
  muted: "#94a3b8",
  // A step lighter than the web's #1e293b: hairlines sit on the card here,
  // and at the web's value they disappeared on it.
  border: "#273449",
  input: "#334155",

  primary: "#60a5fa",
  primarySurface: "#2563eb",
  primaryForeground: "#ffffff",
  primarySoft: "#172554",

  // A hair lighter than the web's #f15b5b, to stay 4.5:1 on `subtle` too.
  destructive: "#f36868",
  destructiveSurface: "#ce2222",
  destructiveForeground: "#ffffff",
  destructiveSoft: "#3b1219",

  success: "#4ade80",
  successSurface: "#15803d",
  successForeground: "#ffffff",
  successSoft: "#0d2b1c",

  warning: "#fbbf24",
  warningSurface: "#b45309",
  warningForeground: "#ffffff",
  warningSoft: "#33210a",

  deliveries: "#f36398",
  deliveriesSurface: "#d81b60",
  deliveriesSoft: "#3a1426",

  fleet: "#9b7dff",
  fleetSurface: "#6a3fe0",
  fleetSoft: "#251a4a",
};

const palette = { light, dark };

/** `inkSoft` → `--color-ink-soft`: the CSS variable behind a token. */
function cssVariableName(token) {
  return `--color-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** `#2563eb` → `37 99 235`, the form `rgb(var(--x) / <alpha-value>)` needs. */
function hexToChannels(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).join(" ");
}

/** Every token of one scheme as CSS variables, for `:root` / `.dark:root`. */
function cssVariables(scheme) {
  return Object.fromEntries(
    Object.entries(palette[scheme]).map(([token, hex]) => [cssVariableName(token), hexToChannels(hex)]),
  );
}

module.exports = { palette, cssVariableName, hexToChannels, cssVariables };
