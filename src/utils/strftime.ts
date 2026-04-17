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
    '%m': { regex: '(\\d{2})', capture: 'month' },
    '%d': { regex: '(\\d{2})', capture: 'day' },
    '%e': { regex: '(\\s?\\d{1,2})', capture: 'day' },
    '%H': { regex: '(\\d{2})', capture: 'hour24' },
    '%I': { regex: '(\\d{2})', capture: 'hour12' },
    '%M': { regex: '(\\d{2})', capture: 'minute' },
    '%S': { regex: '(\\d{2})', capture: 'second' },
    '%p': { regex: '([AaPp][Mm])', capture: 'ampm' },
    '%b': { regex: `(${MONTH_NAMES_ABBR.join('|')})`, capture: 'monthAbbr' },
    '%B': { regex: `(${MONTH_NAMES_FULL.join('|')})`, capture: 'monthFull' },
    '%a': { regex: `(${WEEKDAY_NAMES_ABBR.join('|')})`, capture: 'weekdayAbbr' },
    '%A': { regex: `(${WEEKDAY_NAMES_FULL.join('|')})`, capture: 'weekdayFull' },
    '%Z': { regex: '([A-Za-z][A-Za-z0-9_/+-]*)', capture: 'tzName' },
    '%z': { regex: '([+-]\\d{2}:?\\d{2})', capture: 'tzOffset' },
    '%s': { regex: '(\\d{10,13})', capture: 'epoch' },
    '%3N': { regex: '(\\d{3})', capture: 'milliseconds' },
    '%6N': { regex: '(\\d{6})', capture: 'microseconds' },
    '%9N': { regex: '(\\d{9})', capture: 'nanoseconds' },
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
  let result = format;
  // Keep expanding until no composites remain (safe against double-expansion
  // because the replacements don't re-introduce %T or %F).
  result = result.replace(/%T/g, '%H:%M:%S');
  result = result.replace(/%F/g, '%Y-%m-%d');
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

function tokenise(format: string): TokenisedFormat {
  const expanded = expandComposites(format);
  const captures: string[] = [];
  let regexStr = '';
  let i = 0;

  while (i < expanded.length) {
    if (expanded[i] === '%') {
      // Try multi-character directives first (%3N, %6N, %9N)
      const threeChar = expanded.slice(i, i + 3);
      if (threeChar === '%3N' || threeChar === '%6N' || threeChar === '%9N') {
        const meta = DIRECTIVE_MAP[threeChar];
        regexStr += meta.regex;
        captures.push(meta.capture);
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
      regexStr += escapeRegex(expanded[i]);
      i += 1;
    } else {
      // Literal character -- allow flexible whitespace matching when the
      // format contains a space (Splunk is lenient).
      if (expanded[i] === ' ') {
        regexStr += '\\s+';
      } else {
        regexStr += escapeRegex(expanded[i]);
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
 * Resolve a timezone specification to an offset in minutes from UTC.
 *
 * Accepts:
 *  - Named abbreviations recognised by the internal table (e.g. "PST").
 *  - Numeric offsets in the form "+HHMM" or "-HHMM" (with optional colon).
 *
 * Returns 0 (UTC) when the value cannot be resolved.
 */
function resolveTzOffsetMinutes(tz: string): number {
  const upper = tz.toUpperCase();
  if (upper in TZ_OFFSETS) {
    return TZ_OFFSETS[upper];
  }

  // Try parsing as +HHMM / -HH:MM
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(tz);
  if (m) {
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
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
 * @returns A `Date` object if parsing succeeded, or `null` otherwise.
 */
export function parseTimestamp(text: string, format: string, tz?: string): Date | null {
  const { regex, captures } = tokenise(format);
  const match = text.match(regex);
  if (!match) {
    return null;
  }

  // Build a bag of parsed components.
  const bag: Record<string, string> = {};
  for (let i = 0; i < captures.length; i++) {
    const captureName = captures[i];
    const value = match[i + 1];
    if (value !== undefined) {
      bag[captureName] = value.trim();
    }
  }

  // -----------------------------------------------------------------------
  // Handle epoch seconds / milliseconds directly
  // -----------------------------------------------------------------------
  if (bag.epoch) {
    const epochNum = parseInt(bag.epoch, 10);
    // If the value is 13 digits it is already milliseconds.
    if (bag.epoch.length >= 13) {
      return new Date(epochNum);
    }
    return new Date(epochNum * 1000);
  }

  // -----------------------------------------------------------------------
  // Assemble date components
  // -----------------------------------------------------------------------
  let year: number;
  if (bag.year4) {
    year = parseInt(bag.year4, 10);
  } else if (bag.year2) {
    const y2 = parseInt(bag.year2, 10);
    year = y2 >= 70 ? 1900 + y2 : 2000 + y2;
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
    while (m < 12 && rem > months[m]) rem -= months[m++];
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

  let milliseconds = 0;
  if (bag.milliseconds) {
    milliseconds = parseInt(bag.milliseconds, 10);
  } else if (bag.microseconds) {
    milliseconds = Math.floor(parseInt(bag.microseconds, 10) / 1000);
  } else if (bag.microsecondsFull) {
    // %f: 1-6 digit microseconds — pad to 6 digits then convert to ms
    const padded = bag.microsecondsFull.padEnd(6, '0');
    milliseconds = Math.floor(parseInt(padded, 10) / 1000);
  } else if (bag.nanoseconds) {
    milliseconds = Math.floor(parseInt(bag.nanoseconds, 10) / 1_000_000);
  }

  // -----------------------------------------------------------------------
  // Resolve timezone offset
  // -----------------------------------------------------------------------
  let offsetMinutes: number | null = null;

  if (bag.tzOffset) {
    offsetMinutes = resolveTzOffsetMinutes(bag.tzOffset);
  } else if (bag.tzName) {
    const resolved = resolveTzOffsetMinutes(bag.tzName);
    offsetMinutes = resolved; // 0 if unrecognised -- treat as UTC
  } else if (tz) {
    offsetMinutes = resolveTzOffsetMinutes(tz);
  }

  // -----------------------------------------------------------------------
  // Build the Date
  // -----------------------------------------------------------------------
  if (offsetMinutes !== null) {
    // Construct as UTC then adjust by the offset.
    const utcMs = Date.UTC(year, month, day, hour, minute, second, milliseconds);
    return new Date(utcMs - offsetMinutes * 60_000);
  }

  // No timezone info at all -- assume UTC.
  return new Date(Date.UTC(year, month, day, hour, minute, second, milliseconds));
}
