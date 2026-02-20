import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { SplunkEvent } from '../../../engine/types';
import type { EnrichedEvent } from '../PreviewPanel';
import { findFieldValuePositions } from '../../../utils/fieldHighlight';

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

  return (
    <div className="p-3 space-y-3">
      {evalDirectives.size === 0 ? (
        <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)] text-sm">
          No EVAL-* directives configured in props.conf
        </div>
      ) : (
        items.map((item, idx) => {
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

          return (
            <CalcEventCard
              key={idx}
              event={item.event}
              globalIdx={globalIdx}
              calcFields={calcFields}
              fieldColorMap={fieldColorMap}
              activeFields={activeFields}
              pinnedFields={pinnedFields}
              onFieldHover={setHoveredField}
              onFieldClick={togglePin}
            />
          );
        })
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
          <div className="border-t border-[var(--color-border)] px-3 py-2">
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
