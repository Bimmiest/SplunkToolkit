import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { ValidationDiagnostic } from '../../engine/types';

interface EditorValidationListProps {
  file: 'props.conf' | 'transforms.conf';
}

export function EditorValidationList({ file }: EditorValidationListProps) {
  const diagnostics = useAppStore((s) => s.validationDiagnostics);
  const [expanded, setExpanded] = useState(true);

  const filtered = useMemo(
    () => diagnostics.filter((d) => d.file === file),
    [diagnostics, file]
  );

  const errorCount = filtered.filter((d) => d.level === 'error').length;
  const warningCount = filtered.filter((d) => d.level === 'warning').length;
  const infoCount = filtered.filter((d) => d.level === 'info').length;

  if (filtered.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <StatusIcon level="success" />
        <span className="text-xs text-[var(--color-success)]">No issues</span>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1 hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <span className="text-xs font-medium text-[var(--color-error)]">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-xs font-medium text-[var(--color-warning)]">
              {warningCount} warning{warningCount !== 1 ? 's' : ''}
            </span>
          )}
          {infoCount > 0 && (
            <span className="text-xs font-medium text-[var(--color-info)]">
              {infoCount} info
            </span>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="max-h-32 overflow-auto divide-y divide-[var(--color-border)]">
          {filtered.map((diag, idx) => (
            <DiagnosticRow key={idx} diagnostic={diag} onNavigate={diag.line !== undefined ? () => {
              const ed = useAppStore.getState().editorInstances[file];
              if (!ed || diag.line === undefined) return;
              ed.focus();
              requestAnimationFrame(() => {
                ed.setPosition({ lineNumber: diag.line!, column: 1 });
                ed.revealLineInCenter(diag.line!);
              });
            } : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticRow({ diagnostic, onNavigate }: { diagnostic: ValidationDiagnostic; onNavigate?: () => void }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-bg-tertiary)] transition-colors ${onNavigate ? 'cursor-pointer' : ''}`}
      onClick={onNavigate}
    >
      <div className="flex-shrink-0">
        <StatusIcon level={diagnostic.level} />
      </div>
      <div className="flex-1 min-w-0 truncate">
        <span className="text-xs text-[var(--color-text-primary)]">{diagnostic.message}</span>
        {diagnostic.line !== undefined && (
          <span className="ml-2 text-xs text-[var(--color-text-muted)]">line {diagnostic.line}</span>
        )}
        {diagnostic.suggestion && (
          <div className="text-xs text-[var(--color-success)] truncate">{diagnostic.suggestion}</div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ level }: { level: 'error' | 'warning' | 'info' | 'success' }) {
  const color = level === 'error'
    ? 'var(--color-error)'
    : level === 'warning'
      ? 'var(--color-warning)'
      : level === 'success'
        ? 'var(--color-success)'
        : 'var(--color-info)';

  if (level === 'success') {
    return (
      <svg className="w-3.5 h-3.5" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (level === 'error') {
    return (
      <svg className="w-3.5 h-3.5" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  if (level === 'warning') {
    return (
      <svg className="w-3.5 h-3.5" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    );
  }

  return (
    <svg className="w-3.5 h-3.5" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
