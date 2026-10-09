import { describe, expect, it } from "vitest";

import { systemPathFor } from "@/features/deep-links/system-path-rules";

/**
 * A link from another app or a web page (`trajetto://…`) used to open any
 * screen with any params, e.g. the chat with a subject of the sender's
 * choosing. It now opens the app at its start, or is ignored when the app
 * is already open.
 */
describe("systemPathFor", () => {
  it("opens the app at its start when a link launches it", () => {
    for (const path of [
      "trajetto://chat?ticketId=x&ticketSubject=Envie%20sua%20senha",
      "trajetto://delivery-proof?id=abc&review=1",
      "/delivery-detail?id=abc",
      "trajetto:///select-business",
      "",
    ]) {
      expect(systemPathFor(path, true, false)).toBe("/");
    }
  });

  it("ignores a link that arrives while the app is open", () => {
    expect(systemPathFor("trajetto://chat?ticketSubject=x", false, false)).toBe("");
  });

  it("keeps the dev launcher's links in development only", () => {
    const launcher = "trajetto://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081";

    expect(systemPathFor(launcher, true, true)).toBe(launcher);
    expect(systemPathFor(launcher, true, false)).toBe("/");
  });
});
