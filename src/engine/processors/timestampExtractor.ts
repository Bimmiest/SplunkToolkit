import type { SplunkEvent, ConfDirective } from '../types';
import { safeRegex } from '../../utils/splunkRegex';
import { parseTimestamp, strftimeToRegex } from '../../utils/strftime';

export function extractTimestamps(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const timePrefixDir = directives.find((d) => d.key === 'TIME_PREFIX');
  const timeFormatDir = directives.find((d) => d.key === 'TIME_FORMAT');
  const maxLookaheadDir = directives.find((d) => d.key === 'MAX_TIMESTAMP_LOOKAHEAD');
  const tzDir = directives.find((d) => d.key === 'TZ');

  if (!timeFormatDir) return events;

  const timeFormat = timeFormatDir.value.trim();
  const maxLookahead = maxLookaheadDir ? parseInt(maxLookaheadDir.value.trim(), 10) : 128;
  const tz = tzDir?.value.trim();

  const timePrefixRegex = timePrefixDir ? safeRegex(timePrefixDir.value.trim()) : null;
  const formatRegex = strftimeToRegex(timeFormat);

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
  });
}
