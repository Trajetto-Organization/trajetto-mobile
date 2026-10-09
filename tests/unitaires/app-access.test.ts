import { describe, expect, it } from "vitest";

import {
  enabledModulesFromEntitlements,
  hasDeliveriesAccess,
  hasModule,
  moduleOfSubmission,
  modulesAfterServerRefresh,
  modulesKnown,
  withSessionModules,
} from "@/features/access/module-rules";
import {
  ACCOUNT_TAB,
  HOME_ACTION_LABEL,
  appSurfaces,
  appTabs,
  homeNotice,
  homeState,
  landingHref,
} from "@/features/access/app-surfaces";
import { hasDeliveriesAccess as deliveryRulesAccess } from "@/features/deliveries/delivery-rules";

import type { User } from "@/types";

/**
 * What the app offers each kind of session, per hired module (decisions
 * 4.2/4.3, MOB-02, CRIT-20).
 *
 * The matrix the inventory asks for — MASTER, admin, office user with and
 * without write, read-only, driver, company without the module — against the
 * one function every tab, card, screen guard and redirect reads.
 */
const asUser = (extra: Partial<User>): User =>
  ({
    id: "u1",
    name: "Alguém",
    email: "alguem@exemplo.com.br",
    role: "BUSINESS_USER",
    businessId: "b1",
    ...extra,
  }) as User;

const profile = (
  ...permissions: Array<[string, boolean, boolean]>
): Partial<User> =>
  ({
    profileAccess: {
      name: "Perfil",
      permissions: permissions.map(([permissionKey, canRead, canWrite]) => ({
        permissionKey,
        canRead,
        canWrite,
      })),
    },
  }) as unknown as Partial<User>;

const BOTH = ["FLEET", "DELIVERIES"];

describe("a driver", () => {
  it("of a company with both modules gets the fleet home and the deliveries", () => {
    const driver = asUser({ driverId: "d1", enabledModules: BOTH });

    expect(appSurfaces(driver)).toEqual({
      fleetHome: true,
      fuel: true,
      checklist: true,
      deliveries: true,
      selectBusiness: false,
    });
    expect(homeState(driver)).toEqual({ kind: "fleet" });
    expect(landingHref(driver)).toBe("/vehicles");
    expect(appTabs(driver)).toEqual(["vehicles", "deliveries", "chat"]);
  });

  it("of a company with only Entregas lands on the deliveries and keeps Início for the account", () => {
    // The vehicle list had nothing to offer here but a lock on every card, so
    // Início says where the work is. It is NOT removed: its header is the
    // only place with the bell and "Sair da conta" — without it this driver
    // could not sign out at all.
    const driver = asUser({ driverId: "d1", enabledModules: ["DELIVERIES"] });

    expect(appSurfaces(driver)).toMatchObject({
      fleetHome: false,
      fuel: false,
      checklist: false,
      deliveries: true,
    });
    expect(homeState(driver)).toEqual({ kind: "deliveries" });
    expect(landingHref(driver)).toBe("/deliveries");
    expect(appTabs(driver)).toEqual(["vehicles", "deliveries", "chat"]);

    expect(homeNotice(homeState(driver))).toEqual({
      icon: "cube-outline",
      title: "Suas entregas ficam na aba Entregas",
      message:
        "As rotas, as entregas do dia e o chat estão nas abas abaixo. Aqui ficam as notificações e a sua conta.",
      actions: ["open-deliveries", "notifications"],
    });
  });

  it("of a company with only Gestão de Frota gets no deliveries and no chat", () => {
    const driver = asUser({ driverId: "d1", enabledModules: ["FLEET"] });

    expect(appSurfaces(driver)).toMatchObject({
      fleetHome: true,
      fuel: true,
      deliveries: false,
    });
    expect(landingHref(driver)).toBe("/vehicles");
    expect(appTabs(driver)).toEqual(["vehicles"]);
  });

  it("of a company with neither is told it is the company's plan, not the profile", () => {
    const driver = asUser({ driverId: "d1", enabledModules: [] });

    expect(homeState(driver)).toEqual({ kind: "no-app-access", reason: "plan" });

    // The only tab left: a tab navigator with no screen would crash.
    expect(appTabs(driver)).toEqual(["vehicles"]);
  });
});

