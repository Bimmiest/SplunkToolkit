import type { SplunkEvent, ConfDirective } from '../types';
import { safeRegex } from '../../utils/splunkRegex';
import { parseTimestamp, strftimeToRegex } from '../../utils/strftime';

/**
 * Priority-ordered formats for automatic timestamp recognition when no
 * TIME_FORMAT is configured. A pragmatic subset of Splunk's datetime.xml —
 * ordered most-specific first so an ISO 8601 timestamp with a zone offset is
 * preferred over a variant without one (and over a bare date).
 */
const AUTO_TIME_FORMATS = [
  '%Y-%m-%dT%H:%M:%S.%3N%z',
  '%Y-%m-%dT%H:%M:%S%z',
  '%Y-%m-%dT%H:%M:%S.%3N',
  '%Y-%m-%dT%H:%M:%S',
  '%Y-%m-%d %H:%M:%S.%3N',
  '%Y-%m-%d %H:%M:%S',
  '%d/%b/%Y:%H:%M:%S %z', // Apache access log
  '%b %e %H:%M:%S',        // syslog (no year → current year, space-padded day)
  '%m/%d/%Y %H:%M:%S',
  '%Y/%m/%d %H:%M:%S',
  '%m/%d/%Y',
  '%Y-%m-%d',
];

// Compile the recognition regexes once. They are non-global, so `.exec` is
// stateless across events and calls.
const AUTO_PATTERNS = AUTO_TIME_FORMATS.map((fmt) => ({ fmt, regex: strftimeToRegex(fmt) }));

/**
 * Try to find a timestamp in `region` using the auto-recognition patterns, then
 * a leading-epoch fallback. Returns the parsed date plus the format that matched.
 */
function autoRecognize(region: string, tz?: string): { date: Date; format: string } | null {
  for (const { fmt, regex } of AUTO_PATTERNS) {
    const m = regex.exec(region);
    if (!m) continue;
    const date = parseTimestamp(m[0], fmt, tz);
    if (date && !isNaN(date.getTime())) return { date, format: fmt };
  }
  // Epoch seconds (10 digits) or milliseconds (13) at the very start of the region.
  // Anchored to avoid mistaking arbitrary long numbers elsewhere for a timestamp.
  const epoch = /^\s*(\d{13}|\d{10})(?![0-9])/.exec(region);
  if (epoch) {
    const digits = epoch[1];
    const ms = digits.length >= 13 ? Number(digits) : Number(digits) * 1000;
    const date = new Date(ms);
    if (!isNaN(date.getTime())) return { date, format: 'epoch' };
  }
  return null;
}

export function extractTimestamps(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const timePrefixDir = directives.find((d) => d.key === 'TIME_PREFIX');
  const timeFormatDir = directives.find((d) => d.key === 'TIME_FORMAT');
  const maxLookaheadDir = directives.find((d) => d.key === 'MAX_TIMESTAMP_LOOKAHEAD');
  const tzDir = directives.find((d) => d.key === 'TZ');

  const timeFormat = timeFormatDir?.value.trim();
  const parsedLookahead = maxLookaheadDir ? parseInt(maxLookaheadDir.value.trim(), 10) : 150;
  const maxLookahead = Number.isFinite(parsedLookahead) && parsedLookahead > 0 ? parsedLookahead : 150;
  const tz = tzDir?.value.trim();

  const timePrefixRegex = timePrefixDir ? safeRegex(timePrefixDir.value.trim()) : null;
  const formatRegex = timeFormat ? strftimeToRegex(timeFormat) : null;

  return events.map((event) => {
    const raw = event._raw;
    let searchStart = 0;

    if (timePrefixRegex) {
      const match = timePrefixRegex.exec(raw);
      if (match) {
        searchStart = match.index + match[0].length;
      } else {
        return event;
      }
    }

    const searchEnd = Math.min(searchStart + maxLookahead, raw.length);
    const searchRegion = raw.substring(searchStart, searchEnd);

    // Explicit TIME_FORMAT path.
    if (timeFormat && formatRegex) {
      const formatMatch = formatRegex.exec(searchRegion);
      if (!formatMatch) return event;

      const timestampStr = formatMatch[0];
      const parsedTime = parseTimestamp(timestampStr, timeFormat, tz);

      return {
        ...event,
        _time: parsedTime,
        processingTrace: [
          ...event.processingTrace,
          {
            processor: 'timestampExtractor',
            phase: 'index-time' as const,
            description: parsedTime
              ? `Extracted timestamp: ${parsedTime.toISOString()}`
              : `Failed to parse timestamp from: "${timestampStr}"`,
          },
        ],
      };
    }

    // No TIME_FORMAT → automatic timestamp recognition (datetime.xml-style).
    const auto = autoRecognize(searchRegion, tz);
    if (!auto) return event;

    return {
      ...event,
      _time: auto.date,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'timestampExtractor',
          phase: 'index-time' as const,
          description: `Auto-recognized timestamp (${auto.format}): ${auto.date.toISOString()}`,
        },
      ],
    };
  });
}
