import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The pipeline that puts the app on the drivers' phones (INFRA-20,
 * docs/deploy.md "Pipeline").
 *
 * `deploy.yml` once built — and, for production, submitted to the Play Store —
 * with only typecheck, lint and doctor in front of it. The unit tests, where
 * the offline queue's survival rules live, ran only on branches. Now the flow
 * is work branch → staging → main: ci.yml is the single validation, deploy.yml
 * calls it before any EAS build or OTA update, main ships only a commit that
 * went green on staging, and production OTA is always signed.
 */
const ROOT = resolve(__dirname, "..", "..");
const WORKFLOWS = resolve(ROOT, ".github", "workflows");

const read = (name: string) => readFileSync(resolve(WORKFLOWS, name), "utf8").replace(/\r\n/g, "\n");

interface Step {
  name: string;
  condition: string | null;
  body: string;
}

/**
 * The steps of a workflow (or of one job), in order. A deliberately small
 * reader: the workflows are flat lists of `- name:` steps, and the app has no
 * business depending on a YAML parser that only arrives transitively.
 */
const stepsOf = (text: string): Step[] =>
  text
    .split(/\n(?=\s+- name:)/)
    // The preamble before the first step, and the empty pieces that blank
    // lines between steps leave behind, are not steps.
    .filter((chunk) => /^\s+- name:/.test(chunk))
    .map((chunk) => ({
      name: chunk.match(/- name:\s*(.+)/)?.[1]?.trim() ?? "",
      condition: chunk.match(/^\s+if:\s*(.+)$/m)?.[1]?.trim() ?? null,
      body: chunk,
    }));

