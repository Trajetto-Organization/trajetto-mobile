import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The field being typed in, and the button that sends it, stay above the
 * keyboard (MOB-17).
 *
 * With edge-to-edge (SDK 54) Android no longer resizes the window for the
 * keyboard: a screen that does not avoid it itself leaves its lower fields
 * and its footer underneath. The proof and occurrence screens had no
 * `KeyboardAvoidingView` at all, with "Quem recebeu" and the description
 * right above a fixed footer.
 *
 * A screen cannot be rendered in this runner, so this reads the screens and
 * holds them to the app's convention (the one login, refuelling and
 * checklist use): one `KeyboardAvoidingView` with `behavior="padding"`
 * wrapping both the fields and the footer button. It still has to be seen on
 * a device; this keeps it from quietly going away.
 */

const SCREENS = [
  { file: "app/(protected)/delivery-proof.tsx", submit: "Confirmar entrega" },
  // The header says it too; the button is the last one.
  { file: "app/(protected)/delivery-occurrence.tsx", submit: "Registrar ocorrência" },
];

const read = (file: string) =>
  readFileSync(resolve(__dirname, "../..", file), "utf8");

describe.each(SCREENS)("$file", ({ file, submit }) => {
  const source = read(file);

  const open = source.indexOf('<KeyboardAvoidingView behavior="padding"');
  const close = source.lastIndexOf("</KeyboardAvoidingView>");

  it("avoids the keyboard the way the rest of the app does", () => {
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
  });

  it("keeps every text field inside it", () => {
    const fields = [...source.matchAll(/<Input\b/g)].map((match) => match.index!);

    expect(fields.length).toBeGreaterThan(0);

    for (const field of fields) {
      expect(field).toBeGreaterThan(open);
      expect(field).toBeLessThan(close);
    }
  });

  it("keeps the send button inside it, so it rises with the keyboard", () => {
    const button = source.lastIndexOf(submit);

    expect(button).toBeGreaterThan(open);
    expect(button).toBeLessThan(close);
  });

  it("lets a tap on the button through while the keyboard is open", () => {
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });
});
