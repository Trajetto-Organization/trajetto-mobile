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
 * How often the device is asked for a fix.
 *
 * Fifteen seconds and fifty metres, whichever comes first. A truck at 60 km/h
 * covers 250 metres in fifteen seconds, which is enough resolution to see
 * which street it took; asking more often buys a smoother line and costs a
 * driver their afternoon of battery.
 */
const PING_INTERVAL_MS = 15_000;
const PING_DISTANCE_METRES = 50;

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
 * A parked truck still produces a fix every fifteen seconds, each one a few
 * metres from the last because GPS jitters. Storing those is storing nothing —
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
  FLUSH_AT_COUNT,
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED,
  PING_DISTANCE_METRES,
  PING_INTERVAL_MS,
  STATIONARY_KEEPALIVE_MS,
  STATIONARY_METRES,
  appendPing,
  distanceMetres,
  shouldFlush,
  shouldKeepPing,
  shouldTrack,
  type RouteBearingDelivery,
  type TrackablePing,
};
