import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Light, dark or the system's, picked by the driver (decision 16, 08/10/2026).
 *
 * MOB-16 forced light because the app had no dark palette and let Android
 * flip it half-way: status bar icons turned white over white screens and
 * native dialogs went dark. The app now has both palettes, so the native
 * side follows the same choice the token classes do, and nothing reads the
 * system scheme behind the driver's back.
 */
const ROOT = resolve(__dirname, "..", "..");
const read = (path: string) => fs.readFileSync(join(ROOT, path), "utf8");

function sources(dir: string): { path: string; text: string }[] {
  return fs
    .readdirSync(join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sources(path);
      return /\.tsx$/.test(entry.name)
        ? [{ path, text: fs.readFileSync(join(ROOT, path), "utf8") }]
        : [];
    });
}

const ALL_SOURCES = () => [
  ...sources("app"),
  ...sources("components"),
  ...sources("providers"),
];

describe("the app theme", () => {
  it("lets the native side follow the scheme (userInterfaceStyle automatic)", () => {
    // expo-system-ui turns this into AppCompat's MODE_NIGHT_FOLLOW_SYSTEM;
    // React Native's Appearance.setColorScheme overrides it from the store.
    // "light" would pin the native night mode and the date picker with it.
    const { expo } = JSON.parse(read("app.json"));

    expect(expo.userInterfaceStyle).toBe("automatic");
    expect(expo.android?.userInterfaceStyle ?? "automatic").toBe("automatic");
  });

  it("compiles Tailwind in class mode, which NativeWind's colorScheme.set requires", () => {
    expect(read("tailwind.config.js")).toMatch(/darkMode:\s*"class"/);
  });

  it("never lets an expo-status-bar StatusBar read the system scheme", () => {
    // Its default style is "auto", which reads Android's scheme, not the
    // driver's choice: every one says what it sits on, or asks the theme.
    const bars = ALL_SOURCES()
      .filter(({ text }) => /from\s+["']expo-status-bar["']/.test(text))
      .flatMap(({ path, text }) =>
        [...text.matchAll(/<StatusBar\b[^>]*>/g)].map((match) => ({
          path,
          tag: match[0],
        })),
      );

    expect(bars.length).toBeGreaterThan(0);
    expect(
      bars.filter(
        ({ tag }) =>
          !/style=(["'](dark|light)["']|\{statusBarStyleFor\()/.test(tag),
      ),
    ).toEqual([]);
  });

  it("drives the root status bar from the theme", () => {
    expect(read("providers/theme-provider.tsx")).toMatch(
      /<StatusBar style=\{statusBarStyleFor\(scheme\)\} \/>/,
    );
  });

  it("never paints a status bar background edge-to-edge ignores", () => {
    // With edgeToEdgeEnabled the app draws under the status bar; React
    // Native's `backgroundColor` does nothing there but warn in development.
    const painted = ALL_SOURCES().flatMap(({ path, text }) =>
      [...text.matchAll(/<StatusBar\b[^>]*>/g)]
        .filter((match) => /backgroundColor=/.test(match[0]))
        .map((match) => `${path}: ${match[0]}`),
    );

    expect(painted).toEqual([]);
  });

  it("themes the navigation card and the root view, not only the token classes", () => {
    const provider = read("providers/theme-provider.tsx");

    // React Navigation paints a card behind every screen; expo-system-ui
    // paints the root view Android shows while a screen lays out.
    expect(provider).toMatch(
      /<NavigationThemeProvider value=\{navigationTheme\}>/,
    );
    expect(provider).toMatch(
      /SystemUI\.setBackgroundColorAsync\(themeColors\(scheme\)\.background\)/,
    );
  });

  it("holds the native splash until the saved theme is read", () => {
    const layout = read("app/_layout.tsx");

    expect(layout).toMatch(/useThemeStore\(\(state\) => state\.hydrated\)/);
    expect(layout).toMatch(/const ready = fontsLoaded && themeHydrated;/);
    expect(layout).toMatch(/if \(ready\) void SplashScreen\.hideAsync\(\)/);
    expect(layout).toMatch(/<ThemeProvider>/);
  });

  it("offers Claro, Escuro and Sistema in the settings drawer", () => {
    const drawer = read("components/ui/user-settings-drawer.tsx");

    expect(drawer).toMatch(/<ThemeSelector\b/);
    expect(read("components/ui/theme-selector.tsx")).toMatch(
      /options=\{OPTIONS\}/,
    );
  });

  it("lets the settings drawer scroll, so logout is reachable on a 640dp phone", () => {
    // Profile + e-mail + theme + web + logout + legal is ~680dp; 80% of a
    // 640dp window is 512dp. A non-scrolling body clipped "Sair da Conta".
    const drawer = read("components/ui/user-settings-drawer.tsx");
    const sheet = read("components/ui/sheet.tsx");

    // A fixed snap point handed to the shared sheet, which then scrolls the
    // body instead of sizing the sheet to it.
    expect(drawer).toMatch(/const SNAP_POINTS = \["80%"\];/);
    expect(drawer).toMatch(/snapPoints=\{SNAP_POINTS\}/);
    expect(drawer).toMatch(/scrollTestID="user-settings-scroll"/);
    expect(sheet).toMatch(/\{scrolls \? \(\s*<BottomSheetScrollView\b/);
    // Dynamic sizing measures the scroll view, not its content: off, so the
    // fixed snap point and the scroll are the whole contract.
    expect(sheet).toMatch(/const scrolls = snapPoints !== undefined;/);
    expect(sheet).toMatch(/enableDynamicSizing=\{!scrolls\}/);
  });

  it("decides the selector thumb's motion through the tested rule", () => {
    const control = read("components/ui/segmented-control.tsx");

    expect(control).toMatch(/segmentedThumbMotion\(previous\.current, next\)/);
  });

  it("mounts the selector thumb already at its place, with no update needed to show it", () => {
    // Found on the emulator: hidden until an effect raised its opacity, the
    // thumb never showed on the drawer's first opening after a cold start.
    const control = read("components/ui/segmented-control.tsx");

    expect(control).toMatch(
      /segmentWidth > 0 && \(\s*<SegmentedThumb index=\{index\} segmentWidth=\{segmentWidth\} \/>/,
    );
    expect(control).toMatch(/useSharedValue\(index \* segmentWidth\)/);
    expect(control).not.toMatch(/opacity:/);
  });

  it("re-applies the saved theme whenever a new Activity mounts the tree", () => {
    // expo-system-ui resets AppCompat's night mode in every Activity onCreate;
    // the JS runtime (and the store's once-only apply) outlives the Activity.
    const provider = read("providers/theme-provider.tsx");

    expect(provider).toMatch(
      /useEffect\(\(\) => \{\s*useThemeStore\.getState\(\)\.reapply\(\);\s*\}, \[\]\)/,
    );
  });

  it("keeps uiMode in the Activity's configChanges, so a switch never recreates it", () => {
    const plugins = JSON.parse(read("app.json")).expo.plugins;

    expect(plugins).toContain("./plugins/with-ui-mode-config-change");
  });
});

describe("the uiMode config plugin", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    withUiModeConfigChange,
  } = require("../../plugins/with-ui-mode-config-change");

  const manifest = (configChanges?: string) => ({
    manifest: {
      application: [
        {
          activity: [
            { $: { "android:name": ".SomeOtherActivity" } },
            {
              $: {
                "android:name": ".MainActivity",
                ...(configChanges === undefined
                  ? {}
                  : { "android:configChanges": configChanges }),
              },
            },
          ],
        },
      ],
    },
  });

  const main = (result: ReturnType<typeof manifest>) =>
    result.manifest.application[0].activity[1].$ as Record<string, string>;

  it("adds uiMode when the template leaves it out", () => {
    const result = withUiModeConfigChange(
      manifest("keyboard|orientation|screenSize"),
    );

    expect(main(result)["android:configChanges"]).toBe(
      "keyboard|orientation|screenSize|uiMode",
    );
  });

  it("adds it when the attribute is missing altogether", () => {
    expect(
      main(withUiModeConfigChange(manifest()))["android:configChanges"],
    ).toBe("uiMode");
  });

  it("does not duplicate it when it is already there", () => {
    const result = withUiModeConfigChange(
      manifest("keyboard|uiMode|orientation"),
    );

    expect(main(result)["android:configChanges"]).toBe(
      "keyboard|uiMode|orientation",
    );
  });

  it("leaves other activities alone", () => {
    const result = withUiModeConfigChange(manifest("keyboard"));

    expect(result.manifest.application[0].activity[0].$).toEqual({
      "android:name": ".SomeOtherActivity",
    });
  });
});
