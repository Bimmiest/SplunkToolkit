import { useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { tokenizeRaw } from './tokenizeRaw';

export interface RawSelection {
  start: number;
  end: number;
}

const SELECTED_STYLE = {
  backgroundColor: 'var(--color-accent)',
  color: 'var(--color-text-on-accent)',
} as const;

/**
 * Character offset of a DOM boundary within `container`, measured by the length of
 * the text from the container's start up to the boundary. Because the rendered text
 * equals `raw` exactly (segments concatenate to the input), this is the raw offset.
 */
function charOffset(container: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** Map a viewport point to a raw character offset via caret hit-testing. */
function offsetFromPoint(container: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let off = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; off = pos.offset; }
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; off = r.startOffset; }
  }
  if (!node || !container.contains(node)) return null;
  return charOffset(container, node, off);
}

/**
 * Renders raw event text as a fully React-controlled selection. Native text
 * selection is disabled (`select-none`) so there is no system-blue highlight and no
 * reliance on window.getSelection (which the context menu clears on open) — the drag
 * is tracked from mouse coordinates instead. Click a token to select it, shift-click
 * to extend, click it again (or click whitespace) to clear, or drag across the text:
 * the range is snapped out to the tokens it touches and every segment in between
 * (tokens and gaps) is filled, so the highlight is one continuous block.
 */
export function SelectableRaw({
  raw,
  selection,
  onChange,
}: {
  raw: string;
  selection: RawSelection | null;
  onChange: (sel: RawSelection | null) => void;
}) {
  const segments = useMemo(() => tokenizeRaw(raw), [raw]);
  const containerRef = useRef<HTMLSpanElement>(null);

  const snapToTokens = (lo: number, hi: number): RawSelection | null => {
    let start = lo;
    let end = hi;
    let touched = false;
    for (const s of segments) {
      if (s.selectable && s.start < hi && s.end > lo) {
        start = Math.min(start, s.start);
        end = Math.max(end, s.end);
        touched = true;
      }
    }
    return touched ? { start, end } : null;
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return; // ignore right/middle — right-click opens the menu
    const container = containerRef.current;
    if (!container) return;
    const anchor = offsetFromPoint(container, e.clientX, e.clientY);
    if (anchor == null) return;
    e.preventDefault(); // no native caret/selection

    let moved = false;
    const move = (ev: MouseEvent) => {
      const cur = offsetFromPoint(container, ev.clientX, ev.clientY);
      if (cur == null) return;
      const lo = Math.min(anchor, cur);
      const hi = Math.max(anchor, cur);
      if (hi > lo) {
        moved = true;
        onChange(snapToTokens(lo, hi));
      }
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (moved) return; // a drag was already applied live in `move`
      // No drag → treat as a click: select / toggle / extend the token under it.
      const seg = segments.find((s) => s.selectable && anchor >= s.start && anchor < s.end);
      if (!seg) { onChange(null); return; }
      if (ev.shiftKey && selection) {
        onChange({ start: Math.min(selection.start, seg.start), end: Math.max(selection.end, seg.end) });
      } else if (selection && selection.start === seg.start && selection.end === seg.end) {
        onChange(null);
      } else {
        onChange({ start: seg.start, end: seg.end });
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <span ref={containerRef} className="select-none" onMouseDown={onMouseDown}>
      {segments.map((seg) => {
        const selected = selection != null && seg.start >= selection.start && seg.end <= selection.end;
        if (!seg.selectable) {
          return <span key={seg.start} style={selected ? SELECTED_STYLE : undefined}>{seg.text}</span>;
        }
        return (
          <span
            key={seg.start}
            className={`cursor-pointer rounded-sm ${selected ? '' : 'hover:bg-[var(--color-bg-tertiary)]'}`}
            style={selected ? SELECTED_STYLE : undefined}
          >
            {seg.text}
          </span>
        );
      })}
    </span>
  );
}
