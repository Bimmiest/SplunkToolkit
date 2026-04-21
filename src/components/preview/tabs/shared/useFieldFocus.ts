import { useCallback, useState } from 'react';
export { FIELD_COLORS } from './fieldColors';

export function isFieldActive(field: string, activeFields: Set<string> | null): boolean {
  return activeFields === null || activeFields.has(field);
}

export function isAnyFocused(activeFields: Set<string> | null): boolean {
  return activeFields !== null;
}

export function useFieldFocus() {
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
