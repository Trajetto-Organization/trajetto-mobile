import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The supply chain has controls (INFRA-16).
 *
 * There was no Dependabot and no audit gate, and every action ran from a
 * movable tag — expo/expo-github-action@v8 receives EXPO_TOKEN, and the
 * production build auto-submits to the Play Store. Now Dependabot keeps npm
 * and the actions moving, every action is pinned by commit SHA, and audit-ci
 * fails CI on a CRITICAL advisory in a production dependency.
 */
const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

const workflows = readdirSync(resolve(ROOT, ".github/workflows"))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: read(`.github/workflows/${name}`) }));

describe("Dependabot", () => {
  it("updates npm and the actions", () => {
    expect(existsSync(resolve(ROOT, ".github/dependabot.yml"))).toBe(true);

    const config = read(".github/dependabot.yml");

    expect(config).toMatch(/package-ecosystem: npm/);
    expect(config).toMatch(/package-ecosystem: github-actions/);
  });
});

describe("the workflows", () => {
  it("pin every action to a full commit SHA, with the version it was", () => {
    const loose = workflows.flatMap(({ name, text }) =>
      text
        .split(/\r?\n/)
        .filter((line) => /^\s*(?:-\s*)?uses:/.test(line))
        // A reusable workflow of this repository is pinned by the commit itself.
        .filter((line) => !/uses:\s*\.\/\.github\/workflows\/[\w.-]+\.ya?ml\s*$/.test(line))
        .filter((line) => !/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v?\d+\.\d+\.\d+\s*$/.test(line))
        .map((line) => `${name}: ${line.trim()}`),
    );

    expect(loose).toEqual([]);
  });

  it("fail on a critical advisory in a production dependency, in CI and before any release", () => {
    expect(read(".github/workflows/ci.yml")).toMatch(/npx --yes audit-ci@\d+\.\d+\.\d+ --config audit-ci\.jsonc/);
    // deploy.yml runs ci.yml (audit included) as the job every release needs.
    expect(read(".github/workflows/deploy.yml")).toMatch(/^ {4}uses: \.\/\.github\/workflows\/ci\.yml\s*$/m);
  });
});

describe("audit-ci.jsonc", () => {
  it("gates production dependencies on critical advisories", () => {
    const config = JSON.parse(read("audit-ci.jsonc").replace(/^\s*\/\/.*$/gm, ""));

    expect(config.critical).toBe(true);
    expect(config["skip-dev"]).toBe(true);
  });
});
