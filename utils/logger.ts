/**
 * Custom logger for production-safe logging
 *
 * - dev(): Only logs in development mode (__DEV__)
 * - info(): Always logs (safe for production)
 * - error(): Always logs errors (safe for production)
 */

import { reportEvent } from "./telemetry";

export const logger = {
  /**
   * Development-only logs (removed in production builds)
   * Use for debugging with sensitive data
   */
  dev: (...args: any[]) => {
    if (__DEV__) {
      console.log(...args);
    }
  },

  /**
   * Production-safe info logs
   * Use for important flow information (no sensitive data)
   */
  info: (...args: any[]) => {
    console.log(...args);
  },

  /**
   * Production-safe error logs
   * Use for errors that should be tracked (no sensitive data)
   *
   * Also handed to the telemetry pipeline, which is what takes it off the
   * phone once a sink is registered: until now these lines — a dropped queue
   * file, a failed logout cleanup — reached logcat and nobody. Only the
   * leading description and the error's class go; the rest is often an error
   * whose message can carry anything.
   */
  error: (...args: any[]) => {
    console.error(...args);

    reportEvent("app_error", {
      where: typeof args[0] === "string" ? args[0] : "unknown",
      code: args.find((arg) => arg instanceof Error)?.name,
    });
  },

  /**
   * Warning logs (always shown)
   */
  warn: (...args: any[]) => {
    console.warn(...args);
  },
};
