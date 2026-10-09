import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Secrets stay out of the repository, and a new one is caught (INFRA-21).
 *
 * The Firebase admin SDK key sits next to the repositories
 * (google-firebase-services/), and only the exact names
 * `google-service-account.json` and `google-services.json` were ignored: a
 * copy of the admin key into the project could be committed by a plain
 * `git add .`, and EAS uploads whatever git sees. The branch CI now runs
 * gitleaks over every commit.
 */
const ROOT = process.cwd();

function isIgnored(path: string): boolean {
  try {
    // --no-index: the pattern decides, whatever is or is not tracked.
    execFileSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

describe("the .gitignore", () => {
  it.each([
    ".env",
    ".env.production.local",
    "google-services.json",
    "google-service-account.json",
    "trajetto-640d0-firebase-adminsdk-fbsvc-0a1b2c3d4e.json",
    "credentials/play-service-account.json",
    "keys/private-key.pem",
    "modules/text-reader/android/build/tmp/kotlin-classes/debug/A.class",
  ])("keeps %s out", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it("lets .env.example in", () => {
    expect(isIgnored(".env.example")).toBe(false);
  });

  it("lets the OTA certificate and the native module sources in", () => {
    expect(isIgnored("certs/certificate.pem")).toBe(false);
    expect(isIgnored("modules/text-reader/android/build.gradle")).toBe(false);
  });
});

describe("the branch CI", () => {
  it("scans the whole history with gitleaks, pinned by digest", () => {
    const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");

    expect(ci).toMatch(/fetch-depth: 0/);
    expect(ci).toMatch(/zricethezav\/gitleaks:v8[\d.]+@sha256:[0-9a-f]{64}/);
    expect(ci).toMatch(/gitleaks git \/repo --redact[^\n]*--exit-code 1/);
  });

  // gitleaks' generic rule fires on any `PASSWORD = "…"` — the API's and the
  // web's tests already carried such fixtures, and the job would stay red on
  // them. The same config in the three repositories: quieted for that rule
  // and those paths only, so a provider key (Expo, Google, GitHub, …) in a
  // test still fails.
  it("keeps every default rule and quiets only the generic one, only on fixtures", () => {
    const path = resolve(ROOT, ".gitleaks.toml");

    expect(existsSync(path), ".gitleaks.toml").toBe(true);

    const config = readFileSync(path, "utf8").replace(/^\s*#.*$/gm, "");

    expect(config).toMatch(/^\[extend\]\s*\n\s*useDefault\s*=\s*true\s*$/m);
    expect(config).not.toMatch(/^\[allowlist\]/m);
    expect(config).not.toMatch(/^\[\[rules\]\]/m);

    const allowlists = config.split(/^\[\[allowlists\]\]\s*$/m).slice(1);

    expect(allowlists).toHaveLength(1);
    expect(allowlists[0]).toMatch(/^targetRules\s*=\s*\[\s*"generic-api-key"\s*\]\s*$/m);
    expect(allowlists[0]).not.toMatch(/^\s*(?:commits|regexes|stopwords)\s*=/m);

    const paths = [...allowlists[0].matchAll(/'''([^']+)'''/g)].map((match) => match[1]);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((entry) => !/^\^tests\/$|^\^\\\.env\\\.example\$$/.test(entry))).toEqual([]);
  });
});

/** The jobs of a workflow by key: from `  <key>:` up to the next job. */
function jobsOf(workflow: string): Map<string, string> {
  const section = workflow.slice(workflow.search(/^jobs:\s*$/m));
  const chunks = section.split(/\r?\n(?= {2}[\w-]+:\s*\r?\n)/).slice(1);

  return new Map(chunks.map((chunk) => [/^ {2}([\w-]+):/.exec(chunk)![1], chunk]));
}

/** `needs: a` or `needs: [a, b]`, the two forms these workflows use. */
function needsOf(job: string): string[] {
  const needs = /^ {4}needs:\s*(.+)$/m.exec(job)?.[1] ?? "";

  return needs
    .replace(/[[\]]/g, "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * main never ran the scan (INFRA-21): the branch CI only triggered on the
 * other branches, so a direct push or a merge that brought a key in went to
 * EAS — which uploads whatever git sees — and, on the production profile, to
 * the Play Store. Now deploy.yml calls the whole ci.yml (gitleaks included)
 * on every push to staging and main, and no EAS build or OTA update starts
 * before it passes.
 */
describe("the release pipeline", () => {
  const deploy = jobsOf(readFileSync(resolve(ROOT, ".github/workflows/deploy.yml"), "utf8"));
  const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");

  it("runs the same CI, secret scan included, before releasing", () => {
    expect(deploy.get("checks") ?? "", "checks job in deploy.yml").toMatch(/^ {4}uses: \.\/\.github\/workflows\/ci\.yml\s*$/m);
    expect(ci).toMatch(/^\s+workflow_call:/m);
    expect(jobsOf(ci).get("secrets") ?? "").toMatch(/gitleaks git \/repo --redact/);
  });

  it("starts no EAS build or OTA update before the checks pass", () => {
    const releases = [...deploy].filter(([, job]) => /\beas (build|update)\b/.test(job));

    expect(releases.length).toBeGreaterThan(0);

    for (const [name, job] of releases) expect(needsOf(job), name).toContain("checks");
  });

  it("never writes the OTA signing key anywhere but a private temporary file", () => {
    const workflows = ["deploy.yml", "ota-rollback.yml"].map((name) =>
      readFileSync(resolve(ROOT, ".github/workflows", name), "utf8"),
    );

    for (const workflow of workflows) {
      const writes = workflow.match(/"\$PRIVATE_KEY" > [^\n]+/g) ?? [];

      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) expect(write).toBe('"$PRIVATE_KEY" > "$RUNNER_TEMP/ota-signing/private-key.pem"');
      expect(workflow).toMatch(/umask 077/);
      expect(workflow).not.toMatch(/echo[^\n]*\$PRIVATE_KEY/);
    }
  });
});
