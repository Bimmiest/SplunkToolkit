import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../ui/Badge';
import type { ValidationDiagnostic } from '../../engine/types';

export function ValidationPanel({ embedded }: { embedded?: boolean }) {
  const diagnostics = useAppStore((s) => s.validationDiagnostics);

  const errors = diagnostics.filter((d) => d.level === 'error');
  const warnings = diagnostics.filter((d) => d.level === 'warning');
  const infos = diagnostics.filter((d) => d.level === 'info');

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)]">
      {!embedded && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-[var(--color-text-primary)]">Validation</span>
          </div>
          <div className="flex items-center gap-2">
            {errors.length > 0 && <Badge variant="error">{errors.length} error{errors.length !== 1 ? 's' : ''}</Badge>}
            {warnings.length > 0 && <Badge variant="warning">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</Badge>}
            {infos.length > 0 && <Badge variant="info">{infos.length} info</Badge>}
            {diagnostics.length === 0 && <Badge variant="success">Valid</Badge>}
          </div>
        </div>
      )}
      {embedded && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          {errors.length > 0 && <Badge variant="error">{errors.length} error{errors.length !== 1 ? 's' : ''}</Badge>}
          {warnings.length > 0 && <Badge variant="warning">{warnings.length} warning{warnings.length !== 1 ? 's' : ''}</Badge>}
          {infos.length > 0 && <Badge variant="info">{infos.length} info</Badge>}
          {diagnostics.length === 0 && <Badge variant="success">No issues detected</Badge>}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {diagnostics.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
            No issues detected
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {diagnostics.map((diag, idx) => (
              <ValidationItem key={idx} diagnostic={diag} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ValidationItem({ diagnostic }: { diagnostic: ValidationDiagnostic }) {
  const iconColor = diagnostic.level === 'error'
    ? 'var(--color-error)'
    : diagnostic.level === 'warning'
      ? 'var(--color-warning)'
      : 'var(--color-info)';

  return (
    <div className="flex items-start gap-2 px-3 py-2 hover:bg-[var(--color-bg-tertiary)] transition-colors">
      <div className="flex-shrink-0 mt-0.5">
        {diagnostic.level === 'error' ? (
          <svg className="w-4 h-4" style={{ color: iconColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : diagnostic.level === 'warning' ? (
          <svg className="w-4 h-4" style={{ color: iconColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" style={{ color: iconColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[var(--color-text-primary)]">{diagnostic.message}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[var(--color-text-muted)]">{diagnostic.file}</span>
          {diagnostic.line !== undefined && (
            <span className="text-xs text-[var(--color-accent)] cursor-pointer hover:underline">
              line {diagnostic.line}
            </span>
          )}
          {diagnostic.directiveKey && (
            <span className="text-xs font-mono text-[var(--color-text-muted)]">{diagnostic.directiveKey}</span>
          )}
        </div>
        {diagnostic.suggestion && (
          <div className="text-xs text-[var(--color-success)] mt-0.5">{diagnostic.suggestion}</div>
        )}
      </div>
    </div>
  );
}
