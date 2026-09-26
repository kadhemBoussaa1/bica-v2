/**
 * Composes CSS-module classes. `noUncheckedIndexedAccess` makes every
 * lookup `string | undefined`, so classes are filtered and joined rather
 * than interpolated — a template literal would print "undefined".
 */
export function cx(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}
