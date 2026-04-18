import { useAppStore } from '../../store/useAppStore';
import type { EventMetadata } from '../../engine/types';
import { Icon } from '../ui/Icon';

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
        title={collapsed ? 'Expand metadata' : 'Collapse metadata'}
      >
        <Icon
          name="chevron-down"
          className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
        <Icon name="tag" className="w-4 h-4 text-[var(--color-accent)]" />
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
                className="w-full px-1.5 py-1 text-xs font-mono rounded outline-none bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] border border-[var(--color-border)] focus:border-[var(--color-accent)]"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
