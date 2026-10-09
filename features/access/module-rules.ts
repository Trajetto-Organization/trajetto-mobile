/**
 * Which hired modules this session may use, decided in one place.
 *
 * Pure and import-free, like `outbox-rules` and `delivery-rules`: the tabs,
 * the vehicle card, the fuel and checklist screens, the post-login landing and
 * the offline queue all ask the same question, and they used to answer it
 * separately — the fleet side never asked at all (MOB-02).
 *
 * The API stays the real gate (403 MODULE_NOT_ENABLED). What this decides is
 * what the phone OFFERS: an option for a module the company did not hire must
 * not appear, rather than appear and fail after the driver filled the form.
 */

const FLEET_MODULE = "FLEET";
const DELIVERIES_MODULE = "DELIVERIES";

type AppModule = typeof FLEET_MODULE | typeof DELIVERIES_MODULE;

const APP_MODULES: readonly AppModule[] = [FLEET_MODULE, DELIVERIES_MODULE];

/** The names the web uses for the same modules (business-entitlements form). */
const MODULE_LABEL: Record<AppModule, string> = {
  FLEET: "Gestão de Frota",
  DELIVERIES: "Entregas",
};

interface ModuleHolder {
  role?: string | null;
  businessId?: string | null;
  driverId?: string | null;

  /**
   * The modules of the company this session is operating on. `undefined`
   * means "not known yet": a MASTER who just picked a company and whose plan
   * is still being fetched, or a company user cached by a build from before
   * the plan was on the session (see `LEGACY_COMPANY_MODULES`).
   */
  enabledModules?: string[] | null;
}

/**
 * What a company user's session offers while its plan is unknown: what the
 * builds without a plan offered, the fleet (they had no Entregas).
 *
 * Only reachable from a user persisted by such a build — `/user/me` always
 * carries the plan — who then cold-starts offline right after the update:
 * `checkAuth` keeps the cached user, and reading "unknown" as "nothing" took
 * refuelling and checklists away (and said "Seu acesso é pelo painel web")
 * until the network came back. The API still refuses a module that is off,
 * and the queue parks what it refuses; the first `/user/me` replaces this.
 */
const LEGACY_COMPANY_MODULES: readonly AppModule[] = [FLEET_MODULE];

function sessionModules(user: ModuleHolder | null): readonly string[] {
  if (Array.isArray(user?.enabledModules)) return user.enabledModules;

  const isCompanyUser = Boolean(user?.role) && user?.role !== "MASTER";

  return isCompanyUser ? LEGACY_COMPANY_MODULES : [];
}

function hasModule(user: ModuleHolder | null, module: AppModule): boolean {
  return sessionModules(user).includes(module);
}

/**
 * Whether the plan of the company in scope is known at all.
 *
 * `/user/me` always carries it for company users (a user cached by an older
 * build without it gets `LEGACY_COMPANY_MODULES`). A MASTER's `/user/me`
 * carries every module — the back office is not a company — so for them the
 * list is the selected company's, fetched on selection, and unknown until
 * then. Unknown is not "none": the screen waits instead of claiming the
 * company hired nothing.
 */
function modulesKnown(user: ModuleHolder | null): boolean {
  return Array.isArray(user?.enabledModules);
}

/** Deliveries and chat exist only for a driver with the module on. */
function hasDeliveriesAccess(user: ModuleHolder | null): boolean {
  if (!user?.driverId) return false;

  return hasModule(user, DELIVERIES_MODULE);
}

/**
 * The module a queued submission needs, from its kind.
 *
 * Derived rather than stored on the item: the kind already says it, items
 * queued by older builds get it for free, and a stored copy could only ever
 * disagree with the kind. `null` for a kind this build does not know — such
 * an item waits for a person rather than for a module.
 */
function moduleOfSubmission(kind: string): AppModule | null {
  if (kind === "fuel" || kind === "checklist") return FLEET_MODULE;
  if (kind.startsWith("delivery-")) return DELIVERIES_MODULE;

  return null;
}

/**
 * Reads `GET /business/entitlements/:id` into a module list.
 *
 * Tolerant of a missing or malformed body on purpose: the answer is used to
 * HIDE things, so a shape it does not understand hides the modules rather
 * than inventing them.
 */
function enabledModulesFromEntitlements(response: unknown): string[] {
  const modules = (response as { data?: { modules?: unknown } } | null)?.data
    ?.modules;

  if (!Array.isArray(modules)) return [];

  return modules
    .filter(
      (row): row is { module: string; enabled: boolean } =>
        typeof row?.module === "string" && row?.enabled === true,
    )
    .map((row) => row.module);
}

/**
 * The user the session keeps after a local change (a MASTER picking another
 * company).
 *
 * The modules travel with the company they belong to. Switching company kept
 * the previous company's plan on the user until something refetched it, and
 * a MASTER saw fleet actions on a company that never hired the fleet module.
 * The plan becomes unknown the moment the company changes, and is filled in
 * by the fetch for the new one.
 */
function withSessionModules<TUser extends ModuleHolder>(
  next: TUser,
  previous: ModuleHolder | null,
): TUser {
  if (next.role !== "MASTER") return next;
  if ((next.businessId ?? null) === (previous?.businessId ?? null)) return next;

  return { ...next, enabledModules: undefined };
}

/**
 * The modules to keep when `/user/me` answers for a MASTER who is looking at
 * a company.
 *
 * The API answers a MASTER with every module (the back office is never gated
 * by one company's plan), and applying that verbatim put fleet actions back
 * on screen for a company without the module on every return to the
 * foreground. The selected company's plan — or "unknown" — is kept instead.
 */
function modulesAfterServerRefresh(
  server: ModuleHolder,
  cached: ModuleHolder | null,
): string[] | undefined {
  const keepsSelection =
    server.role === "MASTER" &&
    cached?.role === "MASTER" &&
    Boolean(cached.businessId) &&
    !server.businessId;

  const modules = keepsSelection ? cached?.enabledModules : server.enabledModules;

  return modules ?? undefined;
}

export {
  APP_MODULES,
  DELIVERIES_MODULE,
  FLEET_MODULE,
  LEGACY_COMPANY_MODULES,
  MODULE_LABEL,
  enabledModulesFromEntitlements,
  hasDeliveriesAccess,
  hasModule,
  moduleOfSubmission,
  modulesAfterServerRefresh,
  modulesKnown,
  withSessionModules,
};

export type { AppModule, ModuleHolder };
