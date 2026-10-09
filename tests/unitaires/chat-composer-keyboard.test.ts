import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The chat composer rises with the keyboard (MOB-17).
 *
 * With edge-to-edge (SDK 54) Android no longer resizes the window for the
 * keyboard, so a screen has to avoid it itself. The chat's
 * `KeyboardAvoidingView` had `behavior={ios ? "padding" : undefined}` — on
 * this Android-only app, no behaviour at all — and the composer the driver
 * types in stayed under the keyboard.
 *
 * A tripwire, like delivery-screens-keyboard.test.ts: the screen cannot be
 * rendered here, so it is read and held to the app's convention (the one
 * login, refuelling, checklist, proof and occurrence use). Seeing it on a
 * device is still the proof of the layout.
 */
const source = readFileSync(
  resolve(__dirname, "../..", "app/(protected)/(tabs)/chat.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("the chat screen", () => {
  const open = source.indexOf('<KeyboardAvoidingView className="flex-1" behavior="padding">');
  const close = source.lastIndexOf("</KeyboardAvoidingView>");

  it("avoids the keyboard the way the rest of the app does", () => {
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
  });

  it("has no platform branch that leaves Android without a behaviour", () => {
    expect(source).not.toMatch(/behavior=\{Platform\.OS/);
  });

  it("keeps the composer inside it, so it rises with the keyboard", () => {
    const composer = source.indexOf("<ChatComposer");

    expect(composer).toBeGreaterThan(open);
    expect(composer).toBeLessThan(close);
  });

  it("keeps the conversation inside it, so the list shrinks instead of hiding", () => {
    const body = source.indexOf("{renderBody()}");

    expect(body).toBeGreaterThan(open);
    expect(body).toBeLessThan(close);
  });
});
