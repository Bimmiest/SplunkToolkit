/**
 * Convert Splunk TIME_FORMAT (strftime) strings to parse timestamps from raw text.
 *
 * Supports the most common strftime directives used in Splunk props.conf
 * TIME_FORMAT definitions.
 */

import { escapeRegex } from './splunkRegex';

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MONTH_NAMES_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const WEEKDAY_NAMES_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const WEEKDAY_NAMES_ABBR = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
] as const;

// ---------------------------------------------------------------------------
// Directive metadata: maps a strftime token to its regex fragment and a
// symbolic capture-group name.
// ---------------------------------------------------------------------------

interface DirectiveMeta {
  /** Regex fragment (no surrounding parentheses -- they are added by the builder). */
  regex: string;
  /** Symbolic capture name used during timestamp assembly. */
  capture: string;
}

function buildDirectiveMap(): Record<string, DirectiveMeta> {
  return {
    '%Y': { regex: '(\\d{4})', capture: 'year4' },
    '%y': { regex: '(\\d{2})', capture: 'year2' },
    // POSIX/glibc strptime (which Splunk uses) accepts 1-2 digits for these
    // numeric fields, so unpadded values like `1/5/2024 3:04:05` still parse.
    '%m': { regex: '(\\d{1,2})', capture: 'month' },
    '%d': { regex: '(\\d{1,2})', capture: 'day' },
    '%e': { regex: '(\\s?\\d{1,2})', capture: 'day' },
    '%H': { regex: '(\\d{1,2})', capture: 'hour24' },
    '%I': { regex: '(\\d{1,2})', capture: 'hour12' },
    '%M': { regex: '(\\d{1,2})', capture: 'minute' },
    '%S': { regex: '(\\d{1,2})', capture: 'second' },
    '%p': { regex: '([AaPp][Mm])', capture: 'ampm' },
    '%b': { regex: `(${MONTH_NAMES_ABBR.join('|')})`, capture: 'monthAbbr' },
    '%B': { regex: `(${MONTH_NAMES_FULL.join('|')})`, capture: 'monthFull' },
    '%a': { regex: `(${WEEKDAY_NAMES_ABBR.join('|')})`, capture: 'weekdayAbbr' },
    '%A': { regex: `(${WEEKDAY_NAMES_FULL.join('|')})`, capture: 'weekdayFull' },
    '%Z': { regex: '([A-Za-z][A-Za-z0-9_/+-]*)', capture: 'tzName' },
    // ISO-8601 'Z' (Zulu/UTC), ±HH:MM / ±HHMM, and ±HH-only offsets.
    '%z': { regex: '(Z|[+-]\\d{2}:?\\d{2}|[+-]\\d{2})', capture: 'tzOffset' },
    // Splunk "enhanced strptime" offsets with explicit colons.
    '%:z': { regex: '(Z|[+-]\\d{2}:\\d{2})', capture: 'tzOffset' },
    '%::z': { regex: '(Z|[+-]\\d{2}:\\d{2}:\\d{2})', capture: 'tzOffset' },
    '%s': { regex: '(\\d{10,13})', capture: 'epoch' },
    '%3N': { regex: '(\\d{3})', capture: 'milliseconds' },
    '%6N': { regex: '(\\d{6})', capture: 'microseconds' },
    '%9N': { regex: '(\\d{9})', capture: 'nanoseconds' },
    // Bare %N is Splunk shorthand for %9N (nanoseconds).
    '%N': { regex: '(\\d{9})', capture: 'nanoseconds' },
    // %Q family: subsecond digits, bare %Q == %3Q (milliseconds).
    '%Q': { regex: '(\\d{3})', capture: 'milliseconds' },
    '%3Q': { regex: '(\\d{3})', capture: 'milliseconds' },
    '%6Q': { regex: '(\\d{6})', capture: 'microseconds' },
    '%9Q': { regex: '(\\d{9})', capture: 'nanoseconds' },
    // Additional specifiers
    '%f': { regex: '(\\d{1,6})', capture: 'microsecondsFull' },
    '%j': { regex: '(\\d{3})', capture: 'dayOfYear' },
    '%k': { regex: '(\\s?\\d{1,2})', capture: 'hour24' },  // space-padded 24h, same capture as %H
    '%l': { regex: '(\\s?\\d{1,2})', capture: 'hour12' },  // space-padded 12h, same capture as %I
    // %% is a literal percent -- expanded before the token loop runs.
    // Composite directives -- expanded before the token loop runs.
    '%T': { regex: '', capture: '' }, // placeholder, expanded to %H:%M:%S
    '%F': { regex: '', capture: '' }, // placeholder, expanded to %Y-%m-%d
  };
}

