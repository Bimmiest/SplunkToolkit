import { useEffect, useCallback } from 'react';
import type React from 'react';
import { Command } from 'cmdk';
import { useAppStore } from '../../store/useAppStore';
import { SAMPLE_CONFIGS } from '../../engine/sampleData';
import { Icon } from './Icon';

type OutputTabId = 'preview' | 'cim' | 'fields' | 'transforms' | 'architecture';

const OUTPUT_TABS: { id: OutputTabId; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'cim', label: 'CIM Models' },
  { id: 'fields', label: 'Fields' },
  { id: 'transforms', label: 'Pipeline' },
  { id: 'architecture', label: 'Architecture' },
];

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const setActiveOutputTab = useAppStore((s) => s.setActiveOutputTab);
  const setRawData = useAppStore((s) => s.setRawData);
  const setPropsConf = useAppStore((s) => s.setPropsConf);
  const setTransformsConf = useAppStore((s) => s.setTransformsConf);
  const setMetadata = useAppStore((s) => s.setMetadata);
  const toggleHelp = useAppStore((s) => s.toggleHelp);

  const close = useCallback(() => {
    if (open) toggleCommandPalette();
  }, [open, toggleCommandPalette]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCommandPalette]);

  const run = useCallback(
    (fn: () => void) => {
      fn();
      close();
    },
    [close],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <Command
        label="Command palette"
        className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div
          className="flex items-center gap-2 px-3 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Icon name="search" className="w-4 h-4 shrink-0 text-[var(--color-text-muted)]" />
          <Command.Input
            placeholder="Type a command…"
            className="flex-1 h-11 bg-transparent text-sm outline-none placeholder:text-[var(--color-text-muted)]"
            style={{ color: 'var(--color-text-primary)' }}
            autoFocus
          />
          <kbd
            className="px-1.5 py-0.5 text-[10px] rounded font-mono"
            style={{
              backgroundColor: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)',
            }}
          >
            ESC
          </kbd>
        </div>

        <Command.List
          className="max-h-80 overflow-y-auto py-1"
        >
          <Command.Empty
            className="py-6 text-center text-sm"
            style={{ color: 'var(--color-text-muted)' }}
          >
            No results found.
          </Command.Empty>

          <CommandGroup heading="Examples">
            {SAMPLE_CONFIGS.map((sample) => (
              <CommandItem
                key={sample.name}
                label={`Load: ${sample.name}`}
                hint={sample.description}
                icon="terminal"
                onSelect={() =>
                  run(() => {
                    setRawData(sample.rawData);
                    setPropsConf(sample.propsConf);
                    setTransformsConf(sample.transformsConf);
                    setMetadata(sample.metadata);
                  })
                }
              />
            ))}
          </CommandGroup>

          <CommandGroup heading="Navigate">
            {OUTPUT_TABS.map((tab) => (
              <CommandItem
                key={tab.id}
                label={`Go to: ${tab.label}`}
                icon="arrow-right"
                onSelect={() => run(() => setActiveOutputTab(tab.id))}
              />
            ))}
          </CommandGroup>

          <CommandGroup heading="Actions">
            <CommandItem
              label="Toggle theme"
              icon="sun"
              onSelect={() => run(toggleTheme)}
            />
            <CommandItem
              label="Open pipeline reference"
              icon="info"
              onSelect={() => run(toggleHelp)}
            />
            <CommandItem
              label="Clear all editors"
              icon="x"
              onSelect={() =>
                run(() => {
                  setRawData('');
                  setPropsConf('');
                  setTransformsConf('');
                  setMetadata({ index: 'main', host: '', source: '', sourcetype: '' });
                })
              }
            />
          </CommandGroup>
        </Command.List>
      </Command>
    </div>
  );
}

function CommandGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&>[cmdk-group-heading]]:px-3 [&>[cmdk-group-heading]]:py-1.5 [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:font-semibold [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider"
      style={
        { '--heading-color': 'var(--color-text-muted)' } as React.CSSProperties
      }
    >
      {children}
    </Command.Group>
  );
}

function CommandItem({
  label,
  hint,
  icon,
  onSelect,
}: {
  label: string;
  hint?: string;
  icon: React.ComponentProps<typeof Icon>['name'];
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex items-center gap-3 px-3 py-2 mx-1 rounded-lg text-sm cursor-pointer outline-none
        aria-selected:bg-[var(--color-accent)] aria-selected:text-white"
      style={{ color: 'var(--color-text-primary)' }}
    >
      <Icon name={icon} className="w-4 h-4 shrink-0 text-[var(--color-text-muted)] aria-selected:text-white" />
      <span className="flex-1">{label}</span>
      {hint && (
        <span
          className="text-[11px] truncate max-w-[180px]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {hint}
        </span>
      )}
    </Command.Item>
  );
}
