import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { logoutWarning } from "@/features/submissions/logout-rules";

/**
 * "Sair da conta" on the access-denied screen warns first (MOB-15).
 *
 * A driver made inactive mid-shift lands on `ProtectedRoute`'s denial with
 * proofs still queued on the phone. The drawer's logout counts them and says
 * they stay behind; this screen's button called `logout()` straight away,
 * so on a phone shared between shifts the proofs sat there with nobody told.
 * It now opens the same `LogoutModal`, without the queue actions a denied
 * session cannot take (`canActOnQueue={false}`).
 *
 * The warning itself is the pure rule tested in logout-warning.test.ts; the
 * screen cannot be rendered here, so its wiring is read as text.
 */
const read = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8").replace(/\r\n/g, "\n");

describe("the access-denied screen", () => {
  const screen = read("components/protected-route.tsx");

  it("signs out through the warning modal", () => {
    expect(screen).toMatch(
      /import \{ SignOutButton \} from "\.\/ui\/logout-modal";/,
    );
    expect(screen).toContain("<SignOutButton />");
  });

  it("never signs out without it", () => {
    expect(screen).not.toMatch(/logout\(\)/);
    expect(screen).not.toMatch(/state\.logout/);
  });
});

describe("the sign-out button it uses", () => {
  const modal = read("components/ui/logout-modal.tsx");

  it("opens the modal without the queue actions of a denied session", () => {
    const button = modal.slice(modal.indexOf("export const SignOutButton"));

    expect(button).toContain("<LogoutModal");
    expect(button).toContain("canActOnQueue={false}");
  });

  it("still tells a denied session what stays on the phone", () => {
    const warning = logoutWarning(
      { pending: 2, failed: 0, parked: 0, unclaimed: 0, drafts: 1 },
      { isOffline: false, sendIncomplete: false, canActOnQueue: false },
    );

    expect(warning.hasRisk).toBe(true);
    expect(warning.lines.length).toBeGreaterThan(0);
    expect(warning.canSendNow).toBe(false);
    expect(warning.canReviewQueue).toBe(false);
  });
});
