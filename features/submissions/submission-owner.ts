/**
 * Who the submissions queued on this device belong to.
 *
 * The outbox outlives the session. A proof captured in a basement on Friday
 * has to still be there on Monday, and a logout in between — the driver's own,
 * or a refresh token that quietly expired overnight — must not throw it away.
 *
 * But once the queue survives a logout it can hold work from more than one
 * person, and then knowing which items are whose is the only thing standing
 * between a driver and someone else's delivery proof being sent under their
 * credentials, against their name, from their phone.
 *
 * This lives in its own module, importing nothing, because both sides of that
 * question need it: `outbox` decides what may be sent, and `submission-id` is
 * where the session announces itself — and `submission-id` already imports
 * `outbox`, so the answer cannot live there without a cycle.
 */
let activeOwnerUserId: string | null = null;

/** Called when a session opens (with the user) and when it ends (with null). */
function setSubmissionOwner(userId: string | null | undefined): void {
  activeOwnerUserId = userId ?? null;
}

/**
 * The signed-in user, or null when there is no session.
 *
 * Null is not "everyone" — it is "nobody". Nothing may be sent while it is
 * null, because there are no credentials to send it under.
 */
function getSubmissionOwner(): string | null {
  return activeOwnerUserId;
}

export { getSubmissionOwner, setSubmissionOwner };
