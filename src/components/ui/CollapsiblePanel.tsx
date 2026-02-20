import type React from 'react';
import { useAppStore } from '../../store/useAppStore';

interface CollapsiblePanelProps {
  title: string;
  panelId: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform duration-200"
      style={{
        transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function CollapsiblePanel({
  title,
  panelId,
  children,
  actions,
}: CollapsiblePanelProps) {
  const collapsed = useAppStore((s) => s.collapsedPanels[panelId] ?? false);
  const togglePanelCollapse = useAppStore((s) => s.togglePanelCollapse);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 select-none shrink-0"
        style={{
          backgroundColor: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          onClick={() => togglePanelCollapse(panelId)}
          className="flex items-center gap-2 cursor-pointer bg-transparent border-none p-0 outline-none focus-visible:ring-2 rounded"
          style={{ color: 'var(--color-text-primary)' }}
          aria-expanded={!collapsed}
          aria-controls={`panel-content-${panelId}`}
        >
          <ChevronIcon collapsed={collapsed} />
          <span className="text-sm font-semibold">{title}</span>
        </button>
        {actions && (
          <div className="flex items-center gap-1">{actions}</div>
        )}
      </div>
      <div
        id={`panel-content-${panelId}`}
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{
          flex: collapsed ? '0 0 0px' : '1 1 auto',
          opacity: collapsed ? 0 : 1,
          overflow: collapsed ? 'hidden' : 'auto',
        }}
      >
        {!collapsed && (
          <div className="h-full">{children}</div>
        )}
      </div>
    </div>
  );
}
