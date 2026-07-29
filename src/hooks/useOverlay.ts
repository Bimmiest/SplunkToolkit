import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Shared modal-overlay behaviour: an Escape layer stack, a focus trap, and
 * background inertness.
 *
 * Each overlay used to register its own document-level Escape listener and
 * declare `aria-modal="true"` without doing either of the things that assertion
 * promises. The result was three distinct defects:
 *
 *  - **One Escape dismissed several layers.** With Settings open, opening the
 *    command palette and pressing Escape closed both — every listener fired,
 *    and nothing established which layer was on top.
 *  - **No focus trap.** `aria-modal="true"` asserts the rest of the page is
 *    inert, but Tab walked straight out into the content behind the overlay.
 *    (The command palette "solved" this by calling `preventDefault()` on every
 *    Tab, which disables tabbing rather than cycling it — and swallowed
 *    Shift+Tab too.)
 *  - **Background reachable by assistive tech.** Nothing marked the app root
 *    hidden, so a virtual cursor could still read and act on content the modal
 *    claims to have covered.
 *
 * The layer stack is module-level on purpose: overlays are siblings in the
 * tree, so "am I on top?" cannot be answered from within one component.
 */

/** Marks a node as an overlay root, so overlays never mark each other inert. */
const OVERLAY_ROOT_ATTR = 'data-overlay-root';

/** Open overlays, oldest first. The last entry owns Escape. */
const layerStack: symbol[] = [];

/** Selector for the elements a focus trap should cycle between. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Focusable descendants, skipping anything deliberately hidden.
 *
 * The exclusion is by explicit inertness (`inert` / `hidden` /
 * `aria-hidden="true"`) rather than computed layout: `offsetParent` depends on
 * a layout engine, so a layout-based filter silently matches nothing under
 * jsdom — the trap would look correct and do nothing in every test.
 */
function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert], [hidden], [aria-hidden="true"]'),
  );
}

/**
 * Hide everything alongside the overlay from assistive technology, and return
 * an undo function.
 *
 * The overlays are siblings of `#main-content` inside the app shell, so hiding
 * the app root would hide the overlay along with the background. Hiding the
 * overlay's own siblings marks exactly the content the modal covers.
 *
 * Elements already marked hidden are left alone and not restored: with stacked
 * overlays, the outer one hid the background first, and the inner one must not
 * reveal it again on close.
 */
function inertSiblingsOf(overlayRoot: HTMLElement): () => void {
  const parent = overlayRoot.parentElement;
  if (!parent) return () => {};

  const hidden: HTMLElement[] = [];
  for (const sibling of Array.from(parent.children)) {
    if (sibling === overlayRoot || !(sibling instanceof HTMLElement)) continue;
    // Never hide another overlay. Siblings are marked from each overlay's own
    // mount effect, which runs in DOM order — so an overlay appearing EARLIER in
    // the tree would otherwise mark a later, higher one hidden, and the focus
    // trap (which skips aria-hidden subtrees) would then find nothing to cycle.
    // The cost is that a stacked lower overlay stays readable; hiding the active
    // dialog is much worse than that.
    if (sibling.hasAttribute(OVERLAY_ROOT_ATTR)) continue;
    if (sibling.hasAttribute('aria-hidden')) continue;
    sibling.setAttribute('aria-hidden', 'true');
    hidden.push(sibling);
  }
  return () => {
    for (const el of hidden) el.removeAttribute('aria-hidden');
  };
}

export interface OverlayOptions {
  /** Whether the overlay is currently rendered. */
  open: boolean;
  /** Called when Escape is pressed AND this overlay is the topmost layer. */
  onClose: () => void;
  /** Skip marking sibling content hidden (for a non-modal popover). */
  skipBackgroundInert?: boolean;
}

/**
 * Returns a ref to attach to the overlay's OUTERMOST element — the backdrop, if
 * there is one. Sibling content is hidden relative to that node, and the focus
 * trap cycles within it.
 *
 * ```tsx
 * const ref = useOverlay({ open, onClose });
 * return <div ref={ref} className="fixed inset-0 …">
 *          <div role="dialog" aria-modal="true">…</div>
 *        </div>;
 * ```
 */
export function useOverlay<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  skipBackgroundInert = false,
}: OverlayOptions) {
  const containerRef = useRef<T | null>(null);
  const layerId = useRef<symbol>(Symbol('overlay'));
  // Read through a ref so the effects don't re-run on every render when the
  // caller passes an inline closure. Assigned in an effect, not during render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Register this overlay as a layer for as long as it is open.
  useEffect(() => {
    if (!open) return;
    const id = layerId.current;
    layerStack.push(id);
    return () => {
      const i = layerStack.lastIndexOf(id);
      if (i >= 0) layerStack.splice(i, 1);
    };
  }, [open]);

  // Escape closes the TOPMOST layer only. Capture phase plus stopPropagation so
  // a lower layer's own handler never sees the same keypress.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (layerStack[layerStack.length - 1] !== layerId.current) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  // Focus trap: Tab cycles within the overlay instead of escaping to the page.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      if (layerStack[layerStack.length - 1] !== layerId.current) return;

      const focusable = focusableWithin(container);
      if (focusable.length === 0) {
        e.preventDefault(); // nothing to move to — keep focus where it is
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Wrap at the ends, and pull focus back in if it has drifted outside.
      if (!container.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  // Mark this node as an overlay root in a LAYOUT effect: layout effects for the
  // whole commit run before any passive effect, so every overlay is marked
  // before the first one starts hiding siblings. Doing it in the passive effect
  // below would let an earlier overlay hide a later one that had not yet
  // identified itself.
  useLayoutEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    container?.setAttribute(OVERLAY_ROOT_ATTR, '');
    return () => container?.removeAttribute(OVERLAY_ROOT_ATTR);
  }, [open]);

  // Make the background inert while open, and restore focus to whatever had it
  // when the overlay opened.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const restoreSiblings =
      !skipBackgroundInert && container ? inertSiblingsOf(container) : () => {};
    return () => {
      restoreSiblings();
      previouslyFocused?.focus?.();
    };
  }, [open, skipBackgroundInert]);

  return containerRef;
}
