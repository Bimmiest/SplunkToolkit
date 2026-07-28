/**
 * Context kept either side of a substitution in a trace snapshot.
 */
const CONTEXT = 80;
/**
 * Hard cap per snapshot. A substitution larger than this is shown head-first —
 * the start of the change is the part that identifies it.
 */
const MAX = 400;

export interface ChangeWindow {
  inputSnapshot: string;
  outputSnapshot: string;
}

/**
 * Build trace snapshots windowed on the region that actually changed.
 *
 * A fixed-length prefix is not evidence: a substitution at character 800 leaves
 * a 200-character prefix of `before` byte-identical to the same prefix of
 * `after`, so the trace asserts a change while showing two identical strings.
 * Anchoring the window on the first and last differing character keeps the
 * snapshot bounded without letting it miss the thing it is meant to show.
 *
 * Elision is marked with a leading/trailing `…` so a windowed snapshot is never
 * mistaken for the whole event.
 */
export function changeWindow(before: string, after: string): ChangeWindow {
  // Longest common prefix.
  const minLen = Math.min(before.length, after.length);
  let start = 0;
  while (start < minLen && before[start] === after[start]) start++;

  // Longest common suffix, stopping at `start` so the two regions never overlap.
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  const from = Math.max(0, start - CONTEXT);
  return {
    inputSnapshot: slice(before, from, Math.min(before.length, endBefore + CONTEXT)),
    outputSnapshot: slice(after, from, Math.min(after.length, endAfter + CONTEXT)),
  };
}

function slice(text: string, from: number, to: number): string {
  const end = Math.min(to, from + MAX);
  return (from > 0 ? '…' : '') + text.slice(from, end) + (end < text.length ? '…' : '');
}
