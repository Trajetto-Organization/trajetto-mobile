import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A notification's link, opened by the driver's phone.
 *
 * The notifications screen hands `item.link` — a string from the API — to
 * `Linking.openURL`, which opens ANY scheme the OS knows: `intent://` launches
 * other apps' activities on Android, `tel:` dials, a custom scheme deep-links
 * into whatever registered it. Every policy builds the link from a template
 * today (`${baseUrl}/...`), so nothing user-typed reaches it; the day one
 * does, the phone would follow it without a question. Only web links open.
 */
const HOSTILE = [
  "javascript:alert(1)",
  "intent://scan/#Intent;scheme=zxing;package=com.evil;end",
  "tel:+5511999999999",
  "sms:+5511999999999",
  "file:///data/data/com.trajetto/files/db",
  "trajetto://settings",
  "data:text/html,<script>alert(1)</script>",
  "https://evil.example/\nfoo",
  "https:///nohost",
  "//evil.example/path",
  "/dashboard",
  "",
];

describe("openableNotificationLink", () => {
  it("opens nothing but a web link", async () => {
    const { openableNotificationLink } = await import(
      "@/features/notifications/notification-link-rules"
    );

    for (const link of HOSTILE) {
      expect(openableNotificationLink(link), JSON.stringify(link)).toBeNull();
    }

    expect(openableNotificationLink(undefined)).toBeNull();
    expect(openableNotificationLink(null)).toBeNull();
  });

  it("keeps what the API sends today", async () => {
    const { openableNotificationLink } = await import(
      "@/features/notifications/notification-link-rules"
    );

    expect(
      openableNotificationLink("https://www.intrajetto.com/dashboard/kanban?card=abc"),
    ).toBe("https://www.intrajetto.com/dashboard/kanban?card=abc");

    // `${env.HTTP_REQUEST}` is http://localhost in development.
    expect(openableNotificationLink("http://localhost:3000/dashboard")).toBe(
      "http://localhost:3000/dashboard",
    );

    expect(openableNotificationLink("  https://www.intrajetto.com/acompanhar/tok  ")).toBe(
      "https://www.intrajetto.com/acompanhar/tok",
    );
  });
});

describe("the notifications screen", () => {
  it("only opens a link that passed the check", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/(protected)/notifications.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/openURL\(\s*item\.link/);
    expect(source).toMatch(/openableNotificationLink\(item\.link\)/);
  });
});