describe("an office user", () => {
  it("with only delivery_manage (control tower) gets in and is shown nothing here", () => {
    // CRIT-20: allowed in (notifications reach them), no fleet screen, and
    // the deliveries surface of the app is the DRIVER's list.
    const operator = asUser({
      enabledModules: BOTH,
      ...profile(["delivery_manage", true, true]),
    });

    expect(appSurfaces(operator)).toEqual({
      fleetHome: false,
      fuel: false,
      checklist: false,
      deliveries: false,
      selectBusiness: false,
    });
    // No plan would give them a screen here: it is the profile.
    expect(homeState(operator)).toEqual({
      kind: "no-app-access",
      reason: "profile",
    });
    expect(landingHref(operator)).toBe("/vehicles");
  });

  it("read-only on vehicles sees the list and no form", () => {
    const reader = asUser({
      enabledModules: BOTH,
      ...profile(["vehicle_manage", true, false]),
    });

    expect(appSurfaces(reader)).toMatchObject({
      fleetHome: true,
      fuel: false,
      checklist: false,
    });
  });

  it("with the fleet permissions but without the module sees nothing of the fleet", () => {
    const refueller = asUser({
      enabledModules: ["DELIVERIES"],
      ...profile(
        ["vehicle_manage", true, false],
        ["fuel_manage", true, true],
        ["vehicle_checklist_manage", true, true],
      ),
    });

    expect(appSurfaces(refueller)).toMatchObject({
      fleetHome: false,
      fuel: false,
      checklist: false,
    });
    // Their profile has the fleet; the company hired Entregas, not the fleet.
    // "No app module hired" would be false: Entregas is in the app, for the
    // drivers.
    expect(homeState(refueller)).toEqual({
      kind: "no-app-access",
      reason: "profile-not-in-plan",
    });

    // With nothing hired at all, it is the plan alone.
    expect(homeState({ ...refueller, enabledModules: [] })).toEqual({
      kind: "no-app-access",
      reason: "plan",
    });
  });
});

describe("an administrator", () => {
  it("of a company without Gestão de Frota has no fleet home", () => {
    const admin = asUser({ role: "BUSINESS_ADMIN", enabledModules: ["DELIVERIES"] });

    expect(appSurfaces(admin)).toMatchObject({
      fleetHome: false,
      fuel: false,
      checklist: false,
      // Not a driver: the app's deliveries are a driver's own list.
      deliveries: false,
    });
    // The company did hire an app module — Entregas, whose app screens are
    // the drivers'. Not "nenhum módulo contratado".
    expect(homeState(admin)).toEqual({
      kind: "no-app-access",
      reason: "profile-not-in-plan",
    });
    expect(homeNotice(homeState(admin))?.title).toBe(
      "Sem telas do aplicativo para o seu perfil",
    );
  });

  it("of a company with no app module is told it is the plan", () => {
    const admin = asUser({ role: "BUSINESS_ADMIN", enabledModules: [] });

    expect(homeState(admin)).toEqual({ kind: "no-app-access", reason: "plan" });
    expect(homeNotice(homeState(admin))?.title).toBe(
      "Nenhum módulo do aplicativo contratado",
    );
  });

  it("of a company with modules the app does not have is told it is the plan", () => {
    // Only FLEET and DELIVERIES have screens here; any other hired module
    // does not make "no app module hired" false.
    const admin = asUser({ role: "BUSINESS_ADMIN", enabledModules: ["OUTRO"] });

    expect(homeState(admin)).toEqual({ kind: "no-app-access", reason: "plan" });
  });
});

describe("a company user cached by a build from before the plan was on the session", () => {
  // main's app persisted users without `enabledModules`; `checkAuth` keeps
  // that cached user when it cold-starts offline right after the update.
  const cachedDriver = asUser({ driverId: "d1", enabledModules: undefined });

  it("keeps refuelling and checklists offline instead of 'painel web'", () => {
    expect(homeState(cachedDriver)).toEqual({ kind: "fleet" });
    expect(appSurfaces(cachedDriver)).toMatchObject({
      fleetHome: true,
      fuel: true,
      checklist: true,

      // Those builds had no Entregas: nothing new is invented.
      deliveries: false,
    });
  });

  it("follows the server's plan as soon as /user/me answers", () => {
    expect(
      appSurfaces({ ...cachedDriver, enabledModules: ["DELIVERIES"] }),
    ).toMatchObject({ fuel: false, checklist: false, deliveries: true });
  });

  it("does not change a MASTER, whose unknown plan is still waited for", () => {
    expect(
      homeState(asUser({ role: "MASTER", businessId: "b2", enabledModules: undefined })),
    ).toEqual({ kind: "checking-modules" });
  });
});

