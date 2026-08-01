// Typed as non-empty so `fieldColorAt` has an element it can always fall back
// on. Every consumer cycles through this palette by index, and a palette with no
// colours in it would have no meaningful answer to give them.
export const FIELD_COLORS: readonly [string, ...string[]] = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#a855f7', '#84cc16',
];

/**
 * The colour for the `index`-th distinct field, cycling once the palette runs
 * out. The modulo keeps the index in range; the fallback only exists to say so
 * in a way the compiler can check.
 */
export function fieldColorAt(index: number): string {
  return FIELD_COLORS[index % FIELD_COLORS.length] ?? FIELD_COLORS[0];
}