const DIRECTIVE_MAP = buildDirectiveMap();

// ---------------------------------------------------------------------------
// Expand composite directives so the main loop only deals with atomic ones.
// ---------------------------------------------------------------------------
function expandComposites(format: string): string {
  // Walk the string so a `%%` escape consumes both percent signs before we
  // look for a composite: `%%T` must stay a literal `%T`, not expand the inner
  // `%T` into `%%H:%M:%S`.
  let result = '';
  let i = 0;
  while (i < format.length) {
    if (format[i] === '%') {
      const two = format.slice(i, i + 2);
      if (two === '%%') {
        result += '%%';
        i += 2;
        continue;
      }
      if (two === '%T') {
        result += '%H:%M:%S';
        i += 2;
        continue;
      }
      if (two === '%F') {
        result += '%Y-%m-%d';
        i += 2;
        continue;
      }
      result += format[i];
      i += 1;
      continue;
    }
    result += format[i];
    i += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal: tokenise a strftime format string into an ordered list of
// { directive, capture } pairs plus build the combined regex.
// ---------------------------------------------------------------------------

interface TokenisedFormat {
  regex: RegExp;
  captures: string[];
}

/**
 * Tokenised formats, keyed on the format string.
 *
 * `parseTimestamp` calls `tokenise` on every invocation, and auto-recognition
 * calls `parseTimestamp` once per candidate format per event — so a 2000-event
 * run re-walked and re-compiled the same dozen formats thousands of times.
 * Formats come from config, so the key space is small and bounded by the conf.
 */
const tokeniseCache = new Map<string, TokenisedFormat>();

function tokenise(format: string): TokenisedFormat {
  const cached = tokeniseCache.get(format);
  if (cached) return cached;
  const result = tokeniseUncached(format);
  tokeniseCache.set(format, result);
  return result;
}

function tokeniseUncached(format: string): TokenisedFormat {
  const expanded = expandComposites(format);
  const captures: string[] = [];
  let regexStr = '';
  let i = 0;

  while (i < expanded.length) {
    if (expanded[i] === '%') {
      // Try the longest directives first so `%::z` wins over `%:z`, and
      // `%3N`/`%3Q` win over a bare `%` literal. Longest → shortest.
      const fourChar = expanded.slice(i, i + 4);
      const fourMeta = DIRECTIVE_MAP[fourChar];
      if (fourMeta) {
        regexStr += fourMeta.regex;
        captures.push(fourMeta.capture);
        i += 4;
        continue;
      }

      const threeChar = expanded.slice(i, i + 3);
      const threeMeta = DIRECTIVE_MAP[threeChar];
      if (threeMeta) {
        regexStr += threeMeta.regex;
        captures.push(threeMeta.capture);
        i += 3;
        continue;
      }

      // Single-character directive (%Y, %m, etc.)
      const twoChar = expanded.slice(i, i + 2);

      // %% = literal percent sign (no capture group)
      if (twoChar === '%%') {
        regexStr += '%';
        i += 2;
        continue;
      }

      const meta = DIRECTIVE_MAP[twoChar];
      if (meta) {
        regexStr += meta.regex;
        captures.push(meta.capture);
        i += 2;
        continue;
      }

      // Unknown directive -- treat the percent as literal
      regexStr += escapeRegex(expanded.charAt(i));
      i += 1;
    } else {
      // Literal character -- allow flexible whitespace matching when the
      // format contains a space (Splunk is lenient).
      if (expanded.charAt(i) === ' ') {
        regexStr += '\\s+';
      } else {
        regexStr += escapeRegex(expanded.charAt(i));
      }
      i += 1;
    }
  }

  return { regex: new RegExp(regexStr, 'i'), captures };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a strftime format string to a regular expression that will match
 * timestamps produced by that format.
 *
 * The returned regex is **not** anchored so it can be used with
 * `String.prototype.match` to find timestamps embedded in larger strings.
 */
export function strftimeToRegex(format: string): RegExp {
  return tokenise(format).regex;
}

/**
 * Well-known timezone offsets (in minutes from UTC).
 *
 * Only a small subset is included; extend as needed.
 */
const TZ_OFFSETS: Record<string, number> = {
  UTC: 0, GMT: 0,
  EST: -300, EDT: -240,
  CST: -360, CDT: -300,
  MST: -420, MDT: -360,
  PST: -480, PDT: -420,
  IST: 330,
  CET: 60, CEST: 120,
  JST: 540,
  AEST: 600, AEDT: 660,
  NZST: 720, NZDT: 780,
};

/**
 * Formatters for IANA zone names, cached because constructing one is expensive
 * and a batch of events shares a single `TZ`. A name the runtime rejects caches
 * as `null` so it is not retried per event.
 */
const ianaFormatters = new Map<string, Intl.DateTimeFormat | null>();

function ianaFormatter(tz: string): Intl.DateTimeFormat | null {
  const cached = ianaFormatters.get(tz);
  if (cached !== undefined) return cached;

  // Deliberately uninitialized: both branches below assign, so a seed value
  // would be dead (no-useless-assignment).
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      era: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    // RangeError for a name this runtime does not know.
    formatter = null;
  }
  ianaFormatters.set(tz, formatter);
  return formatter;
}

/**
 * The offset, in minutes east of UTC, that a zone was actually at a given
 * instant — which is the whole reason a zone name cannot be reduced to a fixed
 * number. Read by formatting the instant *into* the zone and asking how far the
 * resulting wall clock is from the UTC one.
 */
function ianaOffsetAt(formatter: Intl.DateTimeFormat, atMs: number): number {
  const parts = formatter.formatToParts(new Date(atMs));
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);

  let year = num('year');
  // `era` is requested so a BC year is not silently read as AD — Splunk data
  // will never contain one, but a wrong answer is worse than a rejected one.
  if (parts.find((p) => p.type === 'era')?.value?.startsWith('B')) year = 1 - year;

  // Some ICU versions render midnight as hour 24 under hour12: false.
  const hour = num('hour') === 24 ? 0 : num('hour');

  const asUtc = Date.UTC(year, num('month') - 1, num('day'), hour, num('minute'), num('second'));
  return (asUtc - atMs) / 60_000;
}

/**
 * Turn a wall-clock reading in a named zone into an epoch instant.
 *
 * `wallAsUtcMs` is the timestamp's components assembled as though they were
 * UTC. Two passes: the offset that applied at that numeric instant is a good
 * first guess, and re-reading the offset at the candidate instant corrects it
 * when the guess landed on the wrong side of a DST transition.
 *
 * A wall clock inside a spring-forward gap does not exist, and one inside a
 * fall-back overlap happens twice; this resolves the former forward and the
 * latter to the first occurrence, which is what most strptime implementations
 * do and what a user comparing against a real indexer will usually see.
 */
function ianaWallClockToEpoch(formatter: Intl.DateTimeFormat, wallAsUtcMs: number): number {
  const firstGuess = ianaOffsetAt(formatter, wallAsUtcMs);
  const candidate = wallAsUtcMs - firstGuess * 60_000;
  const refined = ianaOffsetAt(formatter, candidate);
  return refined === firstGuess ? candidate : wallAsUtcMs - refined * 60_000;
}

/**
 * Resolve a timezone specification to an offset in minutes from UTC.
 *
 * Accepts:
 *  - Named abbreviations recognised by the internal table (e.g. "PST").
 *  - Numeric offsets in the form "+HHMM" or "-HHMM" (with optional colon).
 *
 * Returns `null` when the value cannot be resolved. An IANA name such as
 * "Europe/London" resolves through `ianaWallClockToEpoch` instead, because its
 * offset depends on the instant and so cannot be answered here.
 */
function resolveTzOffsetMinutes(tz: string): number | null {
  const upper = tz.toUpperCase();
  // ISO-8601 "Z" (Zulu) designates UTC.
  if (upper === 'Z') return 0;
  const known = TZ_OFFSETS[upper];
  if (known !== undefined) {
    return known;
  }

  // Try parsing as +HHMM / -HH:MM / +HH:MM:SS / +HH (minutes and seconds
  // optional, colons optional) — covers %z, %:z and %::z outputs.
  const m = /^([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?$/.exec(tz);
  if (m) {
    const sign = m[1] === '+' ? 1 : -1;
    const minutes = parseInt(m[2] ?? '0', 10) * 60
      + (m[3] ? parseInt(m[3], 10) : 0)
      + (m[4] ? parseInt(m[4], 10) / 60 : 0);
    return sign * minutes;
  }

  return null;
}

/**
 * Convert captured subsecond digits into whole milliseconds.
 *
 * Handles %3N/%6N/%9N and the %Q family (which share the milliseconds/
 * microseconds/nanoseconds captures) plus %f. Returns 0 when none are present.
 */
function computeSubMilliseconds(bag: Record<string, string>): number {
  if (bag.milliseconds) {
    return parseInt(bag.milliseconds, 10);
  }
  if (bag.microseconds) {
    return Math.floor(parseInt(bag.microseconds, 10) / 1000);
  }
  if (bag.microsecondsFull) {
    // %f: 1-6 digit microseconds — pad to 6 digits then convert to ms.
    const padded = bag.microsecondsFull.padEnd(6, '0');
    return Math.floor(parseInt(padded, 10) / 1000);
  }
  if (bag.nanoseconds) {
    return Math.floor(parseInt(bag.nanoseconds, 10) / 1_000_000);
  }
  return 0;
}

/**
 * Parse a timestamp string using a Splunk strftime format.
 *
 * @param text   - The raw text (or substring) to search for the timestamp.
 * @param format - A strftime format string (e.g. `%Y-%m-%dT%H:%M:%S.%3N`).
 * @param tz     - Optional fallback timezone name or offset used when the
 *                 format itself does not contain %Z / %z.  Defaults to UTC.
 * @param onUnresolvedTz - Called with the offending value when a named zone
 *                 (%Z or the `tz` fallback) can't be resolved and is treated as
 *                 UTC, so callers can surface a diagnostic instead of silent drift.
 * @returns A `Date` object if parsing succeeded, or `null` otherwise.
 */
export function parseTimestamp(
  text: string,
  format: string,
  tz?: string,
  onUnresolvedTz?: (tz: string) => void,
): Date | null {
  const { regex, captures } = tokenise(format);
  const match = text.match(regex);
  if (!match) {
    return null;
  }

  // Build a bag of parsed components.
  const bag: Record<string, string> = {};
  for (const [i, captureName] of captures.entries()) {
    const value = match[i + 1];
    if (value !== undefined) {
      bag[captureName] = value.trim();
    }
  }

  // Subsecond digits captured by %3N/%6N/%9N, the %Q family, or %f, converted
  // to whole milliseconds. Shared by the epoch and calendar paths.
  const subMilliseconds = computeSubMilliseconds(bag);

  // -----------------------------------------------------------------------
  // Handle epoch seconds / milliseconds directly
  // -----------------------------------------------------------------------
  if (bag.epoch) {
    const epochNum = parseInt(bag.epoch, 10);
    // If the value is 13 digits it is already milliseconds; a captured
    // subsecond field would be below ms resolution, so leave it as-is.
    if (bag.epoch.length >= 13) {
      return new Date(epochNum);
    }
    // Seconds since epoch: fold in any subseconds from e.g. `%s%3N`/`%s%3Q`.
    return new Date(epochNum * 1000 + subMilliseconds);
  }

  // -----------------------------------------------------------------------
  // Assemble date components
  // -----------------------------------------------------------------------
  let year: number;
  if (bag.year4) {
    year = parseInt(bag.year4, 10);
  } else if (bag.year2) {
    const y2 = parseInt(bag.year2, 10);
    // POSIX %y pivot: 69-99 → 1969-1999, 00-68 → 2000-2068.
    year = y2 >= 69 ? 1900 + y2 : 2000 + y2;
  } else {
    // Default to current year when the format doesn't include a year.
    year = new Date().getFullYear();
  }

  let month: number; // 0-indexed
  if (bag.month) {
    month = parseInt(bag.month, 10) - 1;
  } else if (bag.monthAbbr) {
    month = MONTH_NAMES_ABBR.indexOf(
      bag.monthAbbr.charAt(0).toUpperCase() + bag.monthAbbr.slice(1).toLowerCase() as typeof MONTH_NAMES_ABBR[number],
    );
    if (month === -1) month = 0;
  } else if (bag.monthFull) {
    month = MONTH_NAMES_FULL.indexOf(
      bag.monthFull.charAt(0).toUpperCase() + bag.monthFull.slice(1).toLowerCase() as typeof MONTH_NAMES_FULL[number],
    );
    if (month === -1) month = 0;
  } else {
    month = 0;
  }

  // %j: day-of-year (001-366) — convert to month+day when no month/day present
  let day: number;
  if (bag.dayOfYear && !bag.day && !bag.month) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const months = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const maxDoy = isLeap ? 366 : 365;
    const doy = Math.max(1, Math.min(parseInt(bag.dayOfYear, 10), maxDoy));
    let rem = doy;
    let m = 0;
    for (const monthLength of months) {
      if (rem <= monthLength) break;
      rem -= monthLength;
      m++;
    }
    month = m;
    day = rem;
  } else {
    day = bag.day ? parseInt(bag.day, 10) : 1;
  }

  let hour: number;
  if (bag.hour24) {
    hour = parseInt(bag.hour24, 10);
  } else if (bag.hour12) {
    hour = parseInt(bag.hour12, 10);
    const isPM = bag.ampm && /pm/i.test(bag.ampm);
    const isAM = bag.ampm && /am/i.test(bag.ampm);
    if (isPM && hour !== 12) {
      hour += 12;
    } else if (isAM && hour === 12) {
      hour = 0;
    }
  } else {
    hour = 0;
  }

  const minute = bag.minute ? parseInt(bag.minute, 10) : 0;
  const second = bag.second ? parseInt(bag.second, 10) : 0;

  // Reject out-of-range components rather than letting Date.UTC silently roll
  // over (e.g. %m=13 → the next January, %d=32 → the next month, %H=25 → the
  // next day). Splunk treats an out-of-range field as a parse failure.
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 0 || month > 11 ||
    day < 1 || day > (daysInMonth[month] ?? 0) ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    second < 0 || second > 60 // allow a leap second
  ) {
    return null;
  }

  const milliseconds = subMilliseconds;

  // -----------------------------------------------------------------------
  // Resolve timezone offset
  // -----------------------------------------------------------------------
  // The components read as though they were UTC. Every branch below is a
  // question about how far the real instant is from this one.
  const wallAsUtcMs = Date.UTC(year, month, day, hour, minute, second, milliseconds);

  // A zone written in the event (%Z) beats the stanza's TZ, and an explicit
  // numeric offset (%z) beats both — it needs no resolution at all.
  const zoneName = bag.tzName ?? tz;

  if (bag.tzOffset) {
    // %z only ever matches Z or a numeric offset, so this always resolves.
    const offsetMinutes = resolveTzOffsetMinutes(bag.tzOffset) ?? 0;
    return new Date(wallAsUtcMs - offsetMinutes * 60_000);
  }

  if (zoneName) {
    // A fixed offset or a known abbreviation is a constant, so answer directly.
    const fixed = resolveTzOffsetMinutes(zoneName);
    if (fixed !== null) return new Date(wallAsUtcMs - fixed * 60_000);

    // Otherwise it may be an IANA name, whose offset depends on the date --
    // which is exactly why the abbreviation table cannot answer it.
    const formatter = ianaFormatter(zoneName);
    if (formatter) return new Date(ianaWallClockToEpoch(formatter, wallAsUtcMs));

    // Genuinely unresolvable: a typo, or a zone this runtime has no data for.
    onUnresolvedTz?.(zoneName);
  }

  // No timezone info at all -- assume UTC.
  return new Date(wallAsUtcMs);
}
