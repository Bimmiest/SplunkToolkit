import { useState } from 'react';
import { RawPanel } from '../raw/RawPanel';
import { PropsConfEditor } from '../editor/PropsConfEditor';
import { TransformsConfEditor } from '../editor/TransformsConfEditor';
import { PreviewPanel } from '../preview/PreviewPanel';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';

type MobileView = 'raw' | 'props' | 'transforms' | 'output';

const VIEWS: { id: MobileView; label: string; icon: IconName }[] = [
  { id: 'raw', label: 'Raw', icon: 'document' },
  { id: 'props', label: 'props', icon: 'settings' },
  { id: 'transforms', label: 'transforms', icon: 'refresh' },
  { id: 'output', label: 'Output', icon: 'eye' },
];

/**
 * Single-panel-at-a-time layout for narrow viewports. The desktop resizable
 * split collapses every column to an unusable width on a phone, so on mobile we
 * show one full-width panel and switch between them with a segmented control.
 */
export function MobileShell() {
  const [view, setView] = useState<MobileView>('raw');

  return (
    <div className="h-full flex flex-col">
      <div
        role="tablist"
        aria-label="Workspace panels"
        className="shrink-0 flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-x-auto"
      >
        {VIEWS.map((v) => {
          const isActive = v.id === view;
          return (
            <button
              key={v.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setView(v.id)}
              className={[
                'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-2 py-1.5',
                'text-[11px] font-medium cursor-pointer border-b-2 -mb-px outline-none focus-visible:ring-2 transition-colors',
                isActive
                  ? 'text-[var(--color-accent)] border-b-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] border-b-transparent hover:text-[var(--color-text-secondary)]',
              ].join(' ')}
            >
              <Icon name={v.icon} className="w-4 h-4 shrink-0" />
              <span className="truncate max-w-full">{v.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0">
        {view === 'raw' && (
          <ErrorBoundary panelName="Raw Data">
            <RawPanel />
          </ErrorBoundary>
        )}
        {view === 'props' && (
          <ErrorBoundary panelName="props.conf Editor">
            <PropsConfEditor />
          </ErrorBoundary>
        )}
        {view === 'transforms' && (
          <ErrorBoundary panelName="transforms.conf Editor">
            <TransformsConfEditor />
          </ErrorBoundary>
        )}
        {view === 'output' && (
          <ErrorBoundary panelName="Output">
            <PreviewPanel />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}
