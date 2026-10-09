import fs from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { inputFieldStateClasses } from "../../utils/input-field-classes";

/**
 * Found on the emulator (dark theme, login): after leaving the e-mail field
 * with "motorista" the message showed, but the field kept the neutral fill
 * and border. NativeWind resolves two classes of the same property by
 * stylesheet order, not by their order in className, so the error classes
 * appended after "bg-subtle border-input" lost.
 */
const COLOR_CLASS = /^(bg|border|text)-(?!base$|sm$|lg$|xs$|top$)[a-z-]+(\/\d+)?$/;

function colorClassesByProperty(classes: string): Record<string, string[]> {
  const byProperty: Record<string, string[]> = {};
  for (const name of classes.split(/\s+/).filter((c) => COLOR_CLASS.test(c))) {
    const property = name.split("-")[0];
    (byProperty[property] ??= []).push(name);
  }
  return byProperty;
}

describe("input field state classes", () => {
  const states = [true, false].flatMap((focused) =>
    [true, false].flatMap((error) => [true, false].map((editable) => ({ focused, error, editable }))),
  );

  it.each(states)("gives exactly one border, background and text colour for %o", (state) => {
    const byProperty = colorClassesByProperty(inputFieldStateClasses(state));
    expect(byProperty.bg).toHaveLength(1);
    expect(byProperty.border).toHaveLength(1);
    expect(byProperty.text).toHaveLength(1);
  });

  it("shows the error over focus and over read-only", () => {
    for (const focused of [true, false]) {
      for (const editable of [true, false]) {
        const classes = inputFieldStateClasses({ focused, error: true, editable });
        expect(classes).toContain("border-destructive");
        expect(classes).toContain("bg-destructive-soft");
      }
    }
  });

  it("uses the focus fill only on a valid, editable field", () => {
    expect(inputFieldStateClasses({ focused: true, error: false, editable: true })).toContain("bg-card");
    expect(inputFieldStateClasses({ focused: true, error: false, editable: false })).toContain("bg-subtle");
    expect(inputFieldStateClasses({ focused: false, error: false, editable: false })).toContain("text-muted");
  });

  it("is what Input uses, with no colour class left in its base className", () => {
    const source = fs.readFileSync(resolve(__dirname, "..", "..", "components/ui/Input.tsx"), "utf8");
    expect(source).toContain("inputFieldStateClasses(");

    const base = source.match(/className=\{cn\(\s*"([^"]*)"/)?.[1];
    expect(base).toBeDefined();
    expect(colorClassesByProperty(base ?? "")).toEqual({});
  });
});
