import { useAppStore } from '../../store/useAppStore';
import type { EventMetadata } from '../../engine/types';

const metadataFields: { key: keyof EventMetadata; label: string }[] = [
  { key: 'index', label: 'index' },
  { key: 'host', label: 'host' },
  { key: 'source', label: 'source' },
  { key: 'sourcetype', label: 'sourcetype' },
];

export function MetadataPanel() {
  const metadata = useAppStore((s) => s.metadata);
  const setMetadataField = useAppStore((s) => s.setMetadataField);
  const collapsed = useAppStore((s) => !!s.collapsedPanels['metadata']);
  const toggleCollapse = useAppStore((s) => s.togglePanelCollapse);

  return (
    <div>
      <button
        type="button"
        onClick={() => toggleCollapse('metadata')}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:opacity-80 transition-opacity"
      >
        <svg
          className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${collapsed ? '-rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        <svg className="w-4 h-4 text-[var(--color-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
        </svg>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">Metadata</span>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-4 gap-2 px-2 pb-1.5">
          {metadataFields.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-0.5">
              <label
                htmlFor={`metadata-${key}`}
                className="text-[10px] font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {label}
              </label>
              <input
                id={`metadata-${key}`}
                type="text"
                value={metadata[key]}
                onChange={(e) => setMetadataField(key, e.target.value)}
                placeholder={key === 'index' ? 'main' : key}
                spellCheck={false}
                className="w-full px-1.5 py-1 text-xs font-mono rounded outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-bg-primary)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-accent)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
