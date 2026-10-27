import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * The first staging build failed on EAS with "Runtime version calculated on
 * local machine not equal to runtime version calculated during build": the
 * fingerprint hashed the google-services.json, which the CI runner that
 * queues `eas build` never has (gitignored) and the EAS worker gets from the
 * GOOGLE_SERVICES_JSON file variable under ../eas-environment-secrets/.
 * Whatever the source of the Firebase config, the runtime version must be
 * the same, or every CI build fails and OTA updates miss the binaries.
 */
const ROOT = resolve(__dirname, "..", "..");
const { createFingerprintAsync } = createRequire(join(ROOT, "package.json"))(
  "@expo/fingerprint",
) as typeof import("@expo/fingerprint");

// Same layout as the EAS worker: <somewhere>/eas-environment-secrets/<hash>.
const SECRETS = fs.mkdtempSync(join(tmpdir(), "fingerprint-firebase-"));
const secretFile = (name: string, contents: string) => {
  const dir = join(SECRETS, "eas-environment-secrets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, name), contents);
  return join(dir, name);
};

afterAll(() => fs.rmSync(SECRETS, { recursive: true, force: true }));

const ENV_KEYS = ["GOOGLE_SERVICES_JSON", "EAS_BUILD", "EAS_BUILD_PROFILE", "APP_ENV"] as const;

async function runtimeVersion(googleServicesJson: string | undefined) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  if (googleServicesJson) process.env.GOOGLE_SERVICES_JSON = googleServicesJson;

  try {
    return (await createFingerprintAsync(ROOT, { platforms: ["android"] })).hash;
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe("the runtime version and the Firebase config", () => {
  it("is the same on the CI runner, on the EAS worker and on a dev machine", async () => {
    const versions = [
      // CI runner: no file at all.
      await runtimeVersion(join(SECRETS, "absent.json")),
      // EAS worker: the file variable, whatever its contents.
      await runtimeVersion(secretFile("one", '{"project_info":{"project_id":"one"}}')),
      await runtimeVersion(secretFile("two", '{"project_info":{"project_id":"two"}}')),
      // Dev machine: the local copy, when there is one.
      await runtimeVersion(undefined),
    ];

    expect(new Set(versions).size, versions.join("\n")).toBe(1);
  }, 120_000);
});
