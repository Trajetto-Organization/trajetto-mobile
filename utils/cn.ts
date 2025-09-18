/**
 * Simple utility to merge class names
 * Alternative to clsx/classnames for simple use cases
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
