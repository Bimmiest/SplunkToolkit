import { useState, type ReactNode } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';

const DEFAULT_LAYOUT: Layout = { events: 85, sidebar: 15 };

function getSavedLayout(storageKey: string): Layout {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

interface FieldSplitLayoutProps {
  storageKey: string;
  collapsed: boolean;
  sidebar: ReactNode;
  children: ReactNode;
}

export function FieldSplitLayout({ storageKey, collapsed, sidebar, children }: FieldSplitLayoutProps) {
  const [initialLayout] = useState(() => getSavedLayout(storageKey));

  const saveLayout = (layout: Layout) => {
    try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { /* ignore */ }
  };

  if (collapsed) {
    return (
      <div className="flex-1 min-w-0 h-full overflow-auto p-3 space-y-3">
        {children}
      </div>
    );
  }

  return (
    <Group orientation="horizontal" id={storageKey} defaultLayout={initialLayout} onLayoutChanged={saveLayout}>
      <Panel defaultSize={85} minSize={40} id={`${storageKey}-events`}>
        <div className="h-full overflow-auto p-3 space-y-3">
          {children}
        </div>
      </Panel>
      <Separator className="w-1.5 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors group relative flex items-center justify-center">
        <div className="w-0.5 h-8 rounded-full bg-[var(--color-text-muted)] group-hover:bg-white transition-colors" />
      </Separator>
      <Panel defaultSize={15} minSize={10} id={`${storageKey}-sidebar`}>
        {sidebar}
      </Panel>
    </Group>
  );
}
