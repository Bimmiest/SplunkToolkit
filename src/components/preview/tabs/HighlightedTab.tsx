import { useCallback, useMemo, useState, useRef } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';

const LAYOUT_STORAGE_KEY = 'highlighted-split-layout';
const DEFAULT_LAYOUT: Layout = { 'highlighted-events': 85, 'highlighted-fields': 15 };

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
import type { SplunkEvent } from '../../../engine/types';
import type { EnrichedEvent } from '../PreviewPanel';
import { findFieldValuePositions } from '../../../utils/fieldHighlight';

const FIELD_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#a855f7', '#84cc16',
];

type FieldFilter = 'auto' | 'manual' | 'both';

const AUTO_PROCESSORS = ['KV_MODE', 'INDEXED_EXTRACTIONS'];
const MANUAL_PROCESSORS = ['EXTRACT', 'REPORT', 'TRANSFORMS', 'SEDCMD'];

function isAutoProcessor(processor: string): boolean {
  return AUTO_PROCESSORS.some((p) => processor.startsWith(p));
}

function isManualProcessor(processor: string): boolean {
  return MANUAL_PROCESSORS.some((p) => processor.startsWith(p));
}

interface HighlightedTabProps {
  items: EnrichedEvent[];
  allEvents: EnrichedEvent[];
  currentPage: number;
  eventsPerPage: number;
}

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

/** Returns true if a field value looks like stringified JSON (parent container). */
function isJsonContainer(value: string | string[]): boolean {
  if (Array.isArray(value)) return false;
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { JSON.parse(trimmed); return true; } catch { return false; }
  }
  return false;
}

