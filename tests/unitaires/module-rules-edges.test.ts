import { describe, expect, it } from "vitest";

import {
  enabledModulesFromEntitlements,
  modulesAfterServerRefresh,
  modulesKnown,
  withSessionModules,
} from "@/features/access/module-rules";

/**
 * Edges of the module gate that the mutation run (Stryker, 06/10/2026) showed
 * untested: inputs the session really sees (no user yet, a body without
 * `data`, a row that is not an object) and the role checks that decide whose
 * plan survives a `/user/me` refresh.
 */
describe("module rules: no session and malformed answers", () => {
  it("knows no plan when there is no user at all, without throwing", () => {
    expect(modulesKnown(null)).toBe(false);
  });

  it("reads an entitlements answer without `data` as no modules", () => {
    expect(enabledModulesFromEntitlements({})).toEqual([]);
  });

  it("skips rows that are null or whose module is not a string", () => {
    expect(
      enabledModulesFromEntitlements({
        data: {
          modules: [
            null,
            { module: 7, enabled: true },
            { module: "FLEET", enabled: "true" },
            { module: "DELIVERIES", enabled: true },
          ],
        },
      }),
    ).toEqual(["DELIVERIES"]);
  });

  it("drops a MASTER's plan when there was no previous session, unless the company is none", () => {
    const master = { role: "MASTER", businessId: "b1", enabledModules: ["FLEET"] };

    expect(withSessionModules(master, null).enabledModules).toBeUndefined();
    expect(
      withSessionModules({ ...master, businessId: null }, null).enabledModules,
    ).toEqual(["FLEET"]);
  });
});

describe("module rules: whose plan a /user/me refresh keeps", () => {
  const cachedMaster = {
    role: "MASTER",
    businessId: "b1",
    enabledModules: ["DELIVERIES"],
  };

  it("applies the server's plan when the server no longer calls the user a MASTER", () => {
    const server = { role: "DRIVER", businessId: null, enabledModules: ["FLEET"] };

    expect(modulesAfterServerRefresh(server, cachedMaster)).toEqual(["FLEET"]);
  });

  it("applies the server's plan when the cached session was not a MASTER", () => {
    const server = { role: "MASTER", businessId: null, enabledModules: ["FLEET"] };

    expect(
      modulesAfterServerRefresh(server, { ...cachedMaster, role: "BUSINESS_ADMIN" }),
    ).toEqual(["FLEET"]);
  });

  it("applies the server's plan when nothing was cached, without throwing", () => {
    const server = { role: "MASTER", businessId: null, enabledModules: ["FLEET"] };

    expect(modulesAfterServerRefresh(server, null)).toEqual(["FLEET"]);
  });
});
