import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What the release APK asks Android for (MOB-01, MOB-14).
 *
 * The manifest is generated (CNG: there is no android/ folder), so the only
 * way to see it before a build is to run the config plugins. This is what
 * `npx expo config --type introspect` does: app.json + app.config.js + every
 * plugin, applied to the prebuild template, in memory. The result is then
 * merged with the manifests the libraries in node_modules ship, following the
 * two markers the app uses (`tools:node="remove"` and `"replace"`), because a
 * library declares its permissions itself: expo-audio brought the
 * media-playback foreground service in, whatever app.json said.
 *
 * Maven AARs (Firebase, media3) are not in node_modules; the remove markers
 * cover them too, but their plain permissions are not listed here.
 */
// Each case runs the config plugins (expo config introspection): about 5 s
// alone, past the 5 s default under the full parallel suite.
vi.setConfig({ testTimeout: 20_000 });

const ROOT = resolve(__dirname, "..", "..");
const load = createRequire(join(ROOT, "package.json"));

const { getPrebuildConfigAsync } = load("@expo/prebuild-config");
const { AndroidConfig, compileModsAsync } = load("expo/config-plugins");

type Attributes = Record<string, string>;
type Element = { $: Attributes };
type Manifest = {
  manifest: {
    $: Attributes;
    "uses-permission"?: Element[];
    application?: { service?: Element[] }[];
  };
};

const NAME = "android:name";
const P = (name: string) => `android.permission.${name}`;

