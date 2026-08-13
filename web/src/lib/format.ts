/**
 * Display formatters for the figures the TUI syncs up. Shared rather than per-page so a
 * session's cost reads the same everywhere it appears.
 */

/** `1.2k` / `3.4M` — a token count is scale, not a figure anybody reads digit by digit. */
export const thousands = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/**
 * Integer micros in, dollars out. Sub-dollar figures keep three decimals because most
 * single sessions cost cents and `$0.00` is indistinguishable from free.
 *
 * Takes micros rather than dollars on purpose: the column is an integer so that money is
 * never accumulated as a float, and dividing at the display boundary is the whole point.
 */
export const money = (micros: number): string =>
  `$${(micros / 1_000_000).toFixed(micros < 1_000_000 ? 3 : 2)}`;
