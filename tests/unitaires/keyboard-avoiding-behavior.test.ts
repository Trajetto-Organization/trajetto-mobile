import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every screen avoids the keyboard with `behavior="padding"` (MOB-17).
 *
 * The convention was `behavior="height"`, and on a device it did nothing: the
 * Maestro chat flow (08) typed with the composer still under the keyboard
 * (bounds unchanged with the keyboard up). Every one of these views is
 * `flex-1`, and a flex-1 child ignores the height the component sets, so the
 * view never shrank. Padding shrinks the content inside the same box, which
 * a flex-1 view honours — the composer then sat right above the keyboard.
 *
 * The screens cannot be laid out in this runner; this reads every one of
 * them so the broken behaviour does not come back on a new screen.
 */
const ROOT = resolve(__dirname, "..", "..");

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });

const views = ["app", "components"].flatMap(sourceFiles).flatMap((file) => {
  const source = fs.readFileSync(join(ROOT, file), "utf8");
  return [...source.matchAll(/<KeyboardAvoidingView\b[^>]*>/g)].map((match) => ({
    at: file,
    tag: match[0],
  }));
});

describe("keyboard avoidance", () => {
  it("is found on the screens with fields", () => {
    // login, forgot-password, two-factor, chat, checklist, fuel, proof,
    // occurrence and the pause control at the time of writing.
    expect(views.length).toBeGreaterThanOrEqual(9);
  });

  it("always shrinks the content with padding, never a height a flex view ignores", () => {
    const wrong = views
      .filter(({ tag }) => !/behavior=(\{\s*)?"padding"/.test(tag))
      .map(({ at, tag }) => `${at}: ${tag}`);

    expect(wrong).toEqual([]);
  });

  // Found on the emulator: with edge-to-edge, Android's keyboardDidHide puts
  // the keyboard top at the visible frame's height (system bars excluded), so
  // React Native's view kept ~48dp of padding under every form's footer once
  // the keyboard closed. The shared wrapper is on only while it is up.
  it("goes through the shared wrapper, never React Native's view directly", () => {
    const direct = ["app", "components"]
      .flatMap(sourceFiles)
      .filter((file) => file !== "components/ui/keyboard-avoiding-view.tsx")
      .filter((file) => {
        const source = fs.readFileSync(join(ROOT, file), "utf8");
        const nativeImport = source.match(/import \{[^}]*\} from "react-native";/g) ?? [];
        return nativeImport.some((block) => /KeyboardAvoidingView/.test(block));
      });

    expect(direct).toEqual([]);
    for (const { at } of views) {
      expect(fs.readFileSync(join(ROOT, at), "utf8"), at).toMatch(
        /import \{ KeyboardAvoidingView \} from "[./]+(components\/)?ui\/keyboard-avoiding-view";/,
      );
    }
  });

  it("enables React Native's view only while the keyboard is visible", () => {
    const wrapper = fs.readFileSync(join(ROOT, "components/ui/keyboard-avoiding-view.tsx"), "utf8");

    expect(wrapper).toMatch(/enabled=\{enabled && keyboardVisible\}/);
    expect(wrapper).toMatch(/addListener\("keyboardDidHide", \(\) => setVisible\(false\)\)/);
    expect(wrapper).toMatch(/addListener\("keyboardDidShow", \(\) => setVisible\(true\)\)/);
  });
});
