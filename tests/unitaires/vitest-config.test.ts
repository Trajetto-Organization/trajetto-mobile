import { configDefaults } from "vitest/config";
import { describe, expect, it } from "vitest";

import config from "../../vitest.config";

/**
 * Stryker leaves full copies of the app under .stryker-tmp/sandbox-*; a plain
 * `npx vitest run` collected them too and a stale copy failed (wave 4).
 */
describe("vitest.config.ts", () => {
  const exclude = (config as { test?: { exclude?: string[] } }).test?.exclude ?? [];

  it("keeps Vitest's default excludes", () => {
    expect(exclude).toEqual(expect.arrayContaining([...configDefaults.exclude]));
  });

  it("never collects the tests copied into Stryker's sandboxes", () => {
    expect(exclude).toContain(".stryker-tmp/**");
  });
});
