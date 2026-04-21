import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { EnrichedEvent } from '../PreviewPanel';
import { FIELD_COLORS, isFieldActive, isAnyFocused, useFieldFocus } from './shared/useFieldFocus';
import { FieldEventCard } from './shared/FieldEventCard';
import { FieldSidebar } from './shared/FieldSidebar';
import { FieldSplitLayout } from './shared/FieldSplitLayout';
import { FieldTreeNode } from './shared/FieldTreeNode';
import { buildFieldTree } from './shared/fieldTreeUtils';
import type { FieldNode } from './shared/fieldTreeUtils';

const AUTO_PROCESSORS = ['KV_MODE', 'INDEXED_EXTRACTIONS'];
const MANUAL_PROCESSORS = ['EXTRACT', 'REPORT', 'TRANSFORMS', 'SEDCMD'];

function isAutoProcessor(p: string) { return AUTO_PROCESSORS.some((a) => p.startsWith(a)); }
function isManualProcessor(p: string) { return MANUAL_PROCESSORS.some((m) => p.startsWith(m)); }

type FieldFilter = 'auto' | 'manual' | 'calc' | 'all';

function isJsonContainer(value: string | string[]): boolean {
  if (Array.isArray(value)) return false;
  const t = value.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { JSON.parse(t); return true; } catch { return false; }
  }
  return false;
}

export interface HighlightedTabProps {
  items: EnrichedEvent[];
  allEvents: EnrichedEvent[];
  currentPage: number;
  eventsPerPage: number;
}

