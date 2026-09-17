/**
 * Which way the phone follows the truck, and whether it follows it at all.
 *
 * Pure, because this is where a driver's battery, a driver's privacy and a
 * dispatcher's map meet, and because the answer depends on four things that
 * are awkward to arrange in a running app at once: a route in progress, two
 * separate OS permissions, and whether this build is allowed to ask for the
 * second one.
 */

type TrackingMode = "background" | "foreground" | "off";

interface TrackingModeInput {
  /** A route of this driver's is IN_PROGRESS. */
  wanted: boolean;

  /** The API said to stop: no route of theirs is running any more. */
  stopped?: boolean;

  /** "While using the app", which is the floor for any tracking at all. */
  foregroundGranted: boolean;

  /** "All the time". Asked for only when the build declares it. */
  backgroundGranted?: boolean;

  /**
   * Whether THIS BUILD carries the background-location permission.
   *
   * Not a runtime preference: Android only grants what the manifest declares,
   * and the manifest is what Google reviews. A build without the declaration
   * must never ask — the prompt would be refused by the OS and the attempt
   * logged as a policy violation.
   */
  backgroundBuild: boolean;
}

/**
 * The order matters, and every step is a refusal somebody can undo.
 *
 * `off` is not a failure state: a driver who denied location still gets the
 * whole app, and the tower simply has no dot for them. Falling back to
 * `foreground` when the "all the time" permission is missing is the same idea
 * — less than was asked for, and better than nothing.
 */
function trackingMode(input: TrackingModeInput): TrackingMode {
  if (!input.wanted) return "off";
  if (input.stopped) return "off";

  if (!input.foregroundGranted) return "off";

  if (input.backgroundBuild && input.backgroundGranted) return "background";

  return "foreground";
}

/**
 * Whether it is worth asking for "all the time" at this moment.
 *
 * Asking before the route starts is asking a stranger for their address: the
 * prompt makes no sense out of context and Android only offers it once in a
 * way that matters. The moment it makes sense is the moment the driver starts
 * a route, with the app open and the reason on screen.
 */
function shouldRequestBackground(input: {
  wanted: boolean;
  backgroundBuild: boolean;
  foregroundGranted: boolean;
  backgroundGranted: boolean;
  alreadyAsked: boolean;
}): boolean {
  if (!input.backgroundBuild) return false;
  if (!input.wanted) return false;

  if (!input.foregroundGranted) return false;
  if (input.backgroundGranted) return false;

  // Once. A driver who said no is not asked again by the app; they can still
  // change it in the system settings, and the app keeps working either way.
  return !input.alreadyAsked;
}

export {
  shouldRequestBackground,
  trackingMode,
  type TrackingMode,
  type TrackingModeInput,
};
