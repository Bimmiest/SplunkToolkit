import type React from 'react';
import { useCallback, useRef } from 'react';

interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
  badgeVariant?: 'error' | 'warning' | 'info' | 'default';
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  ariaLabel?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, ariaLabel }: TabsProps) {
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      let nextIndex = -1;

      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      }

      if (nextIndex >= 0) {
        e.preventDefault();
        onTabChange(tabs[nextIndex].id);
        const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons?.[nextIndex]?.focus();
      }
    },
    [tabs, activeTab, onTabChange]
  );

  return (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-1"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer outline-none focus-visible:ring-2"
            style={{
              color: isActive
                ? 'var(--color-accent)'
                : 'var(--color-text-muted)',
              borderBottom: isActive
                ? '2px solid var(--color-accent)'
                : '2px solid transparent',
              marginBottom: '-1px',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--color-text-muted)';
              }
            }}
          >
            {tab.icon && <span className="flex-shrink-0">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge !== 0 && (
              <span
                className="ml-1 text-[10px] font-semibold rounded-full px-1.5 py-0 leading-4"
                style={{
                  backgroundColor: tab.badgeVariant === 'error' ? 'var(--color-error)' : tab.badgeVariant === 'warning' ? 'var(--color-warning)' : 'var(--color-accent)',
                  color: '#fff',
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
