import { safeRegex } from '../utils/splunkRegex';

/**
 * Serializable result of matching a pattern against one input. Replaces passing a
 * `RegExpExecArray` around (which can't cross a Web Worker boundary) — it carries
 * exactly what the Regex tab renders: the full-match span plus each named group's
 * value and character range.
 */
export interface RegexMatchInfo {
  /** Start offset of the full match in the input. */
  index: number;
  /** The full matched text (group 0). */
  match: string;
  /** Named capture group values (undefined groups omitted). */
  groups: Record<string, string>;
  /** Named capture group [start, end] ranges, for highlighting (undefined groups omitted). */
  groupSpans: Record<string, [number, number]>;
}

type WithIndices = RegExpExecArray & {
  indices?: { groups?: Record<string, [number, number] | undefined> };
};

function matchOne(regex: RegExp, raw: string): RegexMatchInfo | null {
  regex.lastIndex = 0;
  const m = regex.exec(raw) as WithIndices | null;
  if (!m) return null;
  const info: RegexMatchInfo = { index: m.index, match: m[0], groups: {}, groupSpans: {} };
  if (m.groups) {
    for (const [name, value] of Object.entries(m.groups)) {
      if (value !== undefined) info.groups[name] = value;
    }
  }
  if (m.indices?.groups) {
    for (const [name, span] of Object.entries(m.indices.groups)) {
      if (span) info.groupSpans[name] = span;
    }
  }
  return info;
}

/**
 * Compile `pattern` (Splunk syntax) and match it — first match only, like an
 * inline EXTRACT — against each input. Returns `null` overall when the pattern is
 * invalid or refused by {@link safeRegex}; otherwise a per-input array where each
 * element is the match info, or `null` if that input didn't match.
 *
 * Designed to run inside a Web Worker: a catastrophic pattern that slips the
 * ReDoS heuristic hangs the worker (which the caller's watchdog terminates)
 * rather than freezing the UI thread.
 */
export function matchInputs(pattern: string, inputs: string[]): (RegexMatchInfo | null)[] | null {
  const regex = safeRegex(pattern, 'd');
  if (!regex) return null;
  return inputs.map((raw) => matchOne(regex, raw));
}
