import { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { useAppStore } from '../../store/useAppStore';
import { MetadataPanel } from '../metadata/MetadataPanel';
import { Icon } from '../ui/Icon';
import { ClearButton } from '../editor/ClearButton';

export function RawPanel() {
  const rawData = useAppStore((s) => s.rawData);
  const setRawData = useAppStore((s) => s.setRawData);
  const theme = useAppStore((s) => s.theme);

  const lineCount = useMemo(() => {
    if (!rawData) return 0;
    return rawData.split('\n').length;
  }, [rawData]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
        <Icon name="document" className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Raw Log</span>
      </div>

      <div className="relative flex-1 min-h-0">
        <Editor
          height="100%"
          language="plaintext"
          value={rawData}
          onChange={(val) => setRawData(val ?? '')}
          theme={theme === 'dark' ? 'splunk-dark' : 'splunk-light'}
          options={{
            minimap: { enabled: false },
            wordWrap: 'on',
            lineNumbers: 'on',
            fontSize: 14,
            fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
            scrollBeyondLastLine: false,
            contextmenu: false,
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            parameterHints: { enabled: false },
            codeLens: false,
            folding: false,
            renderWhitespace: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            padding: { top: 6 },
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
          }}
        />
        {!rawData && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none select-none"
            aria-hidden="true"
          >
            <Icon name="terminal" className="w-8 h-8 text-[var(--color-border)]" />
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--color-text-muted)]">Paste raw log data here</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-70">
                Or load an example from the Output panel →
              </p>
            </div>
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between px-3 py-1 text-xs shrink-0 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)]"
      >
        <span className="text-[var(--color-text-muted)]">
          {lineCount > 0 ? `${lineCount} line${lineCount !== 1 ? 's' : ''} · ` : ''}
          {rawData.length.toLocaleString()} chars
        </span>
        {rawData && <ClearButton onClear={() => setRawData('')} label="Clear" />}
      </div>

      <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <MetadataPanel />
      </div>
    </div>
  );
}
