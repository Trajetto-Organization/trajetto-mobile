const isLocalHost = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    ["localhost", "0.0.0.0", "127.0.0.1", "::", "::1", "10.0.2.2"].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan")
  ) {
    return true;
  }

  if (normalized.includes(":")) {
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    );
  }

  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);

  if (!match) return false;
  const [, first, second] = match.map(Number);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
};

const assertBuildApiUrl = () => {
  // EAS_BUILD_PROFILE exists only inside EAS Build. An `eas update` publishes
  // to every phone without it, so the EAS environments also carry APP_ENV
  // (loaded by `--environment`), and the check runs for OTA too. The bundle
  // repeats it at runtime anyway (utils/api-url-rules.ts).
  const buildProfile = process.env.EAS_BUILD_PROFILE ?? process.env.APP_ENV;
  if (!buildProfile) return;

  const rawApiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!rawApiUrl) {
    throw new Error(
      `EXPO_PUBLIC_API_URL deve existir no ambiente EAS "${buildProfile}".`,
    );
  }

  let apiUrl;
  try {
    apiUrl = new URL(rawApiUrl);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL precisa ser uma URL absoluta válida.");
  }

  if (buildProfile !== "development") {
    if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      throw new Error(
        "EXPO_PUBLIC_API_URL não aceita credenciais, query string ou fragmento.",
      );
    }

    if (apiUrl.protocol !== "https:") {
      throw new Error(
        `O perfil EAS "${buildProfile}" exige EXPO_PUBLIC_API_URL com HTTPS.`,
      );
    }

    if (isLocalHost(apiUrl.hostname)) {
      throw new Error(
        `O perfil EAS "${buildProfile}" não aceita API local ou de rede privada.`,
      );
    }
  }
};

/**
 * Whether THIS BUILD may follow a driver with the screen off.
 *
 * Off unless the build environment says otherwise, and the switch touches the
 * MANIFEST, not just the runtime. Android grants only what the manifest
 * declares, and the manifest is what Google reviews: shipping
 * `ACCESS_BACKGROUND_LOCATION` without the Play Console declaration and its
 * demo video gets an app removed from the store. So the code is here and
 * ready, and turning it on is a deliberate act by whoever answers for the
 * listing — see docs/deploy.md, background location section.
 */
const backgroundTrackingEnabled = () =>
  process.env.EXPO_PUBLIC_BACKGROUND_TRACKING === "true";

/**
 * What the libraries put in the merged manifest that this app never uses.
 *
 * Google reviews the manifest, not the code: every FOREGROUND_SERVICE_* type
 * needs its own Play Console declaration (target 34+), and a permission the
 * app never asks for still shows on the listing. `tools:node="remove"` in the
 * app manifest wins over any library, AARs included.
 *
 * Never RECORD_AUDIO: the chat's voice notes need it (MOB-01).
 */
const UNUSED_PERMISSIONS = [
  // expo-audio, for lock-screen controls and background recording. The chat
  // plays and records in the foreground only.
  "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  "android.permission.FOREGROUND_SERVICE_MICROPHONE",
  // Prebuild template ("draw over other apps"): only the dev menu's overlays
  // use it, and the debug manifest keeps its own copy.
  "android.permission.SYSTEM_ALERT_WINDOW",
  // expo-image-picker and expo-file-system declare it. The gallery opens the
  // system photo picker (PickVisualMedia, or ACTION_OPEN_DOCUMENT where there
  // is none), which needs no permission, and the picked image is exported
  // into the app's cache. Only requestMediaLibraryPermissionsAsync asked for
  // it, and the app no longer calls that (android-manifest.test.ts).
  "android.permission.READ_EXTERNAL_STORAGE",
];

// Started only by `player.setActiveForLockScreen` and by
// `setAudioModeAsync({ allowsBackgroundRecording: true })`. Using either one
// means taking the service out of this list and declaring its type.
const UNUSED_SERVICES = [
  "expo.modules.audio.service.AudioControlsService",
  "expo.modules.audio.service.AudioRecordingService",
];

// expo-image-picker and expo-file-system declare it with no ceiling. Only the
// camera needs it, and only on old Android: launchCameraAsync asks WRITE below
// API 29 (Android 10). It stops there instead of breaking the camera on 7-9.
const LEGACY_STORAGE_PERMISSIONS = ["android.permission.WRITE_EXTERNAL_STORAGE"];
const LEGACY_STORAGE_MAX_SDK = "28";

