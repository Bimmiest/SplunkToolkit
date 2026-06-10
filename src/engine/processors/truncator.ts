import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export function truncateEvents(
  events: SplunkEvent[],
  directives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const truncateDir = directives.find((d) => d.key === 'TRUNCATE');
  const isDefault = !truncateDir;
  const maxBytes = truncateDir ? parseInt(truncateDir.value.trim(), 10) : 10000;

  // A non-numeric TRUNCATE (e.g. a typo) parses to NaN. Without this guard the
  // byte-length comparisons below are all false-y in a way that slices every
  // event to an empty string — one typo silently blanks the entire preview.
  // Real Splunk ignores an invalid TRUNCATE and keeps the default behaviour.
  if (truncateDir && !Number.isFinite(maxBytes)) {
    diagnostics?.push({
      level: 'warning',
      message: `TRUNCATE = "${truncateDir.value.trim()}" is not a number and was ignored. TRUNCATE expects a byte count (default 10000; 0 disables truncation).`,
      file: 'props.conf',
      line: truncateDir.line,
      directiveKey: truncateDir.key,
    });
    return events;
  }

  if (maxBytes <= 0) return events;

  return events.map((event) => {
    const bytes = encoder.encode(event._raw);
    if (bytes.length <= maxBytes) return event;

    const truncated = decoder.decode(bytes.slice(0, maxBytes));
    const suffix = isDefault ? ' (TRUNCATE default)' : ` (TRUNCATE=${maxBytes})`;
    return {
      ...event,
      _raw: truncated,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'truncator',
          phase: 'index-time' as const,
          description: `Truncated event from ${bytes.length} to ${maxBytes} bytes${suffix}`,
          inputSnapshot: event._raw.substring(0, 100) + '...',
        },
      ],
    };
  });
}
