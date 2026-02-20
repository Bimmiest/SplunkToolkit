import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { SplunkEditor } from './SplunkEditor';
import { CopyButton } from './CopyButton';
import { EditorValidationList } from './EditorValidationList';

export function TransformsConfEditor() {
  const transformsConf = useAppStore((s) => s.transformsConf);
  const setTransformsConf = useAppStore((s) => s.setTransformsConf);
  const collapsed = useAppStore((s) => !!s.collapsedPanels['transforms.conf']);
  const toggleCollapse = useAppStore((s) => s.togglePanelCollapse);

  const getText = useCallback(() => transformsConf, [transformsConf]);

  if (collapsed) {
    return (
      <div className="bg-[var(--color-bg-primary)] border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-bg-secondary)]">
          <button
            type="button"
            onClick={() => toggleCollapse('transforms.conf')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <svg
              className="w-3.5 h-3.5 text-[var(--color-text-muted)] -rotate-90"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="text-sm font-medium text-[var(--color-text-primary)]">transforms.conf</span>
          </button>
        </div>
        <EditorValidationList file="transforms.conf" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <button
          type="button"
          onClick={() => toggleCollapse('transforms.conf')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <svg
            className="w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="text-sm font-medium text-[var(--color-text-primary)]">transforms.conf</span>
        </button>
        <CopyButton getText={getText} />
      </div>
      <div className="flex-1 min-h-0">
        <SplunkEditor value={transformsConf} onChange={setTransformsConf} fileType="transforms.conf" />
      </div>
      <EditorValidationList file="transforms.conf" />
    </div>
  );
}
