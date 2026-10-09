/**
 * What to do about the microphone permission, decided apart from the recorder
 * so the driver-facing outcome can be tested as a rule.
 *
 * Android has three distinct answers and the old flow collapsed them into
 * one toast ("É necessário permitir acesso ao microfone"). That toast was
 * useless in exactly the case that matters: once the driver denies twice (or
 * ticks "não perguntar novamente") the system never shows the dialog again,
 * so tapping the microphone could only ever repeat the same toast. The way
 * out of that state is the app's page in the system settings, and the driver
 * has to be told so and taken there.
 *
 * The silent check (`get…`) cannot tell that state apart from others. Once
 * the permission was ever asked, expo reports `canAskAgain` from Android's
 * `shouldShowRequestPermissionRationale`, which is also false after the
 * driver merely dismissed the dialog (back, or a tap outside) and after a
 * one-time grant expired — states in which the dialog WOULD still appear. So
 * a permission that is not granted is always requested (a truly blocked one
 * answers at once, without any dialog), and only the request's answer is
 * classified.
 */

/** The fields of `expo-modules-core`'s `PermissionResponse` this reads. */
interface MicrophonePermission {
  granted: boolean;
  canAskAgain: boolean;

  // expo's `PermissionStatus` enum: "granted" | "denied" | "undetermined".
  status?: string;
}

/**
 * - `granted`: record.
 * - `denied`: the driver said no (or dismissed the dialog); the next tap asks
 *   again.
 * - `blocked`: the system no longer shows the dialog; only the settings can
 *   grant it.
 */
type MicrophoneAccess = "granted" | "denied" | "blocked";

/** A silent check that is not a grant is always followed by the request. */
function microphoneNeedsRequest(check: MicrophonePermission): boolean {
  return !check.granted;
}

/**
 * Reads the answer to `requestRecordingPermissionsAsync`, given the silent
 * check that preceded it.
 *
 * A refusal that cannot be asked again is a block — except on the very first
 * request (`undetermined` before it): Android never offers "não perguntar
 * novamente" the first time, so a `false` there means the dialog was
 * dismissed, and the next tap will show it again.
 */
function resolveMicrophoneAccess(
  answer: MicrophonePermission,
  before: MicrophonePermission,
): MicrophoneAccess {
  if (answer.granted) return "granted";
  if (answer.canAskAgain) return "denied";

  return before.status === "undetermined" ? "denied" : "blocked";
}

interface MicrophoneAccessNotice {
  title: string;
  message: string;

  /** Whether the notice offers "Abrir configurações". */
  offersSettings: boolean;
}

/** What the driver is told when the recording cannot start, or `null`. */
function microphoneAccessNotice(
  access: MicrophoneAccess,
): MicrophoneAccessNotice | null {
  if (access === "blocked") {
    return {
      title: "Microfone bloqueado",
      message:
        "Para gravar mensagens de voz, permita o acesso ao microfone nas configurações do aparelho: Permissões › Microfone › Permitir.",
      offersSettings: true,
    };
  }

  if (access === "denied") {
    return {
      title: "Permissão do microfone negada",
      message:
        "Toque no microfone de novo e escolha Permitir para gravar a mensagem de voz.",
      offersSettings: false,
    };
  }

  return null;
}

export {
  microphoneAccessNotice,
  microphoneNeedsRequest,
  resolveMicrophoneAccess,
};
export type { MicrophoneAccess, MicrophoneAccessNotice, MicrophonePermission };
