import { useEffect, useState } from "react";

/**
 * The current time, ticking while `active`: the pause timer's clock.
 *
 * Idle when nothing runs, so a screen with no open pause schedules nothing.
 */
function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!active) return;

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);

    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return now;
}

export { useNow };
