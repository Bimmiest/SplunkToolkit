import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { ThemeToggle } from '../ui/ThemeToggle';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { Icon } from '../ui/Icon';
import { ClearButton } from '../editor/ClearButton';

export function Header() {
  const result = useAppStore((s) => s.processingResult);
  const diagnostics = useAppStore((s) => s.validationDiagnostics);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const setRawData = useAppStore((s) => s.setRawData);
  const setPropsConf = useAppStore((s) => s.setPropsConf);
  const setTransformsConf = useAppStore((s) => s.setTransformsConf);
  const setMetadata = useAppStore((s) => s.setMetadata);

  const resetAll = () => {
    setRawData('');
    setPropsConf('');
    setTransformsConf('');
    setMetadata({ index: 'main', host: '', source: '', sourcetype: '' });
  };

  const hasAnyContent = !!useAppStore((s) => s.rawData || s.propsConf || s.transformsConf);

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
        <Icon name="settings" className="w-5 h-5 shrink-0 text-[var(--color-accent)]" />
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
        {hasAnyContent && (
          <ClearButton onClear={resetAll} label="Clear All" />
        )}
        <ThemeToggle />
      </div>
    </div>
    {isProcessing && <ProgressBar />}
    {/* Screen-reader live region — announces diagnostic changes */}
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {errorCount > 0
        ? `${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warningCount} warning${warningCount !== 1 ? 's' : ''}`
        : warningCount > 0
          ? `${warningCount} warning${warningCount !== 1 ? 's' : ''}`
          : result
            ? 'Configuration valid'
            : ''}
    </div>
    </header>
  );
}
