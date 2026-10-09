import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Maestro suite (docs/testes.md, Maestro section) only runs on an emulator, so a renamed
 * testID or a flow left out of the order is found an hour into a run. This
 * holds the wiring without a device: every flow is in the order the runner
 * reads, the two-factor code step comes right after the step that issues the
 * code, and every element id a flow taps exists in the app.
 */
const ROOT = resolve(__dirname, "..", "..");
const MAESTRO = join(ROOT, ".maestro");
const read = (path: string) => fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const flowNames = fs
  .readdirSync(MAESTRO)
  .filter((name) => name.endsWith(".yaml") && name !== "config.yaml")
  .map((name) => name.replace(/\.yaml$/, ""))
  .sort();

// What scripts/e2e/run.sh extracts from config.yaml.
const order = [...read(join(MAESTRO, "config.yaml")).matchAll(/^ *- ([0-9]{2}[a-z]?-[a-z0-9-]+)$/gm)].map(
  (match) => match[1],
);

const flowFiles = [
  ...flowNames.map((name) => join(MAESTRO, `${name}.yaml`)),
  ...fs.readdirSync(join(MAESTRO, "subflows")).map((name) => join(MAESTRO, "subflows", name)),
];

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

const appSource = ["app", "components", "features"]
  .flatMap(sourceFiles)
  .map((file) => read(join(ROOT, file)))
  .join("\n");

// Ids that come from a library, not from the app's own testIDs.
const LIBRARY_IDS: Record<string, string> = {
  "otp-input": "node_modules/react-native-otp-entry/dist/OtpInput/OtpInput.js",
};

describe("the Maestro suite", () => {
  it("runs every flow, in the order of config.yaml", () => {
    expect([...order].sort()).toEqual(flowNames);
    expect(new Set(order).size).toBe(order.length);
  });

  it("asks for the two-factor code right after the login that issues it", () => {
    const login = order.indexOf("09-dois-fatores-login");
    expect(login).toBeGreaterThan(-1);
    expect(order[login + 1]).toBe("09b-dois-fatores-codigo");

    // run.sh swaps the code in for exactly the flows named like this.
    expect(read(join(ROOT, "scripts/e2e/run.sh"))).toContain("*-dois-fatores-codigo)");
  });

  it("taps only ids that exist in the app", () => {
    const ids = new Set<string>();

    for (const file of flowFiles) {
      for (const match of read(file).matchAll(/^\s*id: "?([^"\n]+?)"?\s*$/gm)) {
        const id = match[1];
        // System apps (camera), and ids built from a flow variable or a regex.
        if (id.startsWith("com.android") || id.includes("${") || /[.*|]/.test(id)) continue;
        ids.add(id);
      }
    }

    expect(ids.size).toBeGreaterThan(30);

    const missing = [...ids].filter((id) => {
      if (LIBRARY_IDS[id]) {
        return !read(join(ROOT, LIBRARY_IDS[id])).includes(`testID: "${id}"`);
      }
      // A literal testID, or the prefix of one built in the component
      // (`${testID}-confirm`, `occurrence-field-${key}-yes`, …).
      if (appSource.includes(`"${id}"`) || appSource.includes(`\`${id}\``)) return false;
      const derived = /^(.*?)-(confirm|cancel|option|yes|no)$/.exec(id);
      if (derived && appSource.includes(`"${derived[1]}"`)) return false;
      return !/^(occurrence-field|checklist|checklist-photo|pending-item|tab)-/.test(id);
    });

    expect(missing).toEqual([]);
  });
});
