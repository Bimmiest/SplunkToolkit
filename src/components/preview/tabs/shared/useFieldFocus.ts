import { useCallback, useState } from 'react';

export const FIELD_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#a855f7', '#84cc16',
];

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
