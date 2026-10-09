import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createDraftChangeGate } from "../../features/submissions/draft-change-gate";

/**
 * Found on the emulator: the refuelling form, opened for the first time,
 * already showed "Descartar rascunho" — the screen's own fills (vehicle
 * defaults, GPS position) scheduled a draft save as if the driver had typed.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("the draft change gate", () => {
  it("ignores the screen's own fills, which leave the form clean", () => {
    const gate = createDraftChangeGate();

    expect(gate.accepts({ isDirty: false })).toBe(false);
    expect(gate.accepts({})).toBe(false);
  });

  it("accepts the driver's first edit and every change after it", () => {
    const gate = createDraftChangeGate();

    expect(gate.accepts({ isDirty: true })).toBe(true);
    // Erasing back to the initial value is clean again, and must still be
    // saved, or the old text would come back with the draft.
    expect(gate.accepts({ isDirty: false })).toBe(true);
  });

  it("starts over after a discard", () => {
    const gate = createDraftChangeGate();
    gate.accepts({ isDirty: true });

    gate.reset();

    expect(gate.accepts({ isDirty: false })).toBe(false);
  });

  it.each(["features/fuel/hooks/use-fuel.ts", "features/checklist/hooks/use-checklist.ts"])(
    "gates the form subscription of %s and resets on discard",
    (path) => {
      const source = fs.readFileSync(join(ROOT, path), "utf8");

      expect(source).toMatch(/formState: \{ values: true, isDirty: true \}/);
      expect(source).toMatch(/if \(draftChangeGate\.accepts\(state\)\) draft\.schedule\(\);/);
      expect(source).toMatch(/reset\(\);\s*draftChangeGate\.reset\(\);/);
      expect(source).not.toMatch(/callback: \(\) => draft\.schedule\(\)/);
    },
  );
});
