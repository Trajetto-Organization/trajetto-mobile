/**
 * When the phone tracks, what it keeps, and when it sends.
 *
 * Pure, and every one of these is a decision about somebody's battery and
 * somebody's privacy. A driver is not a package: the app follows them only
 * while they are working a route, and the rules that decide "working" belong
 * somewhere a test can read them.
 */

interface TrackablePing {
  latitude: number;
  longitude: number;

  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;

  battery?: number | null;

  recorded_at: string;
}

interface RouteBearingDelivery {
  stops?: Array<{ route: { status: string } }> | null;
}

/**
 * The app tracks only while a route of the driver's is IN_PROGRESS.
 *
 * Not "while the driver is logged in", and not "while there are deliveries".
 * A released route is a load still in the yard; a completed one is somebody on
 * their way home. Following either would be a phone reporting where a person
 * lives, which is not a thing this product needs to know.
 */
function shouldTrack(deliveries: RouteBearingDelivery[]): boolean {
  return deliveries.some((delivery) =>
    (delivery.stops ?? []).some((stop) => stop.route.status === "IN_PROGRESS"),
  );
}

/**
 * How often the device is asked for a fix: every fifteen seconds, moving or
 * not. A truck at 60 km/h covers 250 metres in that time, which is enough to
 * see which street it took.
 *
 * No distance floor. There used to be one of fifty metres, and on Android it
 * is an AND, not an OR: the provider delivers nothing until the phone moves
 * that far. A truck parked at a stop produced no fix at all, the stationary
 * keepalive below never fired, and every stop longer than ten minutes went
 * grey on the tower as "sem reportar" (MOB-TRK-2). The phone's own stationary
 * filter decides what is worth keeping; the OS only has to keep answering.
 */
const PING_INTERVAL_MS = 15_000;
const PING_DISTANCE_METRES = 0;

/**
 * How long the OS may hold fixes before waking the background task.
 *
 * With no distance floor a parked truck would otherwise wake the JavaScript
 * runtime every fifteen seconds for fixes the filter then drops. A minute
 * costs nothing on the tower — the buffer only goes out every two minutes —
 * and is well inside the five-minute keepalive.
 */
const DEFERRED_UPDATES_INTERVAL_MS = 60_000;

/**
 * What the OS is asked for, in either mode. One place, so the foreground
 * watcher and the background task cannot drift apart.
 */
function trackingRequestOptions(): {
  timeInterval: number;
  distanceInterval: number;
  deferredUpdatesInterval: number;
  deferredUpdatesDistance: number;
} {
  return {
    timeInterval: PING_INTERVAL_MS,
    distanceInterval: PING_DISTANCE_METRES,
    deferredUpdatesInterval: DEFERRED_UPDATES_INTERVAL_MS,
    deferredUpdatesDistance: PING_DISTANCE_METRES,
  };
}

/**
 * How often the buffer is sent.
 *
 * Two minutes, or twenty points, whichever comes first. One request per fix
 * would be four requests a minute per driver — for three hundred drivers that
 * is twenty requests a second of pure bookkeeping, and every one of them wakes
 * a radio that was about to sleep.
 */
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;
const FLUSH_AT_COUNT = 20;

/**
 * The most the buffer holds before it starts forgetting.
 *
 * A phone in a dead zone for three hours accumulates; the API takes five
 * hundred per request and the buffer is capped just under two of those. Past
 * the cap the OLDEST points go: the recent ones are what a dispatcher is
 * looking for, and a trail with a gap in the middle beats no trail at all.
 */
const MAX_BUFFERED = 900;

/**
 * The most one request carries, well under the API's 500.
 *
 * The buffer used to go out whole. Past 500 points every flush was refused,
 * the batch went back into the buffer, and the buffer — capped at 900, never
 * below 500 again — was refused on every flush after that: tracking dead on
 * that phone for good, across routes and logins, with nothing but a warning in
 * the log. A flush now sends the buffer in pieces of this size.
 */
const MAX_FLUSH_BATCH = 200;

function shouldFlush(props: {
  buffered: number;
  lastFlushAt: number | null;
  now?: number;
}): boolean {
  if (props.buffered === 0) return false;
  if (props.buffered >= FLUSH_AT_COUNT) return true;

  const now = props.now ?? Date.now();

  // Never flushed yet: send, so the first point of the day reaches the tower
  // without waiting out a full interval.
  if (props.lastFlushAt === null) return true;

  return now - props.lastFlushAt >= FLUSH_INTERVAL_MS;
}

function appendPing(
  buffer: TrackablePing[],
  ping: TrackablePing,
): TrackablePing[] {
  const next = [...buffer, ping];

  // Drops from the front. The newest points are the ones somebody is looking
  // at a map for.
  return next.length > MAX_BUFFERED ? next.slice(next.length - MAX_BUFFERED) : next;
}

/**
 * Whether a new fix is worth keeping at all.
 *
 * A parked truck still produces a fix every fifteen seconds (see
 * `trackingRequestOptions`), each one a few metres from the last because GPS
 * jitters. Storing those is storing nothing —
 * 240 rows an hour that draw a dot on top of a dot — so a fix that has not
 * moved and has not waited is dropped on the phone, before it costs a request.
 *
 * The time floor is what keeps the truck on the map while it sits at an
 * address for twenty minutes: a trail that simply stopped would be
 * indistinguishable from a phone that died.
 */
const STATIONARY_METRES = 25;
const STATIONARY_KEEPALIVE_MS = 5 * 60 * 1000;

function distanceMetres(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const EARTH_RADIUS_M = 6_371_000;

  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function shouldKeepPing(
  previous: TrackablePing | null,
  next: TrackablePing,
): boolean {
  if (!previous) return true;

  const moved = distanceMetres(previous, next);

  if (moved >= STATIONARY_METRES) return true;

  const waited =
    new Date(next.recorded_at).getTime() -
    new Date(previous.recorded_at).getTime();

  return waited >= STATIONARY_KEEPALIVE_MS;
}

export {
  DEFERRED_UPDATES_INTERVAL_MS,
  FLUSH_AT_COUNT,
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED,
  MAX_FLUSH_BATCH,
  PING_DISTANCE_METRES,
  PING_INTERVAL_MS,
  STATIONARY_KEEPALIVE_MS,
  STATIONARY_METRES,
  appendPing,
  distanceMetres,
  shouldFlush,
  shouldKeepPing,
  shouldTrack,
  trackingRequestOptions,
  type RouteBearingDelivery,
  type TrackablePing,
};
