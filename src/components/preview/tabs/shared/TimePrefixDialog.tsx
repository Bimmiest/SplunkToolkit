import { useEffect, useRef, useState } from 'react';
import { timePrefixFromSelection } from '../../../../engine/scaffold/fromSelection';
import { DirectiveDialog } from './DirectiveDialog';

/**
 * In-app dialog for "Set as TIME_PREFIX from selection" (replaces a window.alert
 * dead-end). Pre-fills the editable field with the stable literal that precedes the
 * selected timestamp when one can be derived, and always shows the preceding text so
 * the user can craft/adjust the prefix even when auto-derivation finds no boundary.
 */
export function TimePrefixDialog({
  raw,
  selection,
  stanza,
  onApply,
  onClose,
}: {
  raw: string;
  selection: string;
  stanza: string;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  // Best-effort default from the shared, tested helper (may be null at the start of
  // the event or when no stable boundary precedes the selection).
  const [value, setValue] = useState(() => timePrefixFromSelection(raw, selection) ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const idx = raw.indexOf(selection);
  const before = idx > 0 ? raw.slice(0, idx) : '';
  const contextHint = before.slice(-32);

  const trimmed = value.trim();

  return (
    <DirectiveDialog
      title="Set TIME_PREFIX from selection"
      applyLabel="Set TIME_PREFIX"
      applyDisabled={trimmed.length === 0}
      onApply={() => { if (trimmed) { onApply(trimmed); onClose(); } }}
      onClose={onClose}
    >
      <div>
        <label htmlFor="time-prefix-value" className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
          TIME_PREFIX <span className="font-normal normal-case">(regex matching the text before the timestamp)</span>
        </label>
        <input
          id="time-prefix-value"
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          placeholder="e.g. \["
          className="mt-1 w-full px-2.5 py-1.5 rounded-md text-sm font-mono outline-none bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border)] focus:border-[var(--color-accent)]"
        />
      </div>

      {contextHint && (
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          Text before the selection:{' '}
          <code className="font-mono px-1 rounded" style={{ backgroundColor: 'var(--color-bg-tertiary)' }}>
            …{contextHint}
          </code>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-secondary)' }}>
          Adds to <code className="font-mono">[{stanza}]</code>
        </div>
        <pre
          className="text-xs font-mono rounded border p-2 overflow-x-auto whitespace-pre-wrap break-all"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-secondary)' }}
        >
          {trimmed ? `TIME_PREFIX = ${trimmed}` : 'Enter the text that precedes the timestamp…'}
        </pre>
      </div>
    </DirectiveDialog>
  );
}
