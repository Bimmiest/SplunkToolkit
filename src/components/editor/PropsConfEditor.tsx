import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { SplunkEditor } from './SplunkEditor';
import { CopyButton } from './CopyButton';
import { EditorValidationList } from './EditorValidationList';

export function PropsConfEditor() {
  const propsConf = useAppStore((s) => s.propsConf);
  const setPropsConf = useAppStore((s) => s.setPropsConf);
  const collapsed = useAppStore((s) => !!s.collapsedPanels['props.conf']);
  const toggleCollapse = useAppStore((s) => s.togglePanelCollapse);

  const getText = useCallback(() => propsConf, [propsConf]);

  if (collapsed) {
    return (
      <div className="bg-[var(--color-bg-primary)] border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-bg-secondary)]">
          <button
            type="button"
            onClick={() => toggleCollapse('props.conf')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <svg
              className="w-3.5 h-3.5 text-[var(--color-text-muted)] -rotate-90"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-medium text-[var(--color-text-primary)]">props.conf</span>
          </button>
        </div>
        <EditorValidationList file="props.conf" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <button
          type="button"
          onClick={() => toggleCollapse('props.conf')}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <svg
            className="w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm font-medium text-[var(--color-text-primary)]">props.conf</span>
        </button>
        <CopyButton getText={getText} />
      </div>
      <div className="flex-1 min-h-0">
        <SplunkEditor value={propsConf} onChange={setPropsConf} fileType="props.conf" />
      </div>
      <EditorValidationList file="props.conf" />
    </div>
  );
}
