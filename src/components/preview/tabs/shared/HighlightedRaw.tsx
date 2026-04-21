import { findFieldValuePositions } from '../../../../utils/fieldHighlight';
import { isFieldActive, isAnyFocused } from './useFieldFocus';

interface Highlight {
  start: number;
  end: number;
  field: string;
  color: string;
}

interface HighlightedRawProps {
  raw: string;
  /** field name → hex color; only fields present in this map are highlighted */
  fieldColorMap: Map<string, string>;
  /** field name → value(s) to locate in the raw text */
  fieldValues: Map<string, string | string[]>;
  activeFields: Set<string> | null;
  /** Returns the tooltip title for a highlighted span */
  titleFor: (field: string, value: string) => string;
  onFieldHover: (field: string | null) => void;
  onFieldClick: (field: string) => void;
  /** Maps stripped field name → original raw key (e.g. "GID" → "_GID") for context matching */
  fieldSourceKeys?: Record<string, string>;
  /**
   * Authoritative start/end offsets in `raw` per field (from positional extractions).
   * When present for a field, these offsets are used directly and context matching is skipped.
   */
  fieldOffsets?: Record<string, Array<[number, number]>>;
}

export function HighlightedRaw({
  raw,
  fieldColorMap,
  fieldValues,
  activeFields,
  titleFor,
  onFieldHover,
  onFieldClick,
  fieldSourceKeys,
  fieldOffsets,
}: HighlightedRawProps) {
  const focused = isAnyFocused(activeFields);

  const highlights: Highlight[] = [];

  for (const [field, color] of fieldColorMap) {
    const rawValue = fieldValues.get(field);
    if (rawValue === undefined) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    // Prefer authoritative offsets from positional extraction. Verify each offset
    // still matches one of the current field values — guards against later processors
    // that mutate _raw or the field value after EXTRACT runs.
    const offsetList = fieldOffsets?.[field];
    if (offsetList && offsetList.length > 0) {
      const valueSet = new Set(values.filter(Boolean));
      let usedAny = false;
      for (const [s, e] of offsetList) {
        if (s < 0 || e > raw.length || s >= e) continue;
        if (valueSet.has(raw.substring(s, e))) {
          highlights.push({ start: s, end: e, field, color });
          usedAny = true;
        }
      }
      if (usedAny) continue;
    }

    const originalKey = fieldSourceKeys?.[field];
    for (const v of values) {
      if (!v) continue;
      const positions = findFieldValuePositions(raw, field, v, originalKey);
      for (const idx of positions) {
        highlights.push({ start: idx, end: idx + v.length, field, color });
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
        <span key={`text-${lastEnd}`} style={{ opacity: focused ? 0.3 : 1, transition: 'opacity 0.15s' }}>
          {raw.substring(lastEnd, hl.start)}
        </span>
      );
    }

    const active = isFieldActive(hl.field, activeFields);
    const value = raw.substring(hl.start, hl.end);

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
        title={titleFor(hl.field, value)}
        className="rounded-sm px-0.5"
        onMouseEnter={() => onFieldHover(hl.field)}
        onMouseLeave={() => onFieldHover(null)}
        onClick={() => onFieldClick(hl.field)}
      >
        {value}
      </span>
    );

    lastEnd = hl.end;
  }

  if (lastEnd < raw.length) {
    segments.push(
      <span key={`text-${lastEnd}`} style={{ opacity: focused ? 0.3 : 1, transition: 'opacity 0.15s' }}>
        {raw.substring(lastEnd)}
      </span>
    );
  }

  return <>{segments}</>;
}
