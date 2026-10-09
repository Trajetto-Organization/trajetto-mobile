/**
 * Which phone recorded a proof, and when its receipt photo was taken
 * (proof design §4.2 and §8). Pure: the rules a test reads without a device.
 *
 * The API accepts `device_id` as 16 hex characters (the Android ID) or a UUID
 * (this app's installation id) and turns anything else into null; it never
 * refuses a proof over it. The phone holds itself to the same shapes so what
 * it sends is never silently dropped.
 */

const ANDROID_ID = /^[0-9a-f]{16}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A device id the API keeps, or null. */
function acceptedDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const candidate = value.trim();

  return ANDROID_ID.test(candidate) || UUID.test(candidate) ? candidate : null;
}

/**
 * The Android ID when the phone gives a usable one, else the installation id.
 * Some builds and emulators answer the Android ID with an empty string or a
 * constant of the wrong length; those fall back.
 */
function chooseDeviceId(androidId: unknown, installationId: unknown): string | null {
  const android = acceptedDeviceId(androidId);
  if (android && android.toLowerCase() !== "0".repeat(16)) return android;

  return acceptedDeviceId(installationId);
}

/**
 * The receipt photo's instant for the body (`photo_taken_at`): taken when
 * the camera returned, and never later than the tap that sends the proof
 * (`occurred_at`) — the API caps it there too. Undefined when the photo has
 * no instant (a capture recovered after the app was killed, a draft from an
 * older build): the API then reads the proof's own instant.
 */
function photoTakenAtFor(
  takenAt: string | null | undefined,
  occurredAt: string,
): string | undefined {
  if (typeof takenAt !== "string") return undefined;

  const taken = Date.parse(takenAt);
  const occurred = Date.parse(occurredAt);

  if (Number.isNaN(taken) || Number.isNaN(occurred)) return undefined;

  return new Date(Math.min(taken, occurred)).toISOString();
}

export { acceptedDeviceId, chooseDeviceId, photoTakenAtFor };
