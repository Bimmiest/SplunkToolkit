import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';

export function Header() {
  const result = useAppStore((s) => s.processingResult);
  const diagnostics = useAppStore((s) => s.validationDiagnostics);
  const isProcessing = useAppStore((s) => s.isProcessing);

  const fieldCount = useMemo(() => {
    if (!result) return 0;
    const fieldSet = new Set<string>();
    for (const event of result.events) {
      for (const key of Object.keys(event.fields)) {
        fieldSet.add(key);
      }
    }
    return fieldSet.size;
  }, [result]);

  const errorCount = useMemo(() => diagnostics.filter((d) => d.level === 'error').length, [diagnostics]);
  const warningCount = useMemo(() => diagnostics.filter((d) => d.level === 'warning').length, [diagnostics]);

  return (
    <header
      role="banner"
      className="flex flex-col shrink-0"
      style={{
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
    <div className="flex items-center justify-between px-4 h-12">
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" className="w-5 h-5 shrink-0">
          <path d="M14.5 4h3l.5 3.2a9 9 0 0 1 2.2 1.3l3-1.3 1.5 2.6-2.5 2a9 9 0 0 1 0 2.6l2.5 2-1.5 2.6-3-1.3a9 9 0 0 1-2.2 1.3L17.5 20h-3l-.5-3.2a9 9 0 0 1-2.2-1.3l-3 1.3-1.5-2.6 2.5-2a9 9 0 0 1 0-2.6l-2.5-2 1.5-2.6 3 1.3A9 9 0 0 1 14 7.2L14.5 4z" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(96,165,250,0.15)"/>
          <circle cx="16" cy="12" r="3" stroke="var(--color-accent)" strokeWidth="1.5" fill="none"/>
          <circle cx="20" cy="22" r="4.5" stroke="var(--color-accent)" strokeWidth="1.8" fill="rgba(96,165,250,0.1)"/>
          <line x1="23.5" y1="25.5" x2="27.5" y2="29.5" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <h1
          className="text-sm font-bold tracking-wide"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Splunk Toolkit
        </h1>
      </div>
      <div className="flex items-center gap-3">
        {result && (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {result.eventCount} event{result.eventCount !== 1 ? 's' : ''}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {fieldCount} field{fieldCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}
        {(errorCount > 0 || warningCount > 0) && (
          <div className="flex items-center gap-1.5">
            {errorCount > 0 && <Badge variant="error">{errorCount} error{errorCount !== 1 ? 's' : ''}</Badge>}
            {warningCount > 0 && <Badge variant="warning">{warningCount} warning{warningCount !== 1 ? 's' : ''}</Badge>}
          </div>
        )}
        {result && errorCount === 0 && warningCount === 0 && (
          <Badge variant="success">Valid</Badge>
        )}
        <ThemeToggle />
      </div>
    </div>
    {isProcessing && <ProgressBar />}
    </header>
  );
}
