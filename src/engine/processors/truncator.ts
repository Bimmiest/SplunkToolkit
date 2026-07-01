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
  const rawValue = truncateDir?.value.trim() ?? '';
  const maxBytes = truncateDir ? parseInt(rawValue, 10) : 10000;

  // TRUNCATE must be a clean non-negative integer (byte count). parseInt is far
  // too lenient — "0x10"→0 (silently disables truncation), "1e3"→1 (truncates
  // every event to ~1 byte), "100abc"→100 (no warning) — so validate the exact
  // form and ignore anything else, as real Splunk does, rather than silently
  // truncating with a wrong length or blanking the whole preview.
  if (truncateDir && !/^\d+$/.test(rawValue)) {
    diagnostics?.push({
      level: 'warning',
      message: `TRUNCATE = "${rawValue}" is not a valid byte count and was ignored. TRUNCATE expects a non-negative integer (default 10000; 0 disables truncation).`,
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
