import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getRequiredPhotoFields,
  isChecklistComplete,
  REQUIRED_CHECKLIST_FIELDS,
} from "@/features/checklist/checklist-rules";

/**
 * The Maestro checklist flow (.maestro/04b-frota-checklist.yaml) only runs on
 * an emulator, so a drift between it and the inspection rules would surface
 * hours later as a disabled "Criar Checklist". This keeps the flow honest on
 * every unit run: what it answers and photographs must make the form complete,
 * and every handle it taps must exist in the form.
 */
const root = resolve(__dirname, "..", "..");
const flow = readFileSync(resolve(root, ".maestro/04b-frota-checklist.yaml"), "utf8");
const form = readFileSync(
  resolve(root, "components/screens/checklist/checklist-form.tsx"),
  "utf8",
);

// The labels the flow taps and the value the rules see; the test below pins
// them to the form's option arrays (booleans are stored as "true" there).
const OPTION_VALUES: Record<string, string | boolean> = {
  Bom: "good",
  Sim: true,
  Aprovado: "approved",
};

function answeredFields(): Record<string, string | boolean> {
  const answers: Record<string, string | boolean> = {};
  const pattern =
    /file: subflows\/checklist-answer\.yaml\s+env:\s+FIELD: ([a-z_]+)\s+OPTION: "([^"]+)"/g;
  for (const [, field, label] of flow.matchAll(pattern)) {
    expect(OPTION_VALUES, `opção desconhecida: ${label}`).toHaveProperty(label);
    answers[field] = OPTION_VALUES[label];
  }
  return answers;
}

function photographedFields(): string[] {
  const pattern = /file: subflows\/checklist-photo\.yaml\s+env:\s+FIELD: ([a-z_]+)/g;
  return [...flow.matchAll(pattern)].map(([, field]) => field);
}

describe("the checklist Maestro flow", () => {
  it("answers and photographs enough to enable sending", () => {
    const values = {
      // The form defaults the date to today and the flow types this km.
      checklist_date: "2026-10-06T10:00:00.000Z",
      current_mileage: 50_200,
      ...answeredFields(),
    };
    const photos = Object.fromEntries(
      photographedFields().map((field) => [field, { length: 1 }]),
    );

    expect(flow).toContain('inputText: "50200"');
    expect(
      isChecklistComplete({
        values,
        photos,
        isDriver: true,
        stepData: { driverId: "driver-1" },
      }),
    ).toBe(true);
    // Happy path: exactly the photos the rules owe, nothing extra to maintain.
    expect(photographedFields().sort()).toEqual(
      getRequiredPhotoFields(values).sort(),
    );
  });

  it("every option the flow taps exists in the form with the same value", () => {
    // A renamed label ("Bom" -> "Boa") would leave the emulator run stuck on
    // a missing option while the rules above still pass.
    for (const [label, value] of Object.entries(OPTION_VALUES)) {
      expect(form).toContain(`{ label: "${label}", value: "${String(value)}" }`);
    }
  });

  it("waits for the async km notice to settle before scrolling", () => {
    const photo = flow.search(/FIELD: current_mileage\r?\n/);
    const settle = flow.search(/extendedWaitUntil:\r?\n\s+visible: "Enviar assim"/);
    const nextAnswer = flow.indexOf("file: subflows/checklist-answer.yaml");

    expect(settle).toBeGreaterThan(photo);
    expect(settle).toBeLessThan(nextAnswer);
    expect(flow.slice(settle, nextAnswer)).toContain("optional: true");
    // And a late notice is dismissed before sending.
    expect(flow.lastIndexOf('tapOn: "Enviar assim"')).toBeGreaterThan(
      flow.lastIndexOf("FIELD: overall_condition"),
    );
  });

  it("the photo button announces the action and the required state to the screen reader", () => {
    const section = readFileSync(
      resolve(root, "components/screens/checklist/checklist-photo-section.tsx"),
      "utf8",
    );
    const label = /accessibilityLabel=\{`\$\{label\}([^`]*)`\}\s+testID=\{`checklist-photo-/.exec(
      section,
    );

    expect(label, "rótulo do botão de foto").not.toBeNull();
    expect(label?.[1]).toContain("adicionar foto");
    expect(label?.[1]).toContain("adicionar mais fotos");
    expect(label?.[1]).toContain("obrigatório");
  });

  it("every answered item has its handle in the form", () => {
    const answered = Object.keys(answeredFields());
    const expected = REQUIRED_CHECKLIST_FIELDS.filter(
      (field) => field !== "checklist_date" && field !== "current_mileage",
    );

    expect(answered.sort()).toEqual([...expected].sort());
    for (const field of [...answered, "current_mileage"]) {
      expect(form).toContain(`testID="checklist-${field}"`);
    }
  });
});
