import type { ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icon } from '../../../ui/Icon';
import { useOverlay } from '../../../../hooks/useOverlay';

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
  // Escape closes only the topmost overlay — this dialog opens over the preview
  // and, at times, over the command palette — plus a Tab trap and inert siblings.
  const overlayRef = useOverlay({ open: true, onClose });

  /**
   * Enter submits from the dialog's inputs, but must not hijack an activation
   * the user aimed at a control. A keyboard user who Tabbed to Cancel and
   * pressed Enter used to get the directive written into props.conf: this
   * container handler saw the keydown first, suppressed the button's native
   * activation with preventDefault(), and applied instead.
   */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter' || applyDisabled) return;
    if (e.target instanceof HTMLElement && e.target.closest('button, a, textarea')) return;
    e.preventDefault();
    onApply();
  };

  return (
    <div
      ref={overlayRef}
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
        onKeyDown={onKeyDown}
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
