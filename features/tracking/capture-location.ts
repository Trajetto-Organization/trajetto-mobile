import * as Location from "expo-location";

import { settleWithin } from "./settle-within";

/**
 * One reading of where the driver is, that always comes back.
 *
 * `getCurrentPositionAsync` has no timeout of its own. In a basement, a
 * warehouse or a truck cab with a metal roof the first fix can take minutes,
 * and every screen that awaited it — "Cheguei", the proof, the occurrence —
 * sat spinning with the driver unable to do anything else (MOB-13).
 *
 * So the fresh fix gets a budget, and when it runs out the phone's last known
 * position stands in if it is recent enough to still be "here". A reading
 * that is required (the arrival IS a place) fails with a message the driver
 * can act on; an optional one (proof, occurrence) simply goes without, and
 * never holds the submission back for longer than its budget.
 */

interface Coordinates {
  latitude: number;
  longitude: number;
}

type LocationFailure = "denied" | "unavailable";

/** Long enough for a cold GPS in the open, short enough to stand and wait. */
const REQUIRED_FIX_TIMEOUT_MS = 8_000;

/** An optional reading is a bonus: it must not make a proof feel slow. */
const OPTIONAL_FIX_TIMEOUT_MS = 4_000;

/**
 * How old the phone's last known position may be to stand in for a fresh one.
 *
 * A truck parked at a stop for five minutes is still at the stop; one that
 * reported an hour ago may be across town.
 */
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The refuelling form's stand-in: at most a minute old and 100 m accurate,
 * about one forecourt. The API stores the form's reading as the GPS reading
 * of the station (GPS_AUTO) and measures later edits against it; anything
 * looser is the road leading there, so the form asks for a new fix instead.
 */
const REFUEL_LAST_KNOWN: Readonly<LastKnownPolicy> = {
  maxAgeMs: 60 * 1000,
  maxAccuracyM: 100,
};

const DEFAULT_FAILURE_MESSAGES: Record<LocationFailure, string> = {
  denied: "Ative a permissão de localização do aplicativo para continuar.",
  unavailable:
    "Não foi possível obter sua localização. Verifique se a localização do aparelho está ativada e tente novamente.",
};

class LocationCaptureError extends Error {
  constructor(
    public reason: LocationFailure,
    message: string,
  ) {
    super(message);
    this.name = "LocationCaptureError";
  }
}

/**
 * Which last known position may stand in for a fresh fix, per screen.
 *
 * The default (5 min, any accuracy) suits an arrival: the truck stands at
 * the stop. A refuelling is recorded as the GPS reading of the station, and
 * a five-minute-old or cell-tower position can be kilometres down the road,
 * stored as if the GPS had read it there.
 */
interface LastKnownPolicy {
  maxAgeMs: number;

  /** Refuses a stand-in whose reported accuracy is worse (or unknown). */
  maxAccuracyM?: number;
}

interface CaptureLocationInput {
  required: boolean;

  /** Defaults to 8 s when required and 4 s when optional. */
  timeoutMs?: number;

  accuracy?: Location.Accuracy;

  /** Defaults to `{ maxAgeMs: LAST_KNOWN_MAX_AGE_MS }`. */
  lastKnown?: LastKnownPolicy;

  /** The wording of a required reading's failure, per screen. */
  messages?: Partial<Record<LocationFailure, string>>;
}

/** A position, and whether it is a fix taken now or the phone's last one. */
interface LocationReading extends Coordinates {
  source: "fresh" | "last-known";
}

const asReading = (
  position: Location.LocationObject,
  source: LocationReading["source"],
): LocationReading => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  source,
});

/**
 * How far ahead of the phone's clock a stand-in's time may be. GPS time and
 * a synced clock agree within a second or two; beyond that the clock is off
 * and the reading's age cannot be told.
 */
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5_000;

/**
 * Checked here as well as asked of the OS: `maxAge` and `requiredAccuracy`
 * are hints some Android builds apply loosely, and this is what decides
 * whether a reading counts as "here".
 */
function standsIn(
  position: Location.LocationObject,
  policy: LastKnownPolicy,
  now: number,
): boolean {
  const { timestamp } = position;

  // An age that cannot be told is not "recent": no time at all, or a time
  // ahead of the clock, which any maxAge would let through.
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
  if (timestamp - now > FUTURE_TIMESTAMP_TOLERANCE_MS) return false;
  if (now - timestamp > policy.maxAgeMs) return false;

  if (policy.maxAccuracyM === undefined) return true;

  const accuracy = position.coords.accuracy;

  return typeof accuracy === "number" && accuracy <= policy.maxAccuracyM;
}

async function readLocation({
  required,
  timeoutMs,
  accuracy = Location.Accuracy.Balanced,
  lastKnown = { maxAgeMs: LAST_KNOWN_MAX_AGE_MS },
  messages,
}: CaptureLocationInput): Promise<LocationReading | null> {
  const fail = (reason: LocationFailure): null => {
    if (!required) return null;

    throw new LocationCaptureError(
      reason,
      messages?.[reason] ?? DEFAULT_FAILURE_MESSAGES[reason],
    );
  };

  let granted = false;

  try {
    const permission = await Location.requestForegroundPermissionsAsync();

    granted = permission.status === Location.PermissionStatus.GRANTED;
  } catch {
    granted = false;
  }

  if (!granted) return fail("denied");

  const budget =
    timeoutMs ?? (required ? REQUIRED_FIX_TIMEOUT_MS : OPTIONAL_FIX_TIMEOUT_MS);

  const fresh = await settleWithin(
    Location.getCurrentPositionAsync({ accuracy }),
    budget,
  );

  if (fresh) return asReading(fresh, "fresh");

  // Instant and offline: the OS answers from its own cache, or not at all.
  const standIn = await Location.getLastKnownPositionAsync({
    maxAge: lastKnown.maxAgeMs,
    ...(lastKnown.maxAccuracyM !== undefined && {
      requiredAccuracy: lastKnown.maxAccuracyM,
    }),
  }).catch(() => null);

  if (standIn && standsIn(standIn, lastKnown, Date.now())) {
    return asReading(standIn, "last-known");
  }

  return fail("unavailable");
}

/** The coordinates alone, for screens that do not say where they came from. */
async function captureLocation(
  input: CaptureLocationInput,
): Promise<Coordinates | null> {
  const reading = await readLocation(input);

  return reading
    ? { latitude: reading.latitude, longitude: reading.longitude }
    : null;
}

export {
  FUTURE_TIMESTAMP_TOLERANCE_MS,
  LAST_KNOWN_MAX_AGE_MS,
  LocationCaptureError,
  OPTIONAL_FIX_TIMEOUT_MS,
  REFUEL_LAST_KNOWN,
  REQUIRED_FIX_TIMEOUT_MS,
  captureLocation,
  readLocation,
};

export type {
  CaptureLocationInput,
  Coordinates,
  LastKnownPolicy,
  LocationFailure,
  LocationReading,
};
