/**
 * The value of `work`, or null once `ms` have passed. Never rejects.
 *
 * For the native calls that have no timeout of their own — a GPS fix, a
 * last flush on the way out — where waiting longer is worse than going
 * without. The work itself is not cancelled; it simply stops being waited on.
 */
async function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });

  try {
    return await Promise.race([work.catch(() => null), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export { settleWithin };
