import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function StatusBar() {
  const result = useAppStore((s) => s.processingResult);
  const diagnostics = useAppStore((s) => s.validationDiagnostics);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const lastProcessingMs = useAppStore((s) => s.lastProcessingMs);

  const fieldCount = useMemo(() => {
    if (!result) return 0;
    const fieldSet = new Set<string>();
    for (const event of result.events) {
      for (const key of Object.keys(event.fields)) fieldSet.add(key);
    }
    return fieldSet.size;
  }, [result]);

  const errorCount = useMemo(() => diagnostics.filter((d) => d.level === 'error').length, [diagnostics]);
  const warningCount = useMemo(() => diagnostics.filter((d) => d.level === 'warning').length, [diagnostics]);

  const timingLabel = lastProcessingMs !== null
    ? lastProcessingMs < 1000
      ? `${Math.round(lastProcessingMs)}ms`
      : `${(lastProcessingMs / 1000).toFixed(1)}s`
    : null;

  return (
    <div
      className="flex items-center justify-between px-4 h-6 shrink-0 text-[11px] select-none"
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderTop: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
      }}
    >
      {/* Left: worker + timing */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: isProcessing
                ? 'var(--color-accent)'
                : result
                  ? '#22c55e'
                  : 'var(--color-text-muted)',
            }}
          />
          {isProcessing ? 'Processing…' : result ? 'Worker idle' : 'Ready'}
        </span>
        {timingLabel && !isProcessing && (
          <span>{timingLabel}</span>
        )}
      </div>

      {/* Right: events / fields / diagnostics */}
      <div className="flex items-center gap-3">
        {result && (
          <>
            <span>{result.eventCount} event{result.eventCount !== 1 ? 's' : ''}</span>
            <span>{fieldCount} field{fieldCount !== 1 ? 's' : ''}</span>
          </>
        )}
        {errorCount > 0 && (
          <span style={{ color: '#f87171' }}>{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
        )}
        {warningCount > 0 && (
          <span style={{ color: '#fb923c' }}>{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
        )}
        {result && errorCount === 0 && warningCount === 0 && (
          <span style={{ color: '#4ade80' }}>✓ Valid</span>
        )}
      </div>
    </div>
  );
}