const withAndroidManifestPolicy = (config, { background }) => {
  const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

  config.android = {
    ...config.android,
    blockedPermissions: [
      ...new Set([
        ...(config.android?.blockedPermissions ?? []),
        ...UNUSED_PERMISSIONS,
        // With the screen-off tracking off, nothing starts a foreground
        // service; expo-audio would still bring the base permission in.
        ...(background ? [] : ["android.permission.FOREGROUND_SERVICE"]),
      ]),
    ],
  };

  // Registered before the plugins in app.json, so it runs after them and
  // sees every permission they added.
  return withAndroidManifest(config, (mod) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(
      mod.modResults,
    ).manifest;

    // `replace`, not the default merge: a library entry without maxSdkVersion
    // would otherwise lift the ceiling.
    manifest["uses-permission"] = [
      ...(manifest["uses-permission"] ?? []).filter(
        (entry) =>
          !LEGACY_STORAGE_PERMISSIONS.includes(entry.$["android:name"]),
      ),
      ...LEGACY_STORAGE_PERMISSIONS.map((name) => ({
        $: {
          "android:name": name,
          "android:maxSdkVersion": LEGACY_STORAGE_MAX_SDK,
          "tools:node": "replace",
        },
      })),
    ];

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    application.service = [
      ...(application.service ?? []).filter(
        (service) => !UNUSED_SERVICES.includes(service.$["android:name"]),
      ),
      ...UNUSED_SERVICES.map((name) => ({
        $: { "android:name": name, "tools:node": "remove" },
      })),
    ];

    return mod;
  });
};

/**
 * FCM credentials for remote push (the Expo push token needs them).
 *
 * The file is gitignored, so a CI checkout never has it: EAS gets it from the
 * file environment variable GOOGLE_SERVICES_JSON, whose value is the path EAS
 * wrote the file to (.env.example has the command). A local `eas build` can
 * also upload the file itself, which .easignore lets through. Relative path:
 * expo-cli and EAS evaluate this config from the project root (and __dirname
 * trips the eslint browser env of this repo).
 */
const LOCAL_GOOGLE_SERVICES = "./google-services.json";

const resolveGoogleServicesFile = (fs) => {
  if (process.env.GOOGLE_SERVICES_JSON) return process.env.GOOGLE_SERVICES_JSON;
  if (fs.existsSync(LOCAL_GOOGLE_SERVICES)) return LOCAL_GOOGLE_SERVICES;

  // On an EAS worker, a store or tester build without FCM would install fine
  // and never receive a push; stop it there instead. Locally, and in the
  // eas-cli pass that runs before the upload, the file may be absent.
  const profile = process.env.EAS_BUILD_PROFILE;
  if (process.env.EAS_BUILD === "true" && profile && profile !== "development") {
    throw new Error(
      `O build EAS "${profile}" precisa do google-services.json: defina a variável de arquivo GOOGLE_SERVICES_JSON nesse ambiente EAS (ver .env.example).`,
    );
  }

  return undefined;
};

// Written by `npm run codesigning:generate`; see docs/deploy.md, OTA signing section.
const CODE_SIGNING_CERTIFICATE = "./certs/certificate.pem";

module.exports = ({ config }) => {
  assertBuildApiUrl();

  const background = backgroundTrackingEnabled();

  // Read by the app to decide whether to ask for the permission at all.
  config.extra = { ...config.extra, backgroundTracking: background };

  if (background) {
    config.android = {
      ...config.android,
      permissions: [
        ...(config.android?.permissions ?? []),

        // The three Android wants together: the location itself, the service
        // that keeps the process alive, and the declaration of what that
        // service is for.
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_LOCATION",
      ],
    };

    config.plugins = (config.plugins ?? []).map((plugin) => {
      if (!Array.isArray(plugin) || plugin[0] !== "expo-location") {
        return plugin;
      }

      return [
        plugin[0],
        {
          ...plugin[1],
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ];
    });
  }

  const fs = require("fs");

  const googleServicesFile = resolveGoogleServicesFile(fs);
  if (googleServicesFile) {
    config.android = { ...config.android, googleServicesFile };
  }

  // OTA code signing. Without it, whoever holds the EXPO_TOKEN can push a
  // bundle to every phone, and a bundle can read the SecureStore. The
  // certificate is public and committed; the private key that signs each
  // `eas update` never enters the repository (docs/deploy.md, OTA signing section).
  // Conditional like the file above: until the owner generates the key pair
  // there is nothing to embed, and a missing certificate would break builds.
  if (fs.existsSync(CODE_SIGNING_CERTIFICATE)) {
    config.updates = {
      ...config.updates,
      codeSigningCertificate: CODE_SIGNING_CERTIFICATE,
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    };
  }

  return withAndroidManifestPolicy(config, { background });
};