/** The jobs of a workflow by key: from `  <key>:` up to the next job. */
function jobsOf(workflow: string): Map<string, string> {
  const section = workflow.slice(workflow.search(/^jobs:\s*$/m));
  const chunks = section.split(/\n(?= {2}[\w-]+:\s*\n)/).slice(1);

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

/** The `on:` block of a workflow. */
const triggersOf = (workflow: string) => /^on:\n((?: {2,}.*\n|\n)+)/m.exec(workflow)?.[1] ?? "";

const ci = read("ci.yml");
const deploy = read("deploy.yml");
const rollback = read("ota-rollback.yml");
const deployJobs = jobsOf(deploy);

describe("the CI workflow (ci.yml)", () => {
  const validate = jobsOf(ci).get("validate") ?? "";
  const steps = stepsOf(validate);

  it("runs the unit tests unconditionally, with lint, typecheck, audit and doctor", () => {
    const tests = steps.find((step) => /^\s+run: npm test\b/m.test(step.body));

    expect(tests, "unit test step").toBeDefined();
    expect(tests?.condition).toBeNull();

    for (const command of ["npm run lint", "npm run typecheck", "npm run doctor"]) {
      expect(steps.find((step) => step.body.includes(`run: ${command}`))?.condition, command).toBeNull();
    }
  });

  it("gates work branches, pull requests to staging and main, and the release workflow", () => {
    const triggers = triggersOf(ci);

    expect(triggers).toMatch(/push:\n\s+branches-ignore: \[main, master, staging\]/);
    expect(triggers).toMatch(/pull_request:\n\s+branches: \[staging, main, master\]/);
    expect(triggers).toMatch(/workflow_call:/);
  });
});

describe("the release workflow (deploy.yml)", () => {
  it("releases from pushes to staging and to main", () => {
    expect(triggersOf(deploy)).toMatch(/push:\n\s+branches: \[staging, main\]/);
  });

  it("calls the whole CI before anything else", () => {
    expect(deployJobs.get("checks")).toMatch(/^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/m);
  });

  it("starts no EAS build or OTA update before CI passes", () => {
    const eas = [...deployJobs].filter(([, job]) => /\beas (build|update)\b/.test(job));

    expect(eas.map(([name]) => name).sort()).toEqual(["manual-build", "production", "staging"]);
    for (const [name, job] of eas) expect(needsOf(job), name).toContain("checks");
  });

  it("publishes staging on the staging channel and production on the production one", () => {
    const staging = deployJobs.get("staging") ?? "";
    const production = deployJobs.get("production") ?? "";

    expect(staging).toMatch(/if: .*github\.ref == 'refs\/heads\/staging'/);
    expect(staging).toMatch(/^ {4}environment: staging$/m);
    expect(staging).toMatch(/eas update --branch staging --environment staging\b/);
    expect(staging).toMatch(/eas build --platform android --profile staging\b/);

    expect(production).toMatch(/if: .*github\.ref == 'refs\/heads\/main'/);
    expect(production).toMatch(/^ {4}environment: production$/m);
    expect(production).toMatch(/eas update --branch production --environment production\b/);
    expect(production).toMatch(/eas build --platform android --profile production\b/);
  });

  it("ships on main only a commit that went green on staging", () => {
    const evidence = deployJobs.get("staging-evidence") ?? "";

    expect(needsOf(deployJobs.get("production") ?? "")).toContain("staging-evidence");
    // Merge commit: the staging head is the second parent; fast-forward: the commit itself.
    expect(evidence).toMatch(/HEAD\^2/);
    expect(evidence).toMatch(/actions\/workflows\/deploy\.yml\/runs\?branch=staging&event=push&status=success&head_sha=/);
    expect(evidence).toMatch(/::error::[^\n]+\n\s+exit 1/);
    expect(evidence).toMatch(/^ {6}actions: read$/m);
  });

  it("refuses a merge whose tree differs from the staging commit", () => {
    const evidence = deployJobs.get("staging-evidence") ?? "";

    // The merge tree must be the staging tree that ran green. No ancestry
    // check: earlier release merge commits live only on main by design.
    expect(evidence).toMatch(/git diff --quiet "HEAD\^2" HEAD/);
    expect(evidence).not.toMatch(/git merge-base --is-ancestor "HEAD\^1"/);
    expect(evidence).toMatch(/fetch-depth: 0/);
  });

  it("diffs against the last successful release, so a dropped pending run loses no native change", () => {
    const plan = deployJobs.get("plan") ?? "";

    expect(plan).toMatch(/actions\/workflows\/deploy\.yml\/runs\?branch=\$\{GITHUB_REF_NAME\}&event=push&status=success/);
    expect(plan).toMatch(/git merge-base --is-ancestor "\$base" "\$GITHUB_SHA"/);
    expect(plan).toMatch(/git diff --name-only "\$base" "\$GITHUB_SHA"/);
    expect(plan).toMatch(/^ {6}actions: read$/m);
  });

  it("asks EAS to auto-submit with one flag only (the two are mutually exclusive)", () => {
    expect(deploy).not.toMatch(/--auto-submit\s+--auto-submit-with-profile/);
    expect(deploy).toMatch(/--auto-submit-with-profile production/);
  });

  it("never publishes an unsigned OTA to production", () => {
    const production = stepsOf(deployJobs.get("production") ?? "");
    const signing = production.find((step) => step.name === "Prepare the OTA signing key");
    const publish = production.find((step) => /\beas update\b/.test(step.body));

    expect(signing?.body).toMatch(/if \[ -f certs\/certificate\.pem \] && \[ -n "\$PRIVATE_KEY" \]; then/);
    expect(publish?.condition).toMatch(/steps\.signing\.outputs\.publish == 'true'/);
  });

  it("removes the signing key whatever happened", () => {
    for (const [name, job] of [...deployJobs, ["ota-rollback", rollback] as const]) {
      if (!/EXPO_UPDATE_PRIVATE_KEY/.test(job)) continue;

      const cleanup = stepsOf(job).find((step) => step.name === "Remove the OTA signing key");
      expect(cleanup?.condition, name).toBe("always()");
      expect(cleanup?.body, name).toMatch(/rm -rf "\$RUNNER_TEMP\/ota-signing"/);
    }
  });

  it("skips the EAS steps with a notice while EXPO_TOKEN is not configured", () => {
    for (const name of ["staging", "production"]) {
      const steps = stepsOf(deployJobs.get(name) ?? "");

      expect(steps[0]?.name, name).toBe("Is EAS configured?");
      expect(steps[0]?.body, name).toMatch(/::notice::EXPO_TOKEN ausente/);
      for (const step of steps.slice(1, -1)) {
        expect(step.condition, `${name}: ${step.name}`).toMatch(/steps\.eas\.outputs\.enabled == 'true'/);
      }
    }
  });

  it("offers every EAS build profile to a manual run, staging included", () => {
    const eas = JSON.parse(readFileSync(resolve(ROOT, "eas.json"), "utf8")) as { build: Record<string, unknown> };

    const options = deploy.match(/options:\n((?:\s+- .+\n)+)/)?.[1] ?? "";
    const offered = [...options.matchAll(/- (\S+)/g)].map((match) => match[1]);

    expect(offered.sort()).toEqual(Object.keys(eas.build).sort());
  });
});

describe("the OTA rollback workflow (ota-rollback.yml)", () => {
  it("republishes an older group of the chosen channel, behind that channel's environment", () => {
    expect(triggersOf(rollback)).toMatch(/workflow_dispatch:/);
    expect(triggersOf(rollback)).not.toMatch(/\bpush:/);
    expect(rollback).toMatch(/^ {4}environment: \$\{\{ github\.event\.inputs\.channel \}\}$/m);
    expect(rollback).toMatch(/eas update:republish --group "\$GROUP"/);
  });

  it("refuses a group from another channel before republishing it", () => {
    const steps = stepsOf(jobsOf(rollback).get("republish") ?? "");
    const check = steps.findIndex((step) => step.name === "Check that the group belongs to the chosen channel");
    const republish = steps.findIndex((step) => /eas update:republish/.test(step.body));

    expect(check, "branch check step").toBeGreaterThanOrEqual(0);
    expect(check).toBeLessThan(republish);
    expect(steps[check]?.condition).toBeNull();
    expect(steps[check]?.body).toMatch(/eas update:view "\$GROUP" --json/);
    expect(steps[check]?.body).toMatch(/if \[ "\$branches" != "\$CHANNEL" \]; then\n\s+echo "::error::[^\n]+\n\s+exit 1/);
  });
});

describe("the Node version", () => {
  it.each(["ci.yml", "deploy.yml", "ota-rollback.yml"])("is 22 in %s, not the end-of-life 20", (name) => {
    const workflow = read(name);

    expect(workflow).not.toMatch(/node-version:\s*["']?20\b/);
    expect(workflow).toMatch(/node-version:\s*["']?22\b/);
  });
});