export function HighlightedTab({ items, allEvents, currentPage, eventsPerPage }: HighlightedTabProps) {
  const [fieldFilter, setFieldFilter] = useState<FieldFilter>('both');
  const { pinnedFields, activeFields, togglePin, setHoveredField } = useFieldFocus();
  const savedLayout = useRef(getSavedLayout());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { autoFields, manualFields, fieldProcessorMap } = useMemo(() => {
    const auto = new Set<string>();
    const manual = new Set<string>();
    const processorMap = new Map<string, string>();
    for (const { event } of allEvents) {
      for (const step of event.processingTrace) {
        if (!step.fieldsAdded) continue;
        if (isAutoProcessor(step.processor)) {
          for (const f of step.fieldsAdded) {
            auto.add(f);
            if (!processorMap.has(f)) processorMap.set(f, step.processor);
          }
        } else if (isManualProcessor(step.processor)) {
          for (const f of step.fieldsAdded) {
            manual.add(f);
            // Manual processor overwrites auto for display purposes
            processorMap.set(f, step.processor);
          }
        }
      }
    }
    return { autoFields: auto, manualFields: manual, fieldProcessorMap: processorMap };
  }, [allEvents]);

  // Identify parent container fields (stringified JSON values) to exclude from highlighting
  const containerFields = useMemo(() => {
    const containers = new Set<string>();
    for (const { event } of allEvents) {
      for (const [key, value] of Object.entries(event.fields)) {
        if (isJsonContainer(value)) containers.add(key);
      }
    }
    return containers;
  }, [allEvents]);

  const fieldColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let colorIdx = 0;
    for (const { event } of allEvents) {
      for (const key of Object.keys(event.fields)) {
        const isAuto = autoFields.has(key);
        const isManual = manualFields.has(key);
        if (!isAuto && !isManual) continue;
        // When a field is in both sets, classify it as manual (explicit user intent)
        const effectiveCategory = isManual ? 'manual' : 'auto';
        if (fieldFilter === 'auto' && effectiveCategory !== 'auto') continue;
        if (fieldFilter === 'manual' && effectiveCategory !== 'manual') continue;
        if (!map.has(key)) {
          map.set(key, FIELD_COLORS[colorIdx % FIELD_COLORS.length]);
          colorIdx++;
        }
      }
    }
    return map;
  }, [allEvents, autoFields, manualFields, fieldFilter]);

  // Build highlight-only color map (exclude container/parent fields)
  const highlightColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [key, color] of fieldColorMap) {
      if (!containerFields.has(key)) {
        map.set(key, color);
      }
    }
    return map;
  }, [fieldColorMap, containerFields]);

  // When fields are pinned, filter from ALL events (not just current page) so matches surface immediately
  const filteredItems = useMemo(() => {
    if (pinnedFields.size === 0) return items;
    return allEvents.filter(({ event }) => {
      for (const pinned of pinnedFields) {
        if (pinned in event.fields) return true;
      }
      return false;
    });
  }, [items, allEvents, pinnedFields]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter toggle */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Show:</span>
          <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
            {([
              { id: 'auto', label: 'Auto Extracted', count: autoFields.size },
              { id: 'manual', label: 'Manually Extracted', count: manualFields.size },
              { id: 'both', label: 'Both', count: autoFields.size + manualFields.size },
            ] as const).map(({ id, label, count }) => (
              <button
                key={id}
                onClick={() => setFieldFilter(id)}
                className="px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: fieldFilter === id ? 'var(--color-accent)' : 'transparent',
                  color: fieldFilter === id ? '#fff' : 'var(--color-text-muted)',
                }}
              >
                {label}
                {count > 0 && (
                  <span className="ml-1 opacity-70">({count})</span>
                )}
              </button>
            ))}
          </div>
          {pinnedFields.size > 0 && (
            <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
              {filteredItems.length}/{items.length} events match {pinnedFields.size} pinned field{pinnedFields.size > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Main content: events + field sidebar */}
      <div className="flex-1 min-h-0 flex">
        {sidebarCollapsed ? (
          /* Full-width events when sidebar collapsed */
          <div className="flex-1 min-w-0 h-full overflow-auto p-3 space-y-3">
            {filteredItems.map((item, idx) => {
              const globalIdx = (currentPage - 1) * eventsPerPage + idx + 1;
              return (
                <EventCard
                  key={idx}
                  event={item.event}
                  globalIdx={globalIdx}
                  fieldColorMap={highlightColorMap}
                  autoFields={autoFields}
                  activeFields={activeFields}
                  fieldFilter={fieldFilter}
                  onFieldHover={setHoveredField}
                  onFieldClick={togglePin}
                />
              );
            })}
          </div>
        ) : (
          /* Resizable split layout */
          <Group orientation="horizontal" id="highlighted-split" defaultLayout={savedLayout.current} onLayoutChanged={saveLayout}>
            <Panel defaultSize={85} minSize={40} id="highlighted-events">
              <div className="h-full overflow-auto p-3 space-y-3">
                {filteredItems.map((item, idx) => {
                  const globalIdx = (currentPage - 1) * eventsPerPage + idx + 1;
                  return (
                    <EventCard
                      key={idx}
                      event={item.event}
                      globalIdx={globalIdx}
                      fieldColorMap={highlightColorMap}
                      autoFields={autoFields}
                      activeFields={activeFields}
                      fieldFilter={fieldFilter}
                      onFieldHover={setHoveredField}
                      onFieldClick={togglePin}
                    />
                  );
                })}
              </div>
            </Panel>

            <Separator
              className="w-1.5 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors group relative flex items-center justify-center"
            >
              <div className="w-0.5 h-8 rounded-full bg-[var(--color-text-muted)] group-hover:bg-white transition-colors" />
            </Separator>

            <Panel defaultSize={15} minSize={10} id="highlighted-fields">
              <FieldSidebar
                fieldColorMap={fieldColorMap}
                containerFields={containerFields}
                fieldProcessorMap={fieldProcessorMap}
                activeFields={activeFields}
                pinnedFields={pinnedFields}
                onFieldHover={setHoveredField}
                onFieldClick={togglePin}
                onCollapse={() => setSidebarCollapsed(true)}
              />
            </Panel>
          </Group>
        )}

        {/* Collapsed sidebar toggle */}
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
    </div>
  );
}

// ─── Field Sidebar ───────────────────────────────────────────────────────────

interface FieldSidebarProps {
  fieldColorMap: Map<string, string>;
  containerFields: Set<string>;
  fieldProcessorMap: Map<string, string>;
  activeFields: Set<string> | null;
  pinnedFields: Set<string>;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
  onCollapse: () => void;
}

interface FieldNode {
  name: string;
  leafName: string;
  color: string;
  processor: string | null;
  isContainer: boolean;
  depth: number;
  children: FieldNode[];
}

