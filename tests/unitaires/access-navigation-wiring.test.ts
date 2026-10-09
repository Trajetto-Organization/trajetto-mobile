import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Where the access rules meet the navigators (decision 4.2, MOB-02, MOB-10).
 *
 * A tripwire, not behavioural evidence: the behaviour is proven by the pure
 * rules in app-access.test.ts (which session gets which surface, tab and
 * landing). These only pin that the layouts still read those rules — the
 * part a refactor could quietly drop: `/fuel` and `/checklist` registered
 * with the fleet module off, a tab list that is not `appTabs`, the chat
 * reconciliation firing for sessions without Entregas. Whether expo-router
 * honours the guards is for the emulator E2E (decision 13.4).
 *
 * TSX layouts have no renderer here, so they are read as text, as in
 * diagnostics-wiring.test.ts.
 */
const read = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8").replace(/\r\n/g, "\n");

/** The block of a `<X.Protected guard={...}>` … `</X.Protected>`. */
const guardedBlock = (source: string, guard: string): string => {
  const start = source.indexOf(`guard={${guard}}>`);
  if (start === -1) return "";

  const end = source.indexOf(".Protected>", start);
  return source.slice(start, end);
};

describe("the protected stack", () => {
  const layout = read("app/(protected)/_layout.tsx");

  it("only registers the fleet forms when the session may use them", () => {
    expect(guardedBlock(layout, "surfaces.fuel")).toMatch(
      /<Stack\.Screen name="fuel" \/>/,
    );
    expect(guardedBlock(layout, "surfaces.checklist")).toMatch(
      /<Stack\.Screen name="checklist" \/>/,
    );
  });

  it("only registers the delivery screens with Entregas", () => {
    const block = guardedBlock(layout, "surfaces.deliveries");

    for (const screen of ["delivery-detail", "delivery-proof", "delivery-occurrence"]) {
      expect(block).toContain(`<Stack.Screen name="${screen}" />`);
    }
  });

  it("only lets a MASTER reach the company picker", () => {
    expect(guardedBlock(layout, "surfaces.selectBusiness")).toContain(
      '<Stack.Screen name="select-business" />',
    );
  });

  it("mounts the chat and deliveries realtime only with Entregas (MOB-10)", () => {
    expect(layout).toMatch(
      /\{surfaces\.deliveries \? <DeliveriesRealtime \/> : null\}/,
    );

    // Called inside that component and nowhere else in the layout.
    const realtime = layout.slice(
      layout.indexOf("const DeliveriesRealtime"),
      layout.indexOf("const ProtectedLayout"),
    );

    for (const hook of ["useChatRealtime()", "useMyDeliveries()", "useRouteRealtime()"]) {
      expect(realtime).toContain(hook);
      expect(layout.split(hook)).toHaveLength(2);
    }
  });

  it("asks for a MASTER's company plan", () => {
    expect(layout).toContain("useBusinessModules();");
  });
});

describe("the tabs", () => {
  const tabs = read("app/(protected)/(tabs)/_layout.tsx");

  it("register each tab by the tab list the rules give (appTabs)", () => {
    for (const name of ["vehicles", "deliveries", "chat"]) {
      expect(guardedBlock(tabs, `tabs.includes("${name}")`)).toContain(
        `<Tabs.Screen name="${name}" />`,
      );
    }
  });

  it("draw the bar from the routes the navigator actually has", () => {
    expect(tabs).toMatch(
      /state\.routes\.some\(\(route\) => route\.name === tab\.name\)/,
    );
  });
});

describe("the Início (home) tab", () => {
  const home = read("app/(protected)/(tabs)/vehicles.tsx");

  it("never sends the session away: it is the tab with the account", () => {
    // A redirect here is what left a deliveries-only driver with no header,
    // no bell and no "Sair da conta".
    expect(home).not.toMatch(/<Redirect\b/);
    expect(home).toContain("homeNotice(home");
  });
});

describe("where the app opens", () => {
  it("is decided by the same rules", () => {
    expect(read("app/index.tsx")).toMatch(
      /isAuthenticated \? landingHref\(user\) : "\/login"/,
    );
  });
});
