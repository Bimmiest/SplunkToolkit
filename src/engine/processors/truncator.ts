import type { SplunkEvent, ConfDirective } from '../types';

export function truncateEvents(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const truncateDir = directives.find((d) => d.key === 'TRUNCATE');
  const maxBytes = truncateDir ? parseInt(truncateDir.value.trim(), 10) : 10000;

  if (maxBytes <= 0) return events;

  return events.map((event) => {
    if (event._raw.length <= maxBytes) return event;

    return {
      ...event,
      _raw: event._raw.substring(0, maxBytes),
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'truncator',
          phase: 'index-time' as const,
          description: `Truncated event from ${event._raw.length} to ${maxBytes} characters`,
          inputSnapshot: event._raw.substring(0, 100) + '...',
        },
      ],
    };
  });
}
