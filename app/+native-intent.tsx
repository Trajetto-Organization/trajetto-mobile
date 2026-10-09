import { systemPathFor } from "@/features/deep-links/system-path-rules";

/**
 * Expo Router's hook for links that come from the system (the `trajetto://`
 * scheme): see features/deep-links/system-path-rules.ts for why none of
 * them picks the screen.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    return systemPathFor(path, initial, __DEV__);
  } catch {
    return initial ? "/" : "";
  }
}