export function HighlightedTab({ items, allEvents, currentPage, eventsPerPage }: HighlightedTabProps) {
  const [fieldFilter, setFieldFilter] = useState<FieldFilter>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { pinnedFields, activeFields, togglePin, setHoveredField } = useFieldFocus();
  const propsConf = useAppStore((s) => s.propsConf);

  const evalDirectives = useMemo(() => {
    const map = new Map<string, string>();
    for (const match of propsConf.matchAll(/^\s*EVAL-(\S+)\s*=\s*(.+)$/gmi)) {
      map.set(match[1], match[2].trim());
    }
    return map;
  }, [propsConf]);

  const { autoFields, manualFields, calcFields, fieldProcessorMap } = useMemo(() => {
    const auto = new Set<string>();
    const manual = new Set<string>();
    const calc = new Set<string>();
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
            processorMap.set(f, step.processor);
          }
        } else if (step.processor === 'EVAL') {
          for (const f of step.fieldsAdded) {
            calc.add(f);
            processorMap.set(f, 'EVAL');
          }
        }
      }
    }
    return { autoFields: auto, manualFields: manual, calcFields: calc, fieldProcessorMap: processorMap };
  }, [allEvents]);

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
    const includeAuto = fieldFilter === 'auto' || fieldFilter === 'all';
    const includeManual = fieldFilter === 'manual' || fieldFilter === 'all';
    const includeCalc = fieldFilter === 'calc' || fieldFilter === 'all';

    for (const { event } of allEvents) {
      for (const key of Object.keys(event.fields)) {
        const isAuto = autoFields.has(key);
        const isManual = manualFields.has(key);
        const isCalc = calcFields.has(key);
        if (!isAuto && !isManual && !isCalc) continue;
        // EVAL wins over earlier extractors: calc > manual > auto
        const effectiveCategory: FieldFilter = isCalc ? 'calc' : isManual ? 'manual' : 'auto';
        if (effectiveCategory === 'auto' && !includeAuto) continue;
        if (effectiveCategory === 'manual' && !includeManual) continue;
        if (effectiveCategory === 'calc' && !includeCalc) continue;
        if (!map.has(key)) {
          map.set(key, FIELD_COLORS[colorIdx % FIELD_COLORS.length]);
          colorIdx++;
        }
      }
    }
    return map;
  }, [allEvents, autoFields, manualFields, calcFields, fieldFilter]);

  const highlightColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [key, color] of fieldColorMap) {
      if (!containerFields.has(key)) map.set(key, color);
    }
    return map;
  }, [fieldColorMap, containerFields]);

  const filteredItems = useMemo(() => {
    if (pinnedFields.size === 0) return items;
    return allEvents.filter(({ event }) => {
      for (const pinned of pinnedFields) {
        if (pinned in event.fields) return true;
      }
      return false;
    });
  }, [items, allEvents, pinnedFields]);

  const tree = useMemo(
    () => buildFieldTree(fieldColorMap, containerFields, fieldProcessorMap),
    [fieldColorMap, containerFields, fieldProcessorMap]
  );

  const allGroupNames = useMemo(() => {
    const groups: string[] = [];
    function walk(nodes: FieldNode[]) {
      for (const n of nodes) { if (n.children.length > 0) { groups.push(n.name); walk(n.children); } }
    }
    walk(tree);
    return groups;
  }, [tree]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string> | null>(null);
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

  const showCalcStrip = fieldFilter === 'calc' || fieldFilter === 'all';

  const eventBadgeCounts = useMemo(() =>
    filteredItems.map((item) => {
      const eventFields = Object.keys(item.event.fields).filter((f) => highlightColorMap.has(f));
      const evalTrace = item.event.processingTrace.find((t) => t.processor === 'EVAL');
      const eventCalcFields = showCalcStrip
        ? Array.from(evalDirectives.entries()).flatMap(([fieldName, expression]) => {
            const wasComputed = evalTrace?.fieldsAdded?.includes(fieldName) ?? false;
            if (!wasComputed) return [];
            const value = item.event.fields[fieldName];
            if (value === undefined || value === null || value === 'null' || value === '') return [];
            return [{ name: fieldName, expression, value }];
          })
        : [];
      let autoCount = 0;
      let manualCount = 0;
      const calcCount = eventCalcFields.length;
      if (fieldFilter === 'auto') {
        autoCount = eventFields.length;
      } else if (fieldFilter === 'manual') {
        manualCount = eventFields.length;
      } else if (fieldFilter !== 'calc') {
        for (const f of eventFields) {
          if (calcFields.has(f)) { /* counted above */ }
          else if (manualFields.has(f)) manualCount++;
          else autoCount++;
        }
      }
      return { eventCalcFields, autoCount, manualCount, calcCount };
    }),
    [filteredItems, fieldFilter, highlightColorMap, evalDirectives, showCalcStrip, manualFields, calcFields]
  );

  const sidebar = (
    <FieldSidebar
      fieldCount={fieldColorMap.size}
      activeFields={activeFields}
      onCollapse={() => setSidebarCollapsed(true)}
      renderControls={() =>
        allGroupNames.length > 0 ? (
          <button
            className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer bg-transparent border-none p-0"
            onClick={() => {
              const allCollapsed = allGroupNames.every((g) => effectiveCollapsed.has(g));
              setCollapsedGroups(allCollapsed ? new Set() : new Set(allGroupNames));
            }}
          >
            {allGroupNames.every((g) => effectiveCollapsed.has(g)) ? 'Expand all' : 'Collapse all'}
          </button>
        ) : null
      }
      renderItems={(search) =>
        tree.map((node) => (
          <FieldTreeNode
            key={node.name}
            node={node}
            collapsed={effectiveCollapsed}
            toggleGroup={toggleGroup}
            activeFields={activeFields}
            pinnedFields={pinnedFields}
            onHover={setHoveredField}
            onClick={togglePin}
            search={search}
          />
        ))
      }
    />
  );

  const filterButtons: { id: FieldFilter; label: string; count: number }[] = [
    { id: 'auto', label: 'Auto', count: autoFields.size },
    { id: 'manual', label: 'Manual', count: manualFields.size },
    { id: 'calc', label: 'Calculated', count: calcFields.size },
    { id: 'all', label: 'All', count: autoFields.size + manualFields.size + calcFields.size },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Show:</span>
          <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
            {filterButtons.map(({ id, label, count }) => (
              <button
                key={id}
                onClick={() => setFieldFilter(id)}
                className="px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: fieldFilter === id ? 'var(--color-accent)' : 'transparent',
                  color: fieldFilter === id ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
                }}
              >
                {label}
                {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
              </button>
            ))}
          </div>

          {pinnedFields.size > 0 && (
            <span className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1.5">
              {filteredItems.length}/{items.length} events match {pinnedFields.size} pinned field{pinnedFields.size > 1 ? 's' : ''}
              <button
                type="button"
                onClick={() => { for (const f of pinnedFields) togglePin(f); }}
                className="text-[10px] text-[var(--color-accent)] hover:underline bg-transparent border-none p-0 cursor-pointer"
              >
                Clear
              </button>
            </span>
          )}

          {/* Fields sidebar toggle — right-aligned */}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? 'Show fields sidebar' : 'Hide fields sidebar'}
            className={[
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors ml-auto',
              !sidebarCollapsed
                ? 'bg-[var(--color-bg-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)] shadow-sm'
                : 'border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
            ].join(' ')}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
            Fields
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <FieldSplitLayout
          storageKey="highlighted-split-layout"
          collapsed={sidebarCollapsed}
          sidebar={sidebar}
        >
          {filteredItems.map((item, idx) => {
            const globalIdx = (currentPage - 1) * eventsPerPage + idx + 1;
            const { eventCalcFields, autoCount, manualCount, calcCount } = eventBadgeCounts[idx];

            const fieldValues = new Map<string, string | string[]>(
              Object.entries(item.event.fields).filter(([k]) => highlightColorMap.has(k))
            );

            const focused = isAnyFocused(activeFields);

            return (
              <FieldEventCard
                key={idx}
                event={item.event}
                globalIdx={globalIdx}
                fieldColorMap={highlightColorMap}
                fieldValues={fieldValues}
                activeFields={activeFields}
                fieldSourceKeys={item.event.fieldSourceKeys}
                fieldOffsets={item.event.fieldOffsets}
                titleFor={(field, value) => {
                  const tag = manualFields.has(field) ? 'manual' : calcFields.has(field) ? 'calc' : 'auto';
                  return `${field} (${tag}): ${value}`;
                }}
                onFieldHover={setHoveredField}
                onFieldClick={togglePin}
                badges={
                  <>
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
                    {calcCount > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-success)]/15 text-[var(--color-success)]">
                        {calcCount} calc
                      </span>
                    )}
                  </>
                }
              >
                {/* Calculated field summary strip + Eval Expressions (only when calc filter active) */}
                {eventCalcFields.length > 0 && (
                  <>
                    <div className="border-t border-[var(--color-border)] px-3 py-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {eventCalcFields.map((cf) => {
                          const color = fieldColorMap.get(cf.name) ?? 'var(--color-text-muted)';
                          const display = Array.isArray(cf.value) ? cf.value.join(', ') : cf.value;
                          const active = isFieldActive(cf.name, activeFields);
                          const pinned = pinnedFields.has(cf.name);
                          return (
                            <span
                              key={cf.name}
                              className="inline-flex items-center gap-1.5 text-xs font-mono cursor-pointer select-none"
                              style={{ opacity: focused && !active ? 0.2 : 1, transition: 'opacity 0.15s' }}
                              onMouseEnter={() => setHoveredField(cf.name)}
                              onMouseLeave={() => setHoveredField(null)}
                              onClick={() => togglePin(cf.name)}
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
                    <details className="border-t border-[var(--color-border)]">
                      <summary className="px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] cursor-pointer select-none hover:text-[var(--color-text-secondary)] transition-colors">
                        Eval Expressions
                      </summary>
                      <div className="px-3 py-2 border-t border-[var(--color-border)]">
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {eventCalcFields.map((cf) => {
                            const color = fieldColorMap.get(cf.name) ?? 'var(--color-text-muted)';
                            const active = isFieldActive(cf.name, activeFields);
                            const pinned = pinnedFields.has(cf.name);
                            return (
                              <span
                                key={cf.name}
                                className="inline-flex items-center gap-1.5 text-xs font-mono cursor-pointer select-none"
                                style={{ opacity: focused && !active ? 0.2 : 1, transition: 'opacity 0.15s' }}
                                onMouseEnter={() => setHoveredField(cf.name)}
                                onMouseLeave={() => setHoveredField(null)}
                                onClick={() => togglePin(cf.name)}
                              >
                                <span style={{ color }} className="font-medium">{cf.name}</span>
                                <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">expr</span>
                                <code
                                  className="text-[var(--color-text-secondary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded"
                                  style={{ outline: pinned ? `2px solid ${color}` : 'none', outlineOffset: '1px' }}
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
              </FieldEventCard>
            );
          })}
        </FieldSplitLayout>
      </div>
    </div>
  );
}
