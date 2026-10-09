/**
 * Which API a published bundle may talk to.
 *
 * `app.config.js` refuses a bad `EXPO_PUBLIC_API_URL` when EAS builds the
 * app — but an `eas update` never goes through EAS Build, so an OTA bundle
 * published from a laptop whose `.env` points at `http://192.168.x.x` reached
 * every phone unchecked. The bundle now checks itself, which covers every way
 * a bundle can be made. `app.config.js` keeps its own copy of these rules (it
 * runs in Node, before any TypeScript); a test keeps the two in agreement.
 *
 * Nothing here imports anything.
 */

/** Loopback, private, link-local and made-up names: nothing a phone in a truck can reach safely. */
export function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    ["localhost", "0.0.0.0", "127.0.0.1", "::", "::1", "10.0.2.2"].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan")
  ) {
    return true;
  }

  if (normalized.includes(":")) {
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    );
  }

  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;

  const [, first, second] = match.map(Number);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

/**
 * Why a release bundle must not use this API URL, in pt-BR; null when it may.
 *
 * The same three rules the build applies: HTTPS, no credentials / query /
 * fragment, and a public host.
 */
export function releaseApiUrlProblem(raw: string | undefined): string | null {
  if (!raw) return "EXPO_PUBLIC_API_URL não configurada.";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "EXPO_PUBLIC_API_URL não é uma URL absoluta válida.";
  }

  if (url.protocol !== "https:") {
    return "A API do aplicativo publicado precisa usar HTTPS.";
  }

  if (url.username || url.password || url.search || url.hash) {
    return "A URL da API não aceita credenciais, query string ou fragmento.";
  }

  if (isLocalHost(url.hostname)) {
    return "A API do aplicativo publicado não pode ser local ou de rede privada.";
  }

  return null;
}

/**
 * Whether this JavaScript is a release bundle (an EAS build or an OTA
 * update) rather than Metro serving a developer.
 *
 * `__DEV__` is always defined by React Native; outside it (the unit tests)
 * nothing is being released.
 */
export function isReleaseBundle(): boolean {
  return typeof __DEV__ !== "undefined" && !__DEV__;
}
