import { useAppStore } from '../../store/useAppStore';
import { MetadataPanel } from '../metadata/MetadataPanel';

export function RawPanel() {
  const rawData = useAppStore((s) => s.rawData);
  const setRawData = useAppStore((s) => s.setRawData);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">Raw Log</span>
      </div>
      <textarea
        value={rawData}
        onChange={(e) => setRawData(e.target.value)}
        placeholder="Paste raw log data here..."
        aria-label="Raw log data input"
        spellCheck={false}
        className="flex-1 w-full resize-none p-3 text-sm font-mono leading-relaxed outline-none border-none"
        style={{
          backgroundColor: 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)',
        }}
      />
      <div
        className="flex items-center justify-end px-3 py-1 text-xs shrink-0"
        style={{
          backgroundColor: 'var(--color-bg-secondary)',
          borderTop: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
        }}
      >
        <span>{rawData.length.toLocaleString()} characters</span>
      </div>
      <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <MetadataPanel />
      </div>
    </div>
  );
}
