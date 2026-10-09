/**
 * The two-factor challenge, kept between the password step and the code step.
 *
 * The API answers a password login that stops at two-factor with a
 * `twoFactorChallenge` — proof that this device just got the password right —
 * and accepts the code, and a resend, only next to it (WEB-07). Without that
 * tie, anyone who knew an e-mail could have codes issued and guess them.
 *
 * In memory only, on purpose: it proves the password for 30 minutes, which is
 * not something to leave in AsyncStorage. An app restarted on the code screen
 * asks for the password again. Tied to the e-mail it was issued for, so it is
 * never sent with another account's code.
 */
interface KeptChallenge {
  email: string;
  challenge: string;
}

let kept: KeptChallenge | null = null;

function normalized(email: string): string {
  return email.trim().toLowerCase();
}

/** After the password step. An API that sends none clears any older one. */
export function rememberTwoFactorChallenge(
  email: string,
  challenge: string | undefined,
): void {
  kept = challenge ? { email: normalized(email), challenge } : null;
}

/**
 * `{ challenge }` to spread into a request body, or nothing — so without one
 * the body is exactly what an older build sends.
 */
export function twoFactorChallengeFor(email: string): { challenge?: string } {
  return kept && kept.email === normalized(email)
    ? { challenge: kept.challenge }
    : {};
}

export function forgetTwoFactorChallenge(): void {
  kept = null;
}
