/**
 * Whether this session runs the offline pre-check (decision 14.2; design
 * ia-local-implementacao §P7.2).
 *
 * Pure and import-free, like `module-rules`. The API says it on `/user/me`
 * (`ai.precheck`): on only when the company bought the automatic reading,
 * the server reads, and the month still has quota. The phone keeps that
 * answer for its offline window and no longer: past seven days without a
 * `/user/me` the flag is stale, and a stale "on" would read photos for a
 * company that may have stopped paying.
 *
 * Off means NOTHING shows: no reading, no warning, no icon.
 */

/** The offline window of the app's cache (providers/query-provider). */
const PRECHECK_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

type PrecheckOffReason = "not_contracted" | "quota_exhausted" | "unavailable";

interface SessionAiFlag {
  precheck: boolean;
  reason: PrecheckOffReason | null;
}

interface PrecheckHolder {
  ai?: { precheck?: unknown } | null;

  /** When the phone last received `ai` from `/user/me` (epoch ms). */
  aiCheckedAt?: number | null;
}

/**
 * True only with an explicit `precheck: true` received within the window.
 * A user cached by an older build has no flag and reads as off; so does one
 * whose stamp is missing — the safe answer to "when did the server say so?".
 */
function canPrecheck(user: PrecheckHolder | null | undefined, now: number = Date.now()): boolean {
  if (!user || user.ai?.precheck !== true) return false;

  const checkedAt = user.aiCheckedAt;

  if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) return false;

  return now - checkedAt <= PRECHECK_CACHE_MS;
}

/**
 * The user as the store keeps it after a `/user/me`: stamped with when the
 * `ai` flag was received. A response without the flag (an API older than
 * the pre-check) leaves no stamp, so it reads as off.
 */
function stampAiFlag<T extends PrecheckHolder>(user: T, now: number = Date.now()): T {
  if (!user.ai || typeof user.ai !== "object") {
    return { ...user, ai: undefined, aiCheckedAt: undefined };
  }

  return { ...user, aiCheckedAt: now };
}

export { PRECHECK_CACHE_MS, canPrecheck, stampAiFlag };
export type { PrecheckHolder, PrecheckOffReason, SessionAiFlag };
