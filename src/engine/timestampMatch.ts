import { safeRegex } from '../utils/splunkRegex';
import { strftimeToRegex, parseTimestamp } from '../utils/strftime';

/**
 * Timestamp probing for the Timestamp tab, extracted from the component so it
 * can run in a Web Worker.
 *
 * It has to be off the render thread because TIME_PREFIX is a user-supplied
 * regex executed against `_raw`. `safeRegex`'s ReDoS heuristic is structural and
 * documents what it cannot see — alternation-overlap forms such as `(a|aa)+` —
 * and those remain the caller's problem. On the main thread there was nothing to
 * terminate: `^(a|a)*b$` against a thirty-character line took about 32 seconds in
 * a cold process, growing roughly fourfold per two characters added, with no
 * diagnostic, because the refusal path is what would have produced one.
 *
 * Typing a TIME_PREFIX is an ordinary thing to do, and a pattern does not have
 * to be hostile to be catastrophic — only ambiguous.
 */

export interface TimeConfig {
  timePrefix: string | null;
  timeFormat: string | null;
  maxLookahead: number;
  tz: string | null;
}

export interface TimestampMatch {
  prefixStart: number;
  prefixEnd: number;
  lookaheadEnd: number;
  tsStart: number;
  tsEnd: number;
  /**
   * Milliseconds since the epoch, or null when the matched text did not parse.
   *
   * A number rather than a `Date` because this crosses a worker boundary: a
   * structured-cloned `Date` survives, but keeping the wire format primitive
   * means the tab renders the same whether the result came from the worker or
   * from the inline fallback.
   */
  parsedTimeMs: number | null;
  matchedText: string;
}

/**
 * What a probe found, which is not the same question as "did it match".
 *
 * The overlay renders the lookahead window whenever TIME_PREFIX matched, even
 * when TIME_FORMAT then did not — that is the case a user most needs to see,
 * because it distinguishes "the prefix is wrong" from "the format is wrong".
 * Carrying the prefix span separately is what lets the overlay draw it without
 * re-running the regex on the render thread.
 */
export interface TimestampProbe {
  match: TimestampMatch | null;
  prefix: { start: number; end: number; lookaheadEnd: number } | null;
}

const EMPTY: TimestampProbe = { match: null, prefix: null };

export function probeTimestamp(raw: string, config: TimeConfig): TimestampProbe {
  let prefixStart = 0;
  let prefixEnd = 0;
  let prefix: TimestampProbe['prefix'] = null;

  if (config.timePrefix) {
    const prefixRegex = safeRegex(config.timePrefix);
    if (!prefixRegex) return EMPTY;
    const prefixMatch = prefixRegex.exec(raw);
    if (!prefixMatch) return EMPTY;
    prefixStart = prefixMatch.index;
    prefixEnd = prefixMatch.index + prefixMatch[0].length;
    prefix = {
      start: prefixStart,
      end: prefixEnd,
      lookaheadEnd: Math.min(prefixEnd + config.maxLookahead, raw.length),
    };
  }

  // Reported after the prefix so the overlay can still draw the lookahead window
  // for a config that has a TIME_PREFIX but no TIME_FORMAT yet — the state a user
  // is in halfway through writing one.
  if (!config.timeFormat) return { match: null, prefix };

  const lookaheadEnd = Math.min(prefixEnd + config.maxLookahead, raw.length);
  const searchRegion = raw.substring(prefixEnd, lookaheadEnd);

  const formatRegex = strftimeToRegex(config.timeFormat);
  const formatMatch = formatRegex.exec(searchRegion);
  if (!formatMatch) return { match: null, prefix };

  const tsStart = prefixEnd + formatMatch.index;
  const tsEnd = tsStart + formatMatch[0].length;
  const matchedText = formatMatch[0];
  const parsed = parseTimestamp(matchedText, config.timeFormat, config.tz ?? undefined);

  return {
    match: {
      prefixStart,
      prefixEnd,
      lookaheadEnd,
      tsStart,
      tsEnd,
      parsedTimeMs: parsed ? parsed.getTime() : null,
      matchedText,
    },
    prefix,
  };
}

/** Probe many events under one config. Aligned to `raws`. */
export function probeTimestamps(raws: string[], config: TimeConfig): TimestampProbe[] {
  return raws.map((raw) => probeTimestamp(raw, config));
}
