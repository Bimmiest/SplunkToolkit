import { useAppStore } from '../../store/useAppStore';
import { MetadataPanel } from '../metadata/MetadataPanel';
import { Icon } from '../ui/Icon';
import { ClearButton } from '../editor/ClearButton';

export function RawPanel() {
  const rawData = useAppStore((s) => s.rawData);
  const setRawData = useAppStore((s) => s.setRawData);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <Icon name="document" className="w-4 h-4 text-[var(--color-accent)]" />
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
        className="flex items-center justify-between px-3 py-1 text-xs shrink-0 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)]"
      >
        <span className="text-[var(--color-text-muted)]">{rawData.length.toLocaleString()} chars</span>
        {rawData && <ClearButton onClear={() => setRawData('')} label="Clear" />}
      </div>
      <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <MetadataPanel />
      </div>
    </div>
  );
}
