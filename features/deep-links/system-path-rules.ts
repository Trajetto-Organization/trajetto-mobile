/**
 * Where a link from outside the app may land.
 *
 * The app registers the `trajetto://` scheme, and Expo Router maps any
 * incoming path onto a screen with its query string as the screen's params.
 * Any web page or other app could open `trajetto://chat?ticketSubject=…` or
 * `trajetto://delivery-proof?id=…&review=…` and drop the driver into a screen
 * with context of its choosing. Nothing in the product sends such links: push
 * taps navigate inside the app through a closed list (notification-rules.ts),
 * so an external link that launches the app opens it at its start, which
 * then routes by session as usual, and one that arrives while the app is
 * running is ignored (an empty path is no navigation for Expo Router): the
 * driver is not pulled out of a half-filled proof.
 *
 * Development builds keep the dev launcher's own links working.
 */
const ROOT = "/";
const IGNORE = "";

function systemPathFor(path: string, initial: boolean, isDevelopment: boolean): string {
  if (isDevelopment && typeof path === "string" && path.includes("expo-development-client")) {
    return path;
  }

  return initial ? ROOT : IGNORE;
}

export { systemPathFor };
