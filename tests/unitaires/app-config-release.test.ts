import fs from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { releaseApiUrlProblem } from "@/utils/api-url-rules";

/**
 * The release configuration of the app (MOB-11, GAP4-11).
 *
 * Two holes in the path from a laptop to every driver's phone:
 *
 * - the HTTPS check in `app.config.js` ran only under EAS Build, so `npm run
 *   update:production` published whatever API URL the laptop had;
 * - OTA updates were not signed. Whoever held the EXPO_TOKEN could push a
 *   bundle to every phone, and the bundle can read the SecureStore.
 */
const ROOT = resolve(__dirname, "..", "..");

const configure = createRequire(__filename)(
  resolve(ROOT, "app.config.js"),
) as (context: { config: Record<string, any> }) => Record<string, any>;

const appJson = JSON.parse(fs.readFileSync(resolve(ROOT, "app.json"), "utf8"));

const ENV_KEYS = [
  "EAS_BUILD_PROFILE",
  "APP_ENV",
  "EXPO_PUBLIC_API_URL",
] as const;
const savedEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

const evaluate = (env: Partial<Record<(typeof ENV_KEYS)[number], string>>) => {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);

  return configure({ config: structuredClone(appJson.expo) });
};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }

  vi.restoreAllMocks();
});

describe("the API URL check at publish time", () => {
  it("runs for an OTA publish, not only for EAS Build", () => {
    // `eas update --environment production` loads APP_ENV from the EAS
    // environment; EAS_BUILD_PROFILE does not exist there.
    expect(() =>
      evaluate({
        APP_ENV: "production",
        EXPO_PUBLIC_API_URL: "http://192.168.0.10:3333",
      }),
    ).toThrow(/HTTPS/);
  });

  it("lets a correct OTA publish through", () => {
    expect(() =>
      evaluate({
        APP_ENV: "preview",
        EXPO_PUBLIC_API_URL: "https://api-staging.intrajetto.com",
      }),
    ).not.toThrow();
  });

  it("leaves local development alone", () => {
    expect(() =>
      evaluate({ EXPO_PUBLIC_API_URL: "http://192.168.0.10:3333" }),
    ).not.toThrow();

    expect(() =>
      evaluate({
        APP_ENV: "development",
        EXPO_PUBLIC_API_URL: "http://192.168.0.10:3333",
      }),
    ).not.toThrow();
  });

  it.each([
    "https://api-staging.intrajetto.com",
    "http://api.trajetto.com.br",
    "https://user:senha@api.trajetto.com.br",
    "https://api.trajetto.com.br/?x=1",
    "https://192.168.0.10",
    "https://172.20.0.1",
    "https://api.local",
    "https://[fd00::1]",
  ])("agrees with the bundle's own check about %s", (url) => {
    const refusedAtPublish = (() => {
      try {
        evaluate({ EAS_BUILD_PROFILE: "production", EXPO_PUBLIC_API_URL: url });
        return false;
      } catch {
        return true;
      }
    })();

    expect(refusedAtPublish).toBe(releaseApiUrlProblem(url) !== null);
  });
});

describe("OTA code signing", () => {
  const withCertificate = (present: boolean) => {
    const realExists = fs.existsSync;

    vi.spyOn(fs, "existsSync").mockImplementation((path) =>
      String(path).replace(/\\/g, "/").endsWith("certs/certificate.pem")
        ? present
        : realExists(path),
    );
  };

  it("is embedded in the build once the project has a certificate", () => {
    withCertificate(true);

    const config = evaluate({});

    expect(config.updates).toMatchObject({
      enabled: true,
      url: appJson.expo.updates.url,
      codeSigningCertificate: "./certs/certificate.pem",
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    });
  });

  it("changes nothing while there is no certificate", () => {
    // Referencing a missing certificate would break every build; the owner
    // generates the key pair first (docs/deploy.md, OTA signing section).
    withCertificate(false);

    const config = evaluate({});

    expect(config.updates.codeSigningCertificate).toBeUndefined();
    expect(config.updates.codeSigningMetadata).toBeUndefined();
  });

  it("lets the public certificate into git, and keeps the private key out", () => {
    // EAS Build only sees what git sees: a certificate caught by `*.pem`
    // would silently ship a binary that accepts unsigned updates.
    const rules = fs
      .readFileSync(resolve(ROOT, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());

    expect(rules).toContain("!certs/certificate.pem");
    expect(rules).toContain("keys/");
    expect(rules.indexOf("!certs/certificate.pem")).toBeGreaterThan(
      rules.indexOf("*.pem"),
    );
  });
});
