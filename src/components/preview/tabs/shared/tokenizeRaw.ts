export interface RawSegment {
  text: string;
  /** Inclusive start offset into the raw string. */
  start: number;
  /** Exclusive end offset into the raw string. */
  end: number;
  /** True for value-like runs the user can click to select; false for gaps. */
  selectable: boolean;
}

// A selectable token is a maximal run of the characters that make up the values an
// engineer wants to capture: alphanumerics plus the punctuation found inside IPs,
// timestamps, paths, emails, UUIDs and key names. Everything else (whitespace,
// brackets, quotes, `=`, `,`, …) is a non-selectable gap, so `key=value` splits into
// `key` / `=` / `value` and `[10/Oct/2000:13:55:36 -0700]` exposes the timestamp and
// the offset as two adjacent tokens (shift-click joins them, gap included).
const TOKEN_RE = /[A-Za-z0-9._:/+@%-]+/g;

/**
 * Split raw text into ordered segments covering every character exactly once
 * (concatenating `segment.text` reproduces the input). Selectable token segments
 * alternate with non-selectable gaps.
 */
export function tokenizeRaw(raw: string): RawSegment[] {
  const segments: RawSegment[] = [];
  let last = 0;
  for (const m of raw.matchAll(TOKEN_RE)) {
    const start = m.index;
    if (start > last) {
      segments.push({ text: raw.slice(last, start), start: last, end: start, selectable: false });
    }
    const end = start + m[0].length;
    segments.push({ text: m[0], start, end, selectable: true });
    last = end;
  }
  if (last < raw.length) {
    segments.push({ text: raw.slice(last), start: last, end: raw.length, selectable: false });
  }
  return segments;
}
