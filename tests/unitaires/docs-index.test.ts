import fs from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The repository's documentation is one consolidated set (docs/arquitetura.md,
 * testes.md, deploy.md, variaveis-de-ambiente.md) plus the README and the
 * agent guides. The old files (DEPLOY.md, e2e.md, tema.md,
 * ota-code-signing.md, pre-checagem-offline.md) were folded into it; a comment
 * or a link still pointing at one of them sends the next reader nowhere.
 */
const ROOT = resolve(__dirname, "..", "..");
const read = (path: string) => fs.readFileSync(join(ROOT, path), "utf8");

const DOCS = ["arquitetura.md", "deploy.md", "testes.md", "variaveis-de-ambiente.md"];
const FOLDED = ["DEPLOY.md", "e2e.md", "tema.md", "ota-code-signing.md", "pre-checagem-offline.md"];
const GUIDES = ["README.md", "CLAUDE.md", "AGENTS.md"];

const SKIP_DIRS = new Set([".git", "node_modules", "coverage", ".expo", ".stryker-tmp", "reports", "android", "ios", "dist"]);

const textFiles = (dir: string): string[] =>
  fs.readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : textFiles(path);
    return /\.(tsx?|jsx?|mjs|cjs|json|ya?ml|md|sh|toml|jsonc)$|^\.(env\.example|gitignore|easignore)$/.test(entry.name)
      ? [path]
      : [];
  });

/** Relative markdown links of a file, anchors dropped. */
const localLinks = (text: string) =>
  [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => target.split("#")[0]);

describe("the documentation set", () => {
  it("has exactly the consolidated documents in docs/", () => {
    const present = fs.readdirSync(join(ROOT, "docs")).filter((name) => name.endsWith(".md"));

    expect(present.sort()).toEqual([...DOCS].sort());
  });

  it("has the README and both agent guides at the root", () => {
    for (const guide of GUIDES) expect(fs.existsSync(join(ROOT, guide)), guide).toBe(true);
  });

  it("keeps no reference to a folded document anywhere in the repository", () => {
    const pattern = new RegExp(`docs/(${FOLDED.map((name) => name.replace(".", "\\.")).join("|")})\\b`);
    const stale = textFiles("").filter((file) => file !== "package-lock.json" && pattern.test(read(file)));

    expect(stale).toEqual([]);
  });

  it("links only to files that exist", () => {
    const broken = [...GUIDES, ...DOCS.map((name) => `docs/${name}`)].flatMap((file) =>
      localLinks(read(file))
        .filter((target) => !fs.existsSync(resolve(ROOT, dirname(file), target)))
        .map((target) => `${file} -> ${target}`),
    );

    expect(broken).toEqual([]);
  });

  it("keeps CLAUDE.md and AGENTS.md on the same rules", () => {
    const core = (file: string) => read(file).slice(read(file).indexOf("## O que é este repositório"));

    expect(core("CLAUDE.md").length).toBeGreaterThan(1000);
    expect(core("CLAUDE.md")).toBe(core("AGENTS.md"));
  });

  it("documents every workflow and every EXPO_PUBLIC_* variable", () => {
    const deploy = read("docs/deploy.md");
    for (const workflow of fs.readdirSync(join(ROOT, ".github/workflows"))) {
      expect(deploy, workflow).toContain(`\`${workflow}\``);
    }

    const variables = read("docs/variaveis-de-ambiente.md");
    const declared = [...read(".env.example").matchAll(/^(EXPO_PUBLIC_[A-Z0-9_]+)=/gm)].map((match) => match[1]);

    expect(declared.length).toBeGreaterThan(0);
    for (const name of [...declared, "APP_ENV", "GOOGLE_SERVICES_JSON", "EXPO_TOKEN", "EXPO_UPDATE_PRIVATE_KEY", "API_REPO_READ_TOKEN", "PLAY_SUBMIT_ENABLED"]) {
      expect(variables, name).toContain(`\`${name}\``);
    }
  });
});
