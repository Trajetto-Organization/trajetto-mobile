import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The chat tab runs the chip + conversation wiring the tests mount
 * (use-chat-with-context.ts, driven by chat-send-context.test.ts).
 *
 * Before, chat.tsx wired them itself. Passing `chip.clear` as
 * `onContextRejected` still compiles (a `() => void` fits the callback), and
 * a refusal of an older send then dropped the chip the driver had just
 * opened on another delivery. The screen cannot be rendered here, so it is
 * read (as chat-composer-keyboard.test.ts does).
 */
const source = readFileSync(
  resolve(__dirname, "../..", "app/(protected)/(tabs)/chat.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

const hook = readFileSync(
  resolve(__dirname, "../..", "features/chat/hooks/use-chat-with-context.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("the chat tab's wiring", () => {
  it("comes from the hook the tests mount", () => {
    expect(source).toContain("useChatWithContext(params)");
  });

  it("is not wired a second time on the screen", () => {
    expect(source).not.toMatch(/onContextRejected/);
    expect(source).not.toMatch(/useChatConversation\(/);
    expect(source).not.toMatch(/useChatContextChip\(/);
  });

  it("drops only a chip that still cites what was refused", () => {
    expect(hook).toMatch(/onContextRejected:\s*chip\.dropRefused/);
    expect(hook).not.toMatch(/chip\.clear/);
  });

  it("leaves the × button to remove the chip", () => {
    expect(source).toContain("onClearContext={chip.clear}");
  });
});