describe("every session", () => {
  // The access matrix: whatever the role, profile and plan, the account tab
  // is registered, and Início has something to say on it.
  const sessions: Array<[string, User]> = [
    ["driver, both modules", asUser({ driverId: "d1", enabledModules: BOTH })],
    ["driver, only Entregas", asUser({ driverId: "d1", enabledModules: ["DELIVERIES"] })],
    ["driver, only Gestão de Frota", asUser({ driverId: "d1", enabledModules: ["FLEET"] })],
    ["driver, no module", asUser({ driverId: "d1", enabledModules: [] })],
    ["driver cached by an older build", asUser({ driverId: "d1" })],
    [
      "control-tower operator",
      asUser({ enabledModules: BOTH, ...profile(["delivery_manage", true, true]) }),
    ],
    [
      "read-only office user",
      asUser({ enabledModules: BOTH, ...profile(["vehicle_manage", true, false]) }),
    ],
    ["admin, only Entregas", asUser({ role: "BUSINESS_ADMIN", enabledModules: ["DELIVERIES"] })],
    ["admin, both", asUser({ role: "BUSINESS_ADMIN", enabledModules: BOTH })],
    ["MASTER without a company", asUser({ role: "MASTER", businessId: null })],
    ["MASTER waiting for a plan", asUser({ role: "MASTER", businessId: "b2" })],
    [
      "MASTER on a company without the fleet",
      asUser({ role: "MASTER", businessId: "b2", enabledModules: ["DELIVERIES"] }),
    ],
  ];

  it.each(sessions)("keeps the tab with the way to sign out: %s", (_, user) => {
    expect(appTabs(user)).toContain(ACCOUNT_TAB);
    expect(appTabs(user)[0]).toBe(ACCOUNT_TAB);
  });

  it.each(sessions)("has something on Início: %s", (_, user) => {
    const home = homeState(user);

    // The list, the company picker and the plan check are screens of their
    // own; every other state is a message with a way forward.
    if (["fleet", "select-business", "checking-modules"].includes(home.kind)) {
      expect(homeNotice(home)).toBeNull();
      return;
    }

    const notice = homeNotice(home);
    expect(notice?.title).toBeTruthy();
    expect(notice?.actions.length).toBeGreaterThan(0);
  });
});

describe("what Início says when nothing here is the session's", () => {
  it("blames the company's plan when it hired no app module", () => {
    expect(homeNotice({ kind: "no-app-access", reason: "plan" })).toEqual({
      icon: "lock-closed-outline",
      title: "Nenhum módulo do aplicativo contratado",
      message:
        "Sua empresa não contratou módulos disponíveis no aplicativo. As notificações continuam chegando aqui; o restante fica no painel web.",
      actions: ["notifications", "web-panel"],
    });
  });

  it("says the plan does not cover the profile when it hired app modules for others", () => {
    expect(
      homeNotice({ kind: "no-app-access", reason: "profile-not-in-plan" }),
    ).toEqual({
      icon: "lock-closed-outline",
      title: "Sem telas do aplicativo para o seu perfil",
      message:
        "O plano da sua empresa não inclui as telas do aplicativo para o seu perfil. As notificações continuam chegando aqui; o restante fica no painel web.",
      actions: ["notifications", "web-panel"],
    });
  });

  it("blames the profile only when no plan would", () => {
    expect(homeNotice({ kind: "no-app-access", reason: "profile" })).toEqual({
      icon: "desktop-outline",
      title: "Seu acesso é pelo painel web",
      message:
        "Seu perfil não inclui telas do aplicativo. As notificações continuam chegando aqui; o restante fica no painel web.",
      actions: ["notifications", "web-panel"],
    });
  });

  it("names the missing module only to a MASTER, with the company", () => {
    const home = { kind: "module-not-enabled", module: "FLEET" } as const;

    expect(homeNotice(home, "Transportes Silva")?.message).toBe(
      "Transportes Silva não contratou o módulo Gestão de Frota. Troque de empresa ou habilite o módulo pelo painel web.",
    );
    expect(homeNotice(home, null)?.message).toMatch(/^A empresa selecionada não contratou/);
    expect(homeNotice(home)?.actions).toEqual(["switch-business", "web-panel"]);
  });

  it("labels each way forward", () => {
    expect(HOME_ACTION_LABEL).toEqual({
      "open-deliveries": "Abrir entregas",
      notifications: "Ver notificações",
      "switch-business": "Trocar de empresa",
      "web-panel": "Abrir painel web",
    });
  });
});

