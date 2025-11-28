/**
 * Custom logger for production-safe logging
 *
 * - dev(): Only logs in development mode (__DEV__)
 * - info(): Always logs (safe for production)
 * - error(): Always logs errors (safe for production)
 */

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
   */
  error: (...args: any[]) => {
    console.error(...args);
  },

  /**
   * Warning logs (always shown)
   */
  warn: (...args: any[]) => {
    console.warn(...args);
  },
};
