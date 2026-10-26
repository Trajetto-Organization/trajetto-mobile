import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * From this repository to a phone: what EAS uploads, which profile builds
 * what, and where the Firebase config comes from (MOB-26, MOB-ENV-1).
 */
const ROOT = resolve(__dirname, "..", "..");
const read = (file: string) => fs.readFileSync(join(ROOT, file), "utf8");

const configure = createRequire(join(ROOT, "package.json"))(join(ROOT, "app.config.js")) as (
  context: { config: Record<string, any> },
) => Record<string, any>;

const appJson = JSON.parse(read("app.json"));

const ENV_KEYS = [
  "EAS_BUILD",
  "EAS_BUILD_PROFILE",
  "APP_ENV",
  "EXPO_PUBLIC_API_URL",
  "GOOGLE_SERVICES_JSON",
  "EXPO_PUBLIC_BACKGROUND_TRACKING",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }

  vi.restoreAllMocks();
});

/** app.config.js under a given environment, with or without the local file. */
function evaluate(env: Partial<Record<EnvKey, string>>, { localFile }: { localFile: boolean }) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);

  const realExists = fs.existsSync;
  vi.spyOn(fs, "existsSync").mockImplementation((path) =>
    String(path).replace(/\\/g, "/").endsWith("google-services.json") ? localFile : realExists(path),
  );

  return configure({ config: structuredClone(appJson.expo) });
}

/** Rule lines of an ignore file, in order. */
const rules = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

describe("what EAS uploads", () => {
  it("is what git keeps, plus the Firebase config", () => {
    // .easignore replaces .gitignore for EAS: a rule missing here would ship
    // the .env with the EXPO_TOKEN, or the OTA signing key, to the builder.
    expect(fs.existsSync(join(ROOT, ".easignore")), ".easignore").toBe(true);

    const gitignore = rules(read(".gitignore"));
    const easignore = rules(read(".easignore"));

    expect(gitignore).toContain("google-services.json");
    expect(easignore).toEqual(gitignore.filter((rule) => rule !== "google-services.json"));
  });
});

type Profile = Record<string, any>;

/** A build profile with its `extends` chain applied, as EAS reads it. */
function profile(name: string): Profile {
  const build = JSON.parse(read("eas.json")).build as Record<string, Profile>;
  const own = build[name];
  expect(own, `profile ${name}`).toBeDefined();

  const { extends: parent, ...rest } = own;
  if (!parent) return own;

  const base = profile(parent);
  return { ...base, ...rest, android: { ...base.android, ...rest.android } };
}

describe("the build profiles", () => {
  it("give testers an APK they can install, not an AAB (MOB-26)", () => {
    for (const name of ["preview", "staging"]) {
      expect(profile(name), name).toMatchObject({
        distribution: "internal",
        android: { buildType: "apk" },
      });
    }
  });

  it("build staging against the preview EAS environment and its own OTA channel", () => {
    // The staging stack has its own API and hosts (decision 12.2): its URL
    // lives in the "preview" environment, never in this file. EAS offers only
    // development, preview and production on this plan, and a profile that
    // names any other environment builds with no variables at all.
    const staging = profile("staging");

    expect(staging).toMatchObject({ channel: "staging", environment: "preview" });
    expect(JSON.stringify(staging)).not.toMatch(/https?:\/\//);

    for (const other of ["development", "preview", "production"]) {
      expect(profile(other).channel, other).not.toBe("staging");
    }

    const environments = ["development", "preview", "staging", "production"].map(
      (name) => profile(name).environment,
    );
    for (const environment of environments) {
      expect(["development", "preview", "production"]).toContain(environment);
    }
  });

  it("keep the store build an app bundle", () => {
    const production = profile("production");

    expect(production.distribution ?? "store").toBe("store");
    expect(production.android?.buildType ?? "app-bundle").toBe("app-bundle");
  });

  it("each have the npm scripts that build and update them", () => {
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;

    for (const name of ["development", "preview", "staging", "production"]) {
      expect(scripts[`build:${name}`], `build:${name}`).toBe(
        `eas build --platform android --profile ${name}`,
      );
    }

    // An update goes to the channel the binary listens to, with the
    // variables of the environment it was built with (APP_ENV included).
    for (const name of ["preview", "staging", "production"]) {
      const { channel, environment } = profile(name);

      expect(scripts[`update:${name}`], `update:${name}`).toBe(
        `eas update --branch ${channel} --environment ${environment} --message`,
      );
    }
  });
});

describe("the Firebase config of a build (MOB-ENV-1)", () => {
  const eas = { EXPO_PUBLIC_API_URL: "https://api.trajetto.com.br" };

  it("comes from the EAS file variable when the builder has it", () => {
    // CI checkouts never have the gitignored file; EAS writes the file
    // variable somewhere and puts the path in the variable.
    const config = evaluate(
      { ...eas, EAS_BUILD: "true", EAS_BUILD_PROFILE: "production", GOOGLE_SERVICES_JSON: "/home/expo/eas-env/GOOGLE_SERVICES_JSON" },
      { localFile: false },
    );

    expect(config.android.googleServicesFile).toBe("/home/expo/eas-env/GOOGLE_SERVICES_JSON");
  });

  it("falls back to the file downloaded from the Firebase console", () => {
    expect(evaluate({}, { localFile: true }).android.googleServicesFile).toBe("./google-services.json");
  });

  it("stops a release build on the EAS worker that has neither", () => {
    // It would install and run, and never get a push token.
    for (const name of ["preview", "staging", "production"]) {
      expect(() =>
        evaluate({ ...eas, EAS_BUILD: "true", EAS_BUILD_PROFILE: name }, { localFile: false }),
      ).toThrow(/GOOGLE_SERVICES_JSON/);
    }
  });

  it("leaves alone a local run, the eas-cli pass before the upload and a dev client", () => {
    // eas-cli evaluates the config on the machine that runs it (CI included)
    // before uploading, without EAS_BUILD and without file variables.
    expect(evaluate({ ...eas, APP_ENV: "production" }, { localFile: false }).android.googleServicesFile).toBeUndefined();
    expect(() =>
      evaluate({ ...eas, EAS_BUILD: "true", EAS_BUILD_PROFILE: "development" }, { localFile: false }),
    ).not.toThrow();
  });
});

describe(".env.example", () => {
  const example = read(".env.example");
  const declared = new Set(
    example
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=/.exec(line.trim())?.[1])
      .filter(Boolean),
  );

  it("lists every EXPO_PUBLIC_* variable the config and the bundle read", () => {
    const sources: string[] = [read("app.config.js")];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) sources.push(read(path));
      }
    };
    ["app", "components", "features", "hooks", "providers", "store", "utils"].forEach(walk);

    const used = new Set(
      sources.flatMap((source) =>
        [...source.matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)].map((match) => match[1]),
      ),
    );

    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("keeps the screen-off tracking off, and app.config.js reads its value as off", () => {
    // Decision 7.3: ready and tested, off until the Play Console declaration.
    const value = /^EXPO_PUBLIC_BACKGROUND_TRACKING=(.*)$/m.exec(example)?.[1];

    expect(value).toBe("false");
    expect(
      evaluate({ EXPO_PUBLIC_BACKGROUND_TRACKING: value }, { localFile: false }).extra.backgroundTracking,
    ).toBe(false);
  });
});
