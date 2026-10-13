/**
 * A number as an operator types it: "12,5" and "1 234,5" as well as "12.5".
 *
 * French is the app's default language and its keyboards put a comma on the
 * keypad, so a plain `Number("12,5")` — NaN — refused the most natural input.
 * Spaces are dropped (`\s` covers the narrow no-break space `Intl` groups with),
 * and the first comma becomes the decimal point; "1.234,5" stays NaN rather
 * than guessing which separator was meant.
 *
 * Like `Number`, "" is 0: callers test for an empty field first.
 */
export function decimal(value: string): number {
  return Number(value.replace(/\s/g, "").replace(",", "."));
}
