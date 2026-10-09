import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every runtime dependency earns its place (MOB-27).
 *
 * The app is Android-only, yet it carried react-native-web (nothing imports
 * it; three Expo packages list it only as an OPTIONAL peer) and a direct
 * @react-navigation/elements nobody imports (the navigators bring their own).
 * A dependency is kept when the app imports it, when app.json runs it as a
 * config plugin, or for a reason written below that this test re-checks: if
 * the reason stops holding, the dependency can go.
 */
const ROOT = resolve(__dirname, "..", "..");
const json = (path: string) => JSON.parse(fs.readFileSync(join(ROOT, path), "utf8"));

/** `peer` must list the dependency as a REQUIRED peer (npm would install it anyway). */
const requiredPeerOf = (peer: string, dependency: string) => {
  const manifest = json(`node_modules/${peer}/package.json`);
  return (
    Boolean(manifest.peerDependencies?.[dependency]) &&
    manifest.peerDependenciesMeta?.[dependency]?.optional !== true
  );
};

const KEPT_WITHOUT_IMPORT: Record<string, { why: string; holds: () => boolean }> = {
  "expo-asset": {
    // expo-doctor refuses a native peer that is not declared directly, and
    // CI runs expo-doctor before every EAS build.
    why: "required peer of expo-audio (the chat's voice notes)",
    holds: () => requiredPeerOf("expo-audio", "expo-asset"),
  },
  "expo-linking": {
    why: "required peer of expo-router",
    holds: () => requiredPeerOf("expo-router", "expo-linking"),
  },
  "react-native-screens": {
    why: "required peer of expo-router",
    holds: () => requiredPeerOf("expo-router", "react-native-screens"),
  },
  "react-native-webview": {
    why: "required peer of react-native-signature-canvas",
    holds: () => requiredPeerOf("react-native-signature-canvas", "react-native-webview"),
  },
  "react-native-worklets": {
    why: "required peer of react-native-reanimated 4",
    holds: () => requiredPeerOf("react-native-reanimated", "react-native-worklets"),
  },
  "react-dom": {
    // Web-only code, never in the Android bundle; declaring it pins the
    // version Expo SDK 54 expects instead of whatever npm picks for vaul.
    why: "required peer of vaul, which expo-router depends on",
    holds: () =>
      Boolean(json("node_modules/expo-router/package.json").dependencies?.vaul) &&
      requiredPeerOf("vaul", "react-dom"),
  },
  "expo-dev-client": {
    why: "the launcher of the development build profile",
    holds: () => json("eas.json").build?.development?.developmentClient === true,
  },
};

function sourceText(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js)$/.test(entry.name)) files.push(path);
    }
  };
  ["app", "components", "features", "hooks", "providers", "schemas", "store", "types", "utils"]
    .filter((dir) => fs.existsSync(join(ROOT, dir)))
    .forEach(walk);

  const configs = ["app.config.js", "babel.config.js", "metro.config.js", "tailwind.config.js"].filter((file) =>
    fs.existsSync(join(ROOT, file)),
  );

  return [...files, ...configs].map((file) => fs.readFileSync(join(ROOT, file), "utf8")).join("\n");
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

describe("the runtime dependencies", () => {
  const dependencies = Object.keys(json("package.json").dependencies);
  const plugins = (json("app.json").expo.plugins as (string | [string, unknown])[]).map((plugin) =>
    Array.isArray(plugin) ? plugin[0] : plugin,
  );
  const source = sourceText();

  const imported = (name: string) =>
    new RegExp(`(?:from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)["']${escape(name)}(?:/[^"']*)?["']`).test(
      source,
    );

  it("are each imported, run as a config plugin or kept for a stated reason", () => {
    const unexplained = dependencies.filter(
      (name) => !imported(name) && !plugins.includes(name) && !(name in KEPT_WITHOUT_IMPORT),
    );

    expect(unexplained).toEqual([]);
  });

  it("keep their stated reason true", () => {
    const stale = Object.entries(KEPT_WITHOUT_IMPORT)
      .filter(([name, { holds }]) => !dependencies.includes(name) || imported(name) || !holds())
      .map(([name, { why }]) => `${name}: ${why}`);

    expect(stale).toEqual([]);
  });
});
