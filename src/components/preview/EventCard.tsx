import type { SplunkEvent } from '../../engine/types';

interface EventCardProps {
  event: SplunkEvent;
  index: number;
  showFields?: boolean;
}

function formatTime(date: Date | null): string {
  if (!date) return '';
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export function EventCard({ event, index, showFields = false }: EventCardProps) {
  const fieldEntries = Object.entries(event.fields);

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{
          backgroundColor: 'var(--color-bg-tertiary)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span
          className="text-xs font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Event #{index + 1}
        </span>
        {event._time && (
          <span
            className="text-xs font-mono"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {formatTime(event._time)}
          </span>
        )}
      </div>

      {/* Raw content */}
      <div className="px-3 py-2">
        <pre
          className="text-sm font-mono whitespace-pre-wrap break-words m-0 leading-relaxed"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {event._raw}
        </pre>
      </div>

      {/* Fields section */}
      {showFields && fieldEntries.length > 0 && (
        <div
          className="px-3 py-2"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div
            className="text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Fields
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {fieldEntries.map(([key, value]) => (
              <div key={key} className="flex items-baseline gap-1 text-xs">
                <span
                  className="font-medium"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {key}
                </span>
                <span style={{ color: 'var(--color-text-muted)' }}>=</span>
                <span
                  className="font-mono"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {Array.isArray(value) ? value.join(', ') : value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