describe("a MASTER", () => {
  it("without a company is asked to pick one", () => {
    expect(homeState(asUser({ role: "MASTER", businessId: null }))).toEqual({
      kind: "select-business",
    });
  });

  it("waits for the plan of a company just picked instead of guessing", () => {
    const master = asUser({ role: "MASTER", businessId: "b2" });

    expect(modulesKnown(master)).toBe(false);
    expect(homeState(master)).toEqual({ kind: "checking-modules" });
    expect(appSurfaces(master).fuel).toBe(false);
  });

  it("on a company without Gestão de Frota sees the 'not hired' state (decision 4.3)", () => {
    const master = asUser({
      role: "MASTER",
      businessId: "b2",
      enabledModules: ["DELIVERIES"],
    });

    expect(homeState(master)).toEqual({
      kind: "module-not-enabled",
      module: "FLEET",
    });
    expect(appSurfaces(master)).toMatchObject({ fuel: false, checklist: false });
  });

  it("on a company with it works the fleet like an admin", () => {
    const master = asUser({
      role: "MASTER",
      businessId: "b1",
      enabledModules: ["FLEET"],
    });

    expect(homeState(master)).toEqual({ kind: "fleet" });
    expect(appSurfaces(master)).toMatchObject({
      fuel: true,
      checklist: true,
      selectBusiness: true,
    });
  });
});

describe("the modules a session keeps", () => {
  it("become unknown when a MASTER switches company", () => {
    const before = asUser({
      role: "MASTER",
      businessId: "b1",
      enabledModules: ["FLEET"],
    });

    const after = withSessionModules({ ...before, businessId: "b2" }, before);

    // The previous company's plan used to ride along to the next company.
    expect(after.enabledModules).toBeUndefined();
    expect(after.businessId).toBe("b2");
  });

  it("stay when nothing about the company changed", () => {
    const master = asUser({
      role: "MASTER",
      businessId: "b1",
      enabledModules: ["FLEET"],
    });

    expect(withSessionModules({ ...master, name: "Outro" }, master)).toMatchObject({
      enabledModules: ["FLEET"],
    });

    // A company user's plan is the server's to change, never a local edit's.
    const driver = asUser({ driverId: "d1", enabledModules: ["FLEET"] });
    expect(withSessionModules(driver, null).enabledModules).toEqual(["FLEET"]);
  });

  it("stay the selected company's when /user/me answers a MASTER with everything", () => {
    const cached = asUser({
      role: "MASTER",
      businessId: "b2",
      enabledModules: ["DELIVERIES"],
    });
    const server = asUser({
      role: "MASTER",
      businessId: null,
      enabledModules: ["FLEET", "DELIVERIES"],
    });

    expect(modulesAfterServerRefresh(server, cached)).toEqual(["DELIVERIES"]);

    // With no company in scope the server's answer stands.
    expect(
      modulesAfterServerRefresh(server, { ...cached, businessId: null }),
    ).toEqual(["FLEET", "DELIVERIES"]);
  });

  it("are always the server's for a company user", () => {
    // The only source of a plan change for them: entitlementsChanged and
    // every foreground re-read /user/me.
    const cached = asUser({ driverId: "d1", enabledModules: ["FLEET"] });
    const server = asUser({ driverId: "d1", enabledModules: [] });

    expect(modulesAfterServerRefresh(server, cached)).toEqual([]);
  });
});

describe("the company plan endpoint", () => {
  it("is read into the enabled modules only", () => {
    expect(
      enabledModulesFromEntitlements({
        data: {
          modules: [
            { module: "FLEET", enabled: false },
            { module: "DELIVERIES", enabled: true },
          ],
          vehicle_limit: 0,
        },
      }),
    ).toEqual(["DELIVERIES"]);
  });

  it("hides modules rather than inventing them from a body it does not know", () => {
    expect(enabledModulesFromEntitlements(null)).toEqual([]);
    expect(enabledModulesFromEntitlements({ data: {} })).toEqual([]);
    expect(
      enabledModulesFromEntitlements({
        data: { modules: [{ module: "FLEET", enabled: "yes" }] },
      }),
    ).toEqual([]);
  });
});

describe("the module a queued submission needs", () => {
  it("follows the kind", () => {
    expect(moduleOfSubmission("fuel")).toBe("FLEET");
    expect(moduleOfSubmission("checklist")).toBe("FLEET");
    expect(moduleOfSubmission("delivery-proof")).toBe("DELIVERIES");
    expect(moduleOfSubmission("delivery-start-route")).toBe("DELIVERIES");
    expect(moduleOfSubmission("algo-novo")).toBeNull();
  });
});

describe("deliveries access", () => {
  it("is the same rule the deliveries feature applies", () => {
    // Two copies of one rule drift; this pins them together until the
    // deliveries feature delegates to the access rules.
    const cases: Array<Partial<User>> = [
      { driverId: "d1", enabledModules: ["DELIVERIES"] },
      { driverId: "d1", enabledModules: ["FLEET"] },
      { driverId: null, enabledModules: ["DELIVERIES"] },
      { driverId: "d1" },
    ];

    for (const extra of cases) {
      const user = asUser(extra);
      expect(hasDeliveriesAccess(user)).toBe(deliveryRulesAccess(user));
    }

    expect(hasModule(null, "FLEET")).toBe(false);
  });
});