const ENV_KEYS = [
  "EXPO_PUBLIC_BACKGROUND_TRACKING",
  "EAS_BUILD",
  "EAS_BUILD_PROFILE",
  "APP_ENV",
  "GOOGLE_SERVICES_JSON",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** The app's own AndroidManifest.xml, as prebuild would write it. */
async function appManifest({ background }: { background: boolean }): Promise<Manifest> {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.EXPO_PUBLIC_BACKGROUND_TRACKING = background ? "true" : "false";

  const { exp } = await getPrebuildConfigAsync(ROOT, { platforms: ["android"] });
  const compiled = await compileModsAsync(exp, {
    projectRoot: ROOT,
    platforms: ["android"],
    introspect: true,
    assertMissingModProviders: false,
  });

  return compiled._internal.modResults.android.manifest;
}

type Library = { name: string; namespace: string; manifest: Manifest };

/** Every package in node_modules that ships an Android manifest. */
async function libraries(): Promise<Library[]> {
  const modules = join(ROOT, "node_modules");
  const packages = fs.readdirSync(modules).flatMap((entry) =>
    entry.startsWith("@")
      ? fs.readdirSync(join(modules, entry)).map((sub) => `${entry}/${sub}`)
      : [entry],
  );

  const found: Library[] = [];
  for (const name of packages) {
    const path = join(modules, name, "android", "src", "main", "AndroidManifest.xml");
    if (!fs.existsSync(path)) continue;

    const manifest: Manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(path);
    const gradle = ["build.gradle", "build.gradle.kts"]
      .map((file) => join(modules, name, "android", file))
      .find((file) => fs.existsSync(file));
    const declared = gradle
      ? /namespace\s*=?\s*["']([\w.]+)["']/.exec(fs.readFileSync(gradle, "utf8"))?.[1]
      : undefined;

    found.push({ name, namespace: declared ?? manifest.manifest.$.package ?? "", manifest });
  }

  return found;
}

/** A library's `.service.Foo` is `<its namespace>.service.Foo` once merged. */
function qualified(name: string, namespace: string): string {
  if (name.startsWith(".")) return namespace + name;
  return name.includes(".") ? name : `${namespace}.${name}`;
}

/**
 * The permissions and services of the merged manifest. The app manifest has
 * the highest priority: its `remove` drops the element from every library,
 * its `replace` makes its own copy the only one.
 */
function merge(app: Manifest, libs: Library[]) {
  const appPermissions = app.manifest["uses-permission"] ?? [];
  const appServices = app.manifest.application?.[0]?.service ?? [];
  const markerOf = (elements: Element[], name: string) =>
    elements.find((element) => element.$[NAME] === name)?.$["tools:node"];

  const permissions = new Map<string, Attributes>();
  for (const { $ } of appPermissions) {
    if ($["tools:node"] !== "remove") permissions.set($[NAME], $);
  }

  const services = new Map<string, Attributes & { from: string }>();
  for (const { $ } of appServices) {
    if ($["tools:node"] !== "remove") services.set($[NAME], { ...$, from: "app" });
  }

  for (const lib of libs) {
    for (const { $ } of lib.manifest.manifest["uses-permission"] ?? []) {
      const marker = markerOf(appPermissions, $[NAME]);
      if (marker === "remove" || marker === "replace") continue;
      if (!permissions.has($[NAME])) permissions.set($[NAME], $);
    }

    for (const { $ } of lib.manifest.manifest.application?.[0]?.service ?? []) {
      const name = qualified($[NAME], lib.namespace);
      const marker = markerOf(appServices, name);
      if (marker === "remove" || marker === "replace") continue;
      if (!services.has(name)) services.set(name, { ...$, [NAME]: name, from: lib.name });
    }
  }

  return { permissions, services };
}

async function release({ background }: { background: boolean }) {
  const app = await appManifest({ background });
  const libs = await libraries();

  // The merge proves nothing if it never saw what it removes.
  const audio = libs.find((lib) => lib.name === "expo-audio");
  expect(
    (audio?.manifest.manifest.application?.[0]?.service ?? []).map(
      ({ $ }) => $["android:foregroundServiceType"],
    ),
  ).toEqual(expect.arrayContaining(["mediaPlayback", "microphone"]));

  return { app, ...merge(app, libs) };
}

describe("the release manifest, screen-off tracking off (decision 7.3)", () => {
  it("keeps the microphone for the chat's voice notes (MOB-01)", async () => {
    // app.json once told expo-image-picker `microphonePermission: false`,
    // which writes RECORD_AUDIO with tools:node="remove": the recorder's
    // permission request came back denied without a dialog.
    const { app, permissions } = await release({ background: false });

    expect(permissions.has(P("RECORD_AUDIO"))).toBe(true);
    expect(
      (app.manifest["uses-permission"] ?? []).filter(
        ({ $ }) => $[NAME] === P("RECORD_AUDIO") && $["tools:node"] === "remove",
      ),
    ).toEqual([]);
  });

  it("declares no foreground service, so the Play Console asks for none", async () => {
    // expo-audio brought FOREGROUND_SERVICE_MEDIA_PLAYBACK and two services
    // (lock-screen controls, background recording) the app never starts.
    const { permissions, services } = await release({ background: false });

    expect([...permissions.keys()].filter((name) => name.startsWith(P("FOREGROUND_SERVICE")))).toEqual([]);
    expect(
      [...services.values()]
        .filter((service) => /mediaPlayback|microphone/.test(service["android:foregroundServiceType"] ?? ""))
        .map((service) => service[NAME]),
    ).toEqual([]);
  });

  it("keeps WRITE storage only where the camera needs it, and no READ at all", async () => {
    // expo-image-picker's launchCameraAsync asks WRITE_EXTERNAL_STORAGE
    // below API 29 (ensureCameraPermissionsAreGranted), so Android 7-9 keeps
    // it. The gallery opens the system photo picker (PickVisualMedia, or
    // ACTION_OPEN_DOCUMENT where there is none), which needs no permission,
    // and the picked image is exported into the app's cache: nothing ever
    // reads shared storage.
    const { app, permissions } = await release({ background: false });

    expect(permissions.get(P("WRITE_EXTERNAL_STORAGE"))).toMatchObject({
      "android:maxSdkVersion": "28",
      "tools:node": "replace",
    });

    expect(permissions.has(P("READ_EXTERNAL_STORAGE"))).toBe(false);
    expect(
      (app.manifest["uses-permission"] ?? []).filter(
        ({ $ }) => $[NAME] === P("READ_EXTERNAL_STORAGE") && $["tools:node"] === "remove",
      ),
    ).toHaveLength(1);
  });

  it("never asks for the media library, which the manifest no longer grants", () => {
    // requestMediaLibraryPermissionsAsync asks READ + WRITE below API 33.
    // With READ removed it answers "denied" there without a dialog, and the
    // gallery would close before opening. launchImageLibraryAsync needs no
    // permission, so nothing may ask for one.
    const sources = ["app", "components", "features", "hooks", "providers", "utils"].flatMap(
      (dir) =>
        fs
          .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
          .filter((file) => /\.(ts|tsx)$/.test(file))
          .map((file) => join(dir, file)),
    );

    const askers = sources.filter((file) =>
      /MediaLibraryPermissions/.test(fs.readFileSync(join(ROOT, file), "utf8")),
    );

    expect(sources.length).toBeGreaterThan(50);
    expect(askers).toEqual([]);
  });

  it("asks for exactly this list: a new permission is a decision, not a side effect", async () => {
    const { permissions } = await release({ background: false });

    expect([...permissions.keys()].sort()).toEqual(
      [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "ACCESS_NETWORK_STATE",
        "ACCESS_WIFI_STATE",
        "CAMERA",
        "INTERNET",
        "MODIFY_AUDIO_SETTINGS",
        "POST_NOTIFICATIONS",
        "RECEIVE_BOOT_COMPLETED",
        "RECORD_AUDIO",
        "VIBRATE",
        "WRITE_EXTERNAL_STORAGE",
      ]
        .map(P)
        .sort(),
    );
  });
});

describe("the release manifest, screen-off tracking on", () => {
  it("adds the location service and nothing of the audio ones", async () => {
    const { permissions } = await release({ background: true });

    expect(permissions.has(P("ACCESS_BACKGROUND_LOCATION"))).toBe(true);
    expect([...permissions.keys()].filter((name) => name.startsWith(P("FOREGROUND_SERVICE"))).sort()).toEqual(
      [P("FOREGROUND_SERVICE"), P("FOREGROUND_SERVICE_LOCATION")],
    );
    expect(permissions.has(P("RECORD_AUDIO"))).toBe(true);
  });
});
