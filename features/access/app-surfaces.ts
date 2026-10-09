import type { User } from "@/types";

import {
  checkChecklistPermission,
  checkFuelPermission,
  checkVehiclePermission,
} from "@/utils/permissions";

import {
  APP_MODULES,
  FLEET_MODULE,
  MODULE_LABEL,
  hasDeliveriesAccess,
  hasModule,
  modulesKnown,
} from "./module-rules";

/**
 * What this session may open in the app: every tab, screen and redirect
 * derives from here (decision 4.2 — one source), so a module switched off in
 * the panel disappears everywhere at once instead of screen by screen.
 */
interface AppSurfaces {
  /** "Início" as the vehicle list: the fleet's home in the app. */
  fleetHome: boolean;

  /** The refuelling and checklist forms (and the card actions that open them). */
  fuel: boolean;
  checklist: boolean;

  /** The deliveries list, its detail/proof/occurrence screens and the chat. */
  deliveries: boolean;

  /** Only a MASTER chooses which company the app is looking at. */
  selectBusiness: boolean;
}

function appSurfaces(user: User | null): AppSurfaces {
  return {
    fleetHome:
      hasModule(user, FLEET_MODULE) && checkVehiclePermission(user).canRead,
    fuel: checkFuelPermission(user).canWrite,
    checklist: checkChecklistPermission(user).canWrite,
    deliveries: hasDeliveriesAccess(user),
    selectBusiness: user?.role === "MASTER",
  };
}

/**
 * Why nothing in the app is the session's.
 *
 * - `plan`: the company hired no module the app has, and the same session
 *   with one would have something here (a driver or an admin of a company
 *   that switched them all off).
 * - `profile-not-in-plan`: the company hired an app module, just not one this
 *   profile uses here (an admin of a company with only Entregas, whose app
 *   screens are the drivers'). Saying "no module hired" to them was false.
 * - `profile`: no plan would change it (a control-tower operator: the app's
 *   deliveries are a driver's own list).
 *
 * The screen used to blame the profile in every case.
 */
type NoAppAccessReason = "plan" | "profile-not-in-plan" | "profile";

/**
 * What "Início" shows.
 *
 * - `fleet`: the vehicle list.
 * - `deliveries`: a driver of a company with Entregas and without Gestão de
 *   Frota. Their work is on the Entregas tab (where the app opens); "Início"
 *   still exists for them, as the tab that carries the account (ACCOUNT_TAB).
 * - `module-not-enabled`: a MASTER looking at a company without the fleet
 *   module (decision 4.3: the gate applies to MASTER too), with the way out.
 * - `checking-modules`: a MASTER's company plan is still being fetched.
 * - `no-app-access`: signed in (CRIT-20: a control-tower operator gets in)
 *   but nothing in the app is theirs; the screen says so, and why, instead of
 *   an empty list or a refusal at login.
 */
type HomeState =
  | { kind: "select-business" }
  | { kind: "checking-modules" }
  | { kind: "fleet" }
  | { kind: "deliveries" }
  | { kind: "module-not-enabled"; module: typeof FLEET_MODULE }
  | { kind: "no-app-access"; reason: NoAppAccessReason };

function noAppAccessReason(user: User): NoAppAccessReason {
  const withEveryModule = appSurfaces({
    ...user,
    enabledModules: [...APP_MODULES],
  });

  if (!withEveryModule.fleetHome && !withEveryModule.deliveries) {
    return "profile";
  }

  const hiresAnAppModule = APP_MODULES.some((module) => hasModule(user, module));

  return hiresAnAppModule ? "profile-not-in-plan" : "plan";
}

function homeState(user: User | null): HomeState {
  if (!user) return { kind: "no-app-access", reason: "profile" };

  if (user.role === "MASTER") {
    if (!user.businessId) return { kind: "select-business" };
    if (!modulesKnown(user)) return { kind: "checking-modules" };

    return hasModule(user, FLEET_MODULE)
      ? { kind: "fleet" }
      : { kind: "module-not-enabled", module: FLEET_MODULE };
  }

  const surfaces = appSurfaces(user);

  if (surfaces.fleetHome) return { kind: "fleet" };
  if (surfaces.deliveries) return { kind: "deliveries" };

  return { kind: "no-app-access", reason: noAppAccessReason(user) };
}

