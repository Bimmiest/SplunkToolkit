import { useCallback, useMemo, useState, useRef } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';
import { useAppStore } from '../../../store/useAppStore';
import type { SplunkEvent } from '../../../engine/types';
import type { EnrichedEvent } from '../PreviewPanel';
import { findFieldValuePositions } from '../../../utils/fieldHighlight';

const LAYOUT_STORAGE_KEY = 'calc-fields-split-layout';
const DEFAULT_LAYOUT: Layout = { 'calc-events': 85, 'calc-fields': 15 };

function getSavedLayout(): Layout {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch { /* ignore */ }
}

const FIELD_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#a855f7', '#84cc16',
];

interface CalculatedFieldsTabProps {
  items: EnrichedEvent[];
  allEvents: EnrichedEvent[];
  currentPage: number;
  eventsPerPage: number;
}

interface CalcField {
  name: string;
  expression: string;
  value: string | string[];
}

const EVAL_REGEX = /^\s*EVAL-(\S+)\s*=\s*(.+)$/gmi;

function useFieldFocus() {
  const [pinnedFields, setPinnedFields] = useState<Set<string>>(new Set());
  const [hoveredField, setHoveredField] = useState<string | null>(null);

  const togglePin = useCallback((field: string) => {
    setPinnedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  const hasPinned = pinnedFields.size > 0;
  const activeFields = hasPinned ? pinnedFields : (hoveredField ? new Set([hoveredField]) : null);

  return { pinnedFields, activeFields, togglePin, setHoveredField };
}

function isFieldActive(field: string, activeFields: Set<string> | null): boolean {
  return activeFields === null || activeFields.has(field);
}

function isAnyFocused(activeFields: Set<string> | null): boolean {
  return activeFields !== null;
}

export function CalculatedFieldsTab({ items, allEvents, currentPage, eventsPerPage }: CalculatedFieldsTabProps) {
  const propsConf = useAppStore((s) => s.propsConf);
  const { pinnedFields, activeFields, togglePin, setHoveredField } = useFieldFocus();
  const savedLayout = useRef(getSavedLayout());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const evalDirectives = useMemo(() => {
    const map = new Map<string, string>();
    let match: RegExpExecArray | null;
    const regex = new RegExp(EVAL_REGEX.source, EVAL_REGEX.flags);
    while ((match = regex.exec(propsConf)) !== null) {
      map.set(match[1], match[2].trim());
    }
    return map;
  }, [propsConf]);

  const fieldColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let colorIdx = 0;
    for (const { event } of allEvents) {
      for (const step of event.processingTrace) {
        if (step.processor === 'EVAL' && step.fieldsAdded) {
          for (const f of step.fieldsAdded) {
            if (!map.has(f)) {
              map.set(f, FIELD_COLORS[colorIdx % FIELD_COLORS.length]);
              colorIdx++;
            }
          }
        }
      }
    }
    return map;
  }, [allEvents]);

  const eventCards = useMemo(() => {
    return items.map((item, idx) => {
      const globalIdx = (currentPage - 1) * eventsPerPage + idx + 1;
      const evalTrace = item.event.processingTrace.find((t) => t.processor === 'EVAL');
      const computedFields = evalTrace?.fieldsAdded ?? [];

      const calcFields: CalcField[] = [];
      for (const [fieldName, expression] of evalDirectives) {
        const value = item.event.fields[fieldName];
        const wasComputed = computedFields.includes(fieldName);
        if (wasComputed || value !== undefined) {
          calcFields.push({ name: fieldName, expression, value: value ?? 'null' });
        }
      }

      return { event: item.event, globalIdx, calcFields };
    });
  }, [items, currentPage, eventsPerPage, evalDirectives]);

  if (evalDirectives.size === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)] text-sm">
        No EVAL-* directives configured in props.conf
      </div>
    );
  }

  const eventsPanel = (
    <div className="h-full overflow-auto p-3 space-y-3">
      {eventCards.map(({ event, globalIdx, calcFields }, idx) => (
        <CalcEventCard
          key={idx}
          event={event}
          globalIdx={globalIdx}
          calcFields={calcFields}
          fieldColorMap={fieldColorMap}
          activeFields={activeFields}
          pinnedFields={pinnedFields}
          onFieldHover={setHoveredField}
          onFieldClick={togglePin}
        />
      ))}
    </div>
  );

  return (
    <div className="flex h-full">
      {sidebarCollapsed ? (
        <div className="flex-1 min-w-0">{eventsPanel}</div>
      ) : (
        <Group orientation="horizontal" id="calc-fields-split" defaultLayout={savedLayout.current} onLayoutChanged={saveLayout}>
          <Panel defaultSize={85} minSize={40} id="calc-events">
            {eventsPanel}
          </Panel>
          <Separator className="w-1.5 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors group relative flex items-center justify-center">
            <div className="w-0.5 h-8 rounded-full bg-[var(--color-text-muted)] group-hover:bg-white transition-colors" />
          </Separator>
          <Panel defaultSize={15} minSize={10} id="calc-fields">
            <CalcFieldSidebar
              fieldColorMap={fieldColorMap}
              activeFields={activeFields}
              pinnedFields={pinnedFields}
              onFieldHover={setHoveredField}
              onFieldClick={togglePin}
              onCollapse={() => setSidebarCollapsed(true)}
            />
          </Panel>
        </Group>
      )}

      {sidebarCollapsed && (
        <button
          className="flex-shrink-0 w-6 h-full border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer flex items-center justify-center"
          onClick={() => setSidebarCollapsed(false)}
          title="Show field panel"
        >
          <svg
            className="w-3.5 h-3.5"
            style={{ color: 'var(--color-text-muted)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}

function CalcEventCard({
  event,
  globalIdx,
  calcFields,
  fieldColorMap,
  activeFields,
  pinnedFields,
  onFieldHover,
  onFieldClick,
}: {
  event: SplunkEvent;
  globalIdx: number;
  calcFields: CalcField[];
  fieldColorMap: Map<string, string>;
  activeFields: Set<string> | null;
  pinnedFields: Set<string>;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
}) {
  const focused = isAnyFocused(activeFields);

  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">
          Event #{globalIdx}
        </span>
        {calcFields.length > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
            {calcFields.length} calculated field{calcFields.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {calcFields.length === 0 ? (
        <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">
          No calculated fields for this event
        </div>
      ) : (
        <>
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all">
            <HighlightedRaw
              event={event}
              calcFields={calcFields}
              fieldColorMap={fieldColorMap}
              activeFields={activeFields}
              onFieldHover={onFieldHover}
              onFieldClick={onFieldClick}
            />
          </pre>
          {/* Field summary */}
          <div className="border-t border-[var(--color-border)] px-3 py-2">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {calcFields.map((cf) => {
                const color = fieldColorMap.get(cf.name) ?? 'var(--color-text-muted)';
                const display = Array.isArray(cf.value) ? cf.value.join(', ') : cf.value;
                const active = isFieldActive(cf.name, activeFields);
                const pinned = pinnedFields.has(cf.name);
                return (
                  <span
                    key={cf.name}
                    className="inline-flex items-center gap-1.5 text-xs font-mono cursor-pointer select-none"
                    style={{
                      opacity: focused && !active ? 0.2 : 1,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={() => onFieldHover(cf.name)}
                    onMouseLeave={() => onFieldHover(null)}
                    onClick={() => onFieldClick(cf.name)}
                  >
                    <span className="text-[var(--color-text-muted)]">{cf.name}=</span>
                    <span
                      className="px-1 py-0.5 rounded-sm max-w-48 truncate"
                      style={{
                        color,
                        backgroundColor: active && focused ? color + '20' : 'transparent',
                        outline: pinned ? `2px solid ${color}` : 'none',
                        outlineOffset: '1px',
                        transition: 'background-color 0.15s, color 0.15s',
                      }}
                      title={display}
                    >
                      {display}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
          {/* Expressions */}
          <details className="border-t border-[var(--color-border)]">
            <summary className="px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] cursor-pointer select-none hover:text-[var(--color-text-secondary)] transition-colors">
              Eval Expressions
            </summary>
            <div className="px-3 py-2 border-t border-[var(--color-border)]">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {calcFields.map((cf) => {
                  const color = fieldColorMap.get(cf.name) ?? 'var(--color-text-muted)';
                  const active = isFieldActive(cf.name, activeFields);
                  const pinned = pinnedFields.has(cf.name);
                  return (
                    <span
                      key={cf.name}
                      className="inline-flex items-center gap-1.5 text-xs font-mono cursor-pointer select-none"
                      style={{
                        opacity: focused && !active ? 0.2 : 1,
                        transition: 'opacity 0.15s',
                      }}
                      onMouseEnter={() => onFieldHover(cf.name)}
                      onMouseLeave={() => onFieldHover(null)}
                      onClick={() => onFieldClick(cf.name)}
                    >
                      <span style={{ color }} className="font-medium">{cf.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">expr</span>
                      <code
                        className="text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded"
                        style={{
                          outline: pinned ? `2px solid ${color}` : 'none',
                          outlineOffset: '1px',
                        }}
                      >
                        {cf.expression}
                      </code>
                    </span>
                  );
                })}
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function HighlightedRaw({
  event,
  calcFields,
  fieldColorMap,
  activeFields,
  onFieldHover,
  onFieldClick,
}: {
  event: SplunkEvent;
  calcFields: CalcField[];
  fieldColorMap: Map<string, string>;
  activeFields: Set<string> | null;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
}) {
  const raw = event._raw;
  const focused = isAnyFocused(activeFields);

  const highlights: { start: number; end: number; field: string; color: string }[] = [];

  for (const cf of calcFields) {
    const color = fieldColorMap.get(cf.name);
    if (!color) continue;

    const values = Array.isArray(cf.value) ? cf.value : [cf.value];
    for (const v of values) {
      if (!v || v.length < 2) continue;
      const positions = findFieldValuePositions(raw, cf.name, v);
      for (const idx of positions) {
        highlights.push({ start: idx, end: idx + v.length, field: cf.name, color });
      }
    }
  }

  if (highlights.length === 0) {
    return <span style={{ opacity: focused ? 0.3 : 1, transition: 'opacity 0.15s' }}>{raw}</span>;
  }

  highlights.sort((a, b) => a.start - b.start || b.end - a.end);

  const segments: React.ReactNode[] = [];
  let lastEnd = 0;

  for (const hl of highlights) {
    if (hl.start < lastEnd) continue;

    if (hl.start > lastEnd) {
      segments.push(
        <span
          key={`text-${lastEnd}`}
          style={{ opacity: focused ? 0.3 : 1, transition: 'opacity 0.15s' }}
        >
          {raw.substring(lastEnd, hl.start)}
        </span>
      );
    }

    const active = isFieldActive(hl.field, activeFields);

    segments.push(
      <span
        key={`${hl.start}-${hl.field}`}
        style={{
          color: hl.color,
          backgroundColor: active && focused ? hl.color + '20' : 'transparent',
          opacity: focused && !active ? 0.2 : 1,
          transition: 'opacity 0.15s, background-color 0.15s, color 0.15s',
          cursor: 'pointer',
        }}
        title={`${hl.field} (calculated): ${raw.substring(hl.start, hl.end)}`}
        className="rounded-sm px-0.5"
        onMouseEnter={() => onFieldHover(hl.field)}
        onMouseLeave={() => onFieldHover(null)}
        onClick={() => onFieldClick(hl.field)}
      >
        {raw.substring(hl.start, hl.end)}
      </span>
    );

    lastEnd = hl.end;
  }

  if (lastEnd < raw.length) {
    segments.push(
      <span
        key={`text-${lastEnd}`}
        style={{ opacity: focused ? 0.3 : 1, transition: 'opacity 0.15s' }}
      >
        {raw.substring(lastEnd)}
      </span>
    );
  }

  return <>{segments}</>;
}

// ─── Field Sidebar ───────────────────────────────────────────────────────────

function CalcFieldSidebar({
  fieldColorMap, activeFields, pinnedFields, onFieldHover, onFieldClick, onCollapse,
}: {
  fieldColorMap: Map<string, string>;
  activeFields: Set<string> | null;
  pinnedFields: Set<string>;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
  onCollapse: () => void;
}) {
  const [search, setSearch] = useState('');
  const focused = isAnyFocused(activeFields);
  const lowerSearch = search.toLowerCase();

  const fields = useMemo(() => {
    const sorted = Array.from(fieldColorMap.keys()).sort();
    if (!lowerSearch) return sorted;
    return sorted.filter((f) => f.toLowerCase().includes(lowerSearch));
  }, [fieldColorMap, lowerSearch]);

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-secondary)]">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">Fields</span>
        <button
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-[var(--color-bg-tertiary)] cursor-pointer bg-transparent border-none p-0 transition-colors"
          onClick={onCollapse}
          title="Collapse field panel"
        >
          <svg
            className="w-3.5 h-3.5"
            style={{ color: 'var(--color-text-muted)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-2 py-2 border-b border-[var(--color-border)]">
        <div className="relative mb-1.5">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
            style={{ color: 'var(--color-text-muted)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filter fields..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-6 pr-2 py-1 text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {fields.length}/{fieldColorMap.size} fields
        </span>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-auto px-1 py-1">
        {fields.map((name) => {
          const color = fieldColorMap.get(name)!;
          const active = isFieldActive(name, activeFields);
          const pinned = pinnedFields.has(name);
          return (
            <div
              key={name}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer select-none group"
              style={{
                backgroundColor: pinned ? color + '20' : (active && focused ? color + '15' : 'transparent'),
                borderLeft: active && focused ? `2px solid ${color}` : '2px solid transparent',
                transition: 'background-color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={() => onFieldHover(name)}
              onMouseLeave={() => onFieldHover(null)}
              onClick={() => onFieldClick(name)}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{
                  backgroundColor: color + '40',
                  borderLeft: `2px solid ${color}`,
                  outline: pinned ? `1.5px solid ${color}` : 'none',
                  outlineOffset: '1px',
                }}
              />
              <span
                className="text-xs truncate"
                style={{ color: 'var(--color-text-primary)' }}
                title={name}
              >
                {name}
              </span>
              {pinned && (
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0 ml-auto"
                  style={{ backgroundColor: color }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
