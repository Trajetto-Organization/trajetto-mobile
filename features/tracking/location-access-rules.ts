/**
 * What the driver is told when the phone cannot report where it is.
 *
 * Pure and import-free, like the rest of this folder's rules. A refused
 * location permission used to be a line in the log and nothing else: the
 * driver ran the whole route believing the central could see them, and the
 * tower simply had no dot (MOB-TRK-5).
 */

/**
 * - `granted`: tracking can run.
 * - `denied`: refused, and Android will still show the prompt again.
 * - `blocked`: refused for good ("não perguntar novamente") or by a policy —
 *   only the system settings can change it.
 * - `unknown`: not asked yet in this session.
 */
type LocationAccess = "unknown" | "granted" | "denied" | "blocked";

function locationAccessOf(permission: {
  granted: boolean;
  canAskAgain?: boolean;
}): LocationAccess {
  if (permission.granted) return "granted";

  return permission.canAskAgain === false ? "blocked" : "denied";
}

interface LocationWarning {
  title: string;
  message: string;

  /** Ask again in the app, or send the driver to the system settings. */
  action: "request" | "settings";
  actionLabel: string;
}

/**
 * The warning, only while a route of the driver's is running — outside a
 * route the app does not track, and a warning would be noise.
 */
function locationWarning(input: {
  wanted: boolean;
  access: LocationAccess;
}): LocationWarning | null {
  if (!input.wanted) return null;

  if (input.access === "denied") {
    return {
      title: "Localização desativada",
      message:
        "Sua rota está em andamento, mas a central não vê onde você está. Permita o acesso à localização.",
      action: "request",
      actionLabel: "Permitir localização",
    };
  }

  if (input.access === "blocked") {
    return {
      title: "Localização bloqueada",
      message:
        "Sua rota está em andamento, mas a central não vê onde você está. Ative a localização do Trajetto nas configurações do aparelho.",
      action: "settings",
      actionLabel: "Abrir configurações",
    };
  }

  return null;
}

export { locationAccessOf, locationWarning };
export type { LocationAccess, LocationWarning };