function buildFieldTree(
  fieldColorMap: Map<string, string>,
  containerFields: Set<string>,
  fieldProcessorMap: Map<string, string>,
): FieldNode[] {
  const roots: FieldNode[] = [];
  const nodeMap = new Map<string, FieldNode>();

  const sorted = Array.from(fieldColorMap.keys()).sort();

  for (const name of sorted) {
    const color = fieldColorMap.get(name)!;
    const parts = name.split('.');
    const node: FieldNode = {
      name,
      leafName: parts[parts.length - 1],
      color,
      processor: fieldProcessorMap.get(name) ?? null,
      isContainer: containerFields.has(name),
      depth: parts.length - 1,
      children: [],
    };
    nodeMap.set(name, node);

    let placed = false;
    for (let i = parts.length - 1; i > 0; i--) {
      const parentKey = parts.slice(0, i).join('.');
      const parent = nodeMap.get(parentKey);
      if (parent) {
        parent.children.push(node);
        placed = true;
        break;
      }
    }
    if (!placed) {
      roots.push(node);
    }
  }

  return roots;
}

function FieldSidebar({
  fieldColorMap, containerFields, fieldProcessorMap, activeFields, pinnedFields, onFieldHover, onFieldClick, onCollapse,
}: FieldSidebarProps) {
  const [search, setSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string> | null>(null);

  const tree = useMemo(
    () => buildFieldTree(fieldColorMap, containerFields, fieldProcessorMap),
    [fieldColorMap, containerFields, fieldProcessorMap]
  );

  const allGroupNames = useMemo(() => {
    const groups: string[] = [];
    function walk(nodes: FieldNode[]) {
      for (const n of nodes) {
        if (n.children.length > 0) {
          groups.push(n.name);
          walk(n.children);
        }
      }
    }
    walk(tree);
    return groups;
  }, [tree]);

  const effectiveCollapsed = collapsedGroups ?? new Set(allGroupNames);

  const toggleGroup = useCallback((name: string) => {
    setCollapsedGroups((prev) => {
      const base = prev ?? new Set(allGroupNames);
      const next = new Set(base);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, [allGroupNames]);

  const focused = isAnyFocused(activeFields);
  const lowerSearch = search.toLowerCase();

  const filteredCount = useMemo(() => {
    let count = 0;
    function walk(nodes: FieldNode[]) {
      for (const n of nodes) {
        if (nodeMatchesSearch(n, lowerSearch)) count++;
        walk(n.children);
      }
    }
    walk(tree);
    return count;
  }, [tree, lowerSearch]);

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-secondary)]">
      {/* Header with collapse */}
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
      {/* Search + controls */}
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
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {filteredCount}/{fieldColorMap.size} fields
          </span>
          {allGroupNames.length > 0 && (
            <button
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer bg-transparent border-none p-0"
              onClick={() => {
                const allCollapsed = allGroupNames.every((g) => effectiveCollapsed.has(g));
                setCollapsedGroups(allCollapsed ? new Set() : new Set(allGroupNames));
              }}
            >
              {allGroupNames.every((g) => effectiveCollapsed.has(g)) ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-auto px-1 py-1">
        {tree.map((node) => (
          <FieldTreeNode
            key={node.name}
            node={node}
            collapsed={effectiveCollapsed}
            toggleGroup={toggleGroup}
            activeFields={activeFields}
            pinnedFields={pinnedFields}
            focused={focused}
            onHover={onFieldHover}
            onClick={onFieldClick}
            search={lowerSearch}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Field Tree Node ─────────────────────────────────────────────────────────

function FieldTreeNode({
  node, collapsed, toggleGroup, activeFields, pinnedFields, focused, onHover, onClick, search,
}: {
  node: FieldNode;
  collapsed: Set<string>;
  toggleGroup: (name: string) => void;
  activeFields: Set<string> | null;
  pinnedFields: Set<string>;
  focused: boolean;
  onHover: (field: string | null) => void;
  onClick: (field: string) => void;
  search: string;
}) {
  const matchesSelf = !search || node.name.toLowerCase().includes(search);
  const childMatchesSearch = node.children.some((c) => nodeMatchesSearch(c, search));
  if (!matchesSelf && !childMatchesSearch) return null;

  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.name);
  const active = isFieldActive(node.name, activeFields);
  const pinned = pinnedFields.has(node.name);

  return (
    <div style={{ paddingLeft: `${node.depth * 10}px` }}>
      <div
        className="flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer select-none group"
        style={{
          backgroundColor: pinned ? node.color + '20' : (active && focused ? node.color + '15' : 'transparent'),
          borderLeft: active && focused ? `2px solid ${node.color}` : '2px solid transparent',
          transition: 'background-color 0.15s, border-color 0.15s',
        }}
        onMouseEnter={() => onHover(node.name)}
        onMouseLeave={() => onHover(null)}
        onClick={() => {
          if (hasChildren) {
            toggleGroup(node.name);
          } else {
            onClick(node.name);
          }
        }}
      >
        {hasChildren ? (
          <svg
            className="w-3 h-3 flex-shrink-0 transition-transform"
            style={{
              color: 'var(--color-text-muted)',
              transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <span
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{
              backgroundColor: node.color + '40',
              borderLeft: `2px solid ${node.color}`,
              outline: pinned ? `1.5px solid ${node.color}` : 'none',
              outlineOffset: '1px',
            }}
          />
        )}

        <span
          className="text-xs truncate"
          style={{ color: hasChildren ? 'var(--color-text-secondary)' : 'var(--color-text-primary)' }}
          title={node.name}
        >
          {node.depth > 0 ? `.${node.leafName}` : node.name}
        </span>

        {hasChildren && (
          <span className="text-[9px] text-[var(--color-text-muted)] flex-shrink-0">
            ({node.children.length})
          </span>
        )}
        {node.processor && !hasChildren && (
          <span className="text-[9px] text-[var(--color-text-muted)] italic flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.processor.replace(/-.*$/, '')}
          </span>
        )}

        {pinned && (
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0 ml-auto"
            style={{ backgroundColor: node.color }}
          />
        )}
      </div>

      {hasChildren && !isCollapsed && node.children.map((child) => (
        <FieldTreeNode
          key={child.name}
          node={child}
          collapsed={collapsed}
          toggleGroup={toggleGroup}
          activeFields={activeFields}
          pinnedFields={pinnedFields}
          focused={focused}
          onHover={onHover}
          onClick={onClick}
          search={search}
        />
      ))}
    </div>
  );
}

function nodeMatchesSearch(node: FieldNode, search: string): boolean {
  if (!search) return true;
  if (node.name.toLowerCase().includes(search)) return true;
  return node.children.some((c) => nodeMatchesSearch(c, search));
}

// ─── Event Card + Highlighted Raw ────────────────────────────────────────────

function EventCard({
  event, globalIdx, fieldColorMap, autoFields, activeFields, fieldFilter, onFieldHover, onFieldClick,
}: {
  event: SplunkEvent;
  globalIdx: number;
  fieldColorMap: Map<string, string>;
  autoFields: Set<string>;
  activeFields: Set<string> | null;
  fieldFilter: FieldFilter;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
}) {
  const eventFields = Object.keys(event.fields).filter((f) => fieldColorMap.has(f));

  // When a specific filter is active, all visible fields belong to that category
  // (fieldColorMap already only contains fields matching the filter).
  // When 'both', classify per-event by checking the processing trace.
  let autoCount = 0;
  let manualCount = 0;
  if (fieldFilter === 'auto') {
    autoCount = eventFields.length;
  } else if (fieldFilter === 'manual') {
    manualCount = eventFields.length;
  } else {
    manualCount = eventFields.filter((f) =>
      event.processingTrace.some(
        (step) => step.fieldsAdded?.includes(f) && isManualProcessor(step.processor),
      ),
    ).length;
    autoCount = eventFields.length - manualCount;
  }

  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Event #{globalIdx}</span>
        {autoCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
            {autoCount} auto
          </span>
        )}
        {manualCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
            {manualCount} manual
          </span>
        )}
      </div>
      <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all">
        <HighlightedRaw
          event={event}
          fieldColorMap={fieldColorMap}
          autoFields={autoFields}
          activeFields={activeFields}
          onFieldHover={onFieldHover}
          onFieldClick={onFieldClick}
        />
      </pre>
    </div>
  );
}

function HighlightedRaw({
  event, fieldColorMap, autoFields, activeFields, onFieldHover, onFieldClick,
}: {
  event: SplunkEvent;
  fieldColorMap: Map<string, string>;
  autoFields: Set<string>;
  activeFields: Set<string> | null;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
}) {
  const raw = event._raw;
  const focused = isAnyFocused(activeFields);

  const highlights: { start: number; end: number; field: string; color: string; isAuto: boolean }[] = [];

  for (const [field, value] of Object.entries(event.fields)) {
    const color = fieldColorMap.get(field);
    if (!color) continue;

    const isAuto = autoFields.has(field);
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (!v || v.length < 2) continue;
      const positions = findFieldValuePositions(raw, field, v);
      for (const idx of positions) {
        highlights.push({ start: idx, end: idx + v.length, field, color, isAuto });
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
        title={`${hl.field}${hl.isAuto ? ' (auto)' : ''}: ${raw.substring(hl.start, hl.end)}`}
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
