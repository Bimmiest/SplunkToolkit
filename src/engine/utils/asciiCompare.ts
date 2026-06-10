/**
 * Byte-wise (ASCII/codepoint) comparison of two strings.
 *
 * Splunk applies multiple `TRANSFORMS-<class>` / `REPORT-<class>` /
 * `EXTRACT-<class>` / etc. entries in **ASCII order of the class name**. JS's
 * `localeCompare` is locale-dependent and typically interleaves case
 * (`'a' < 'B'`), whereas ASCII orders uppercase before lowercase (`'B' < 'a'`).
 * Use this everywhere class ordering is significant so the simulator matches
 * Splunk's deterministic byte ordering rather than the host locale.
 */
export function asciiCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Convenience comparator for sorting directives by their (possibly absent) className in ASCII order. */
export function byClassName<T extends { className?: string }>(a: T, b: T): number {
  return asciiCompare(a.className ?? '', b.className ?? '');
}
