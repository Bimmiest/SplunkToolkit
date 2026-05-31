import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../../../ui/Icon';

/**
 * Shared overlay shell for the "scaffold from selection" dialogs (Create EXTRACT,
 * Set TIME_PREFIX). Handles the backdrop, Esc/Enter, and the header/footer; the
 * caller supplies the body (inputs + preview) and the apply logic.
 */
export function DirectiveDialog({
  title,
  applyLabel,
  applyDisabled,
  onApply,
  onClose,
  children,
}: {
  title: string;
  applyLabel: string;
  applyDisabled: boolean;
  onApply: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] px-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !applyDisabled) { e.preventDefault(); onApply(); } }}
      >
        <div className="flex items-center gap-2 px-4 h-11 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Icon name="sparkles" className="w-4 h-4 text-[var(--color-accent)]" />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{title}</span>
        </div>

        <div className="p-4 space-y-3">{children}</div>

        <div className="flex items-center justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md cursor-pointer border-none outline-none text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
          >
            Cancel
          </button>
          <button
            onClick={onApply}
            disabled={applyDisabled}
            className="px-3 py-1.5 text-sm rounded-md cursor-pointer border-none outline-none font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
