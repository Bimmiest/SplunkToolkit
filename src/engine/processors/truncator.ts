import type { SplunkEvent, ConfDirective } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export function truncateEvents(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const truncateDir = directives.find((d) => d.key === 'TRUNCATE');
  const isDefault = !truncateDir;
  const maxBytes = truncateDir ? parseInt(truncateDir.value.trim(), 10) : 10000;

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