type AppTab = "vehicles" | "deliveries" | "chat";

/**
 * The tab that carries the account: "Início", whose header holds the
 * notification bell and the drawer with "Sair da conta" (and so the logout
 * warning, MOB-15). The deliveries and chat screens have headers of their
 * own with none of that — hiding "Início" for a deliveries-only driver left
 * them with no way to sign out and no bell.
 */
const ACCOUNT_TAB: AppTab = "vehicles";

/**
 * The tabs the navigator registers, in order. The account tab is always one
 * of them; a tab navigator left with no screen would crash anyway.
 */
function appTabs(user: User | null): AppTab[] {
  const tabs: AppTab[] = [ACCOUNT_TAB];

  if (hasDeliveriesAccess(user)) tabs.push("deliveries", "chat");

  return tabs;
}

/** Where the app opens after login or a cold start. */
function landingHref(user: User | null): "/vehicles" | "/deliveries" {
  return homeState(user).kind === "deliveries" ? "/deliveries" : "/vehicles";
}

type HomeAction =
  | "open-deliveries"
  | "notifications"
  | "switch-business"
  | "web-panel";

const HOME_ACTION_LABEL: Record<HomeAction, string> = {
  "open-deliveries": "Abrir entregas",
  notifications: "Ver notificações",
  "switch-business": "Trocar de empresa",
  "web-panel": "Abrir painel web",
};

interface HomeNotice {
  icon: "cube-outline" | "desktop-outline" | "lock-closed-outline";
  title: string;
  message: string;

  /** In order; the first is the main one. */
  actions: HomeAction[];
}

/** Every reason ends the same way: the bell still works here, the rest is on the web. */
const NO_APP_ACCESS_NOTICE: Record<NoAppAccessReason, HomeNotice> = {
  plan: {
    icon: "lock-closed-outline",
    title: "Nenhum módulo do aplicativo contratado",
    message:
      "Sua empresa não contratou módulos disponíveis no aplicativo. As notificações continuam chegando aqui; o restante fica no painel web.",
    actions: ["notifications", "web-panel"],
  },
  "profile-not-in-plan": {
    icon: "lock-closed-outline",
    title: "Sem telas do aplicativo para o seu perfil",
    message:
      "O plano da sua empresa não inclui as telas do aplicativo para o seu perfil. As notificações continuam chegando aqui; o restante fica no painel web.",
    actions: ["notifications", "web-panel"],
  },
  profile: {
    icon: "desktop-outline",
    title: "Seu acesso é pelo painel web",
    message:
      "Seu perfil não inclui telas do aplicativo. As notificações continuam chegando aqui; o restante fica no painel web.",
    actions: ["notifications", "web-panel"],
  },
};

/**
 * What "Início" says when it is not a vehicle list. `null` for the states
 * that are not a message: the list itself, the MASTER's company picker and
 * the wait for a company's plan.
 *
 * Names a module the company did not hire only to a MASTER, whose job is to
 * see exactly that (decision 4.3).
 */
function homeNotice(
  home: HomeState,
  businessName?: string | null,
): HomeNotice | null {
  switch (home.kind) {
    case "deliveries":
      return {
        icon: "cube-outline",
        title: "Suas entregas ficam na aba Entregas",
        message:
          "As rotas, as entregas do dia e o chat estão nas abas abaixo. Aqui ficam as notificações e a sua conta.",
        actions: ["open-deliveries", "notifications"],
      };

    case "module-not-enabled":
      return {
        icon: "lock-closed-outline",
        title: "Módulo não contratado",
        message: `${businessName || "A empresa selecionada"} não contratou o módulo ${
          MODULE_LABEL[home.module]
        }. Troque de empresa ou habilite o módulo pelo painel web.`,
        actions: ["switch-business", "web-panel"],
      };

    case "no-app-access":
      return NO_APP_ACCESS_NOTICE[home.reason];

    default:
      return null;
  }
}

export {
  ACCOUNT_TAB,
  HOME_ACTION_LABEL,
  appSurfaces,
  appTabs,
  homeNotice,
  homeState,
  landingHref,
};
export type {
  AppSurfaces,
  AppTab,
  HomeAction,
  HomeNotice,
  HomeState,
  NoAppAccessReason,
};
