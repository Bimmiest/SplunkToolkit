// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useOverlay } from '../useOverlay';

function Overlay({
  open,
  onClose,
  label,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
}) {
  const ref = useOverlay({ open, onClose });
  if (!open) return null;
  return (
    <div ref={ref} data-testid={`overlay-${label}`}>
      <div role="dialog" aria-modal="true" aria-label={label}>
        <button>{`${label}-first`}</button>
        <button>{`${label}-last`}</button>
      </div>
    </div>
  );
}

function Shell({ outer, inner, onOuter, onInner }: {
  outer: boolean; inner: boolean; onOuter: () => void; onInner: () => void;
}) {
  return (
    <div>
      <main id="main-content">
        <button>background</button>
      </main>
      <Overlay open={outer} onClose={onOuter} label="outer" />
      <Overlay open={inner} onClose={onInner} label="inner" />
    </div>
  );
}

// #77.1: every overlay registered its own document Escape listener, so one press
// closed every open layer at once.
describe('useOverlay — Escape closes only the topmost layer (#77)', () => {
  it('closes the inner overlay and leaves the outer one open', () => {
    const onOuter = vi.fn();
    const onInner = vi.fn();
    render(<Shell outer inner onOuter={onOuter} onInner={onInner} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onInner).toHaveBeenCalledTimes(1);
    expect(onOuter).not.toHaveBeenCalled();
  });

  it('closes the only open overlay', () => {
    const onOuter = vi.fn();
    render(<Shell outer inner={false} onOuter={onOuter} onInner={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onOuter).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const onOuter = vi.fn();
    render(<Shell outer inner={false} onOuter={onOuter} onInner={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'a' });
    expect(onOuter).not.toHaveBeenCalled();
  });
});

// #17 / #77.2: `aria-modal="true"` asserts the background is inert, but nothing
// hid it, so an assistive-tech virtual cursor could still reach it.
describe('useOverlay — background is marked inert (#17)', () => {
  it('hides sibling content while open and restores it on close', () => {
    const { rerender, container } = render(
      <Shell outer inner={false} onOuter={vi.fn()} onInner={vi.fn()} />,
    );
    const main = container.querySelector('#main-content')!;
    expect(main.getAttribute('aria-hidden')).toBe('true');

    rerender(<Shell outer={false} inner={false} onOuter={vi.fn()} onInner={vi.fn()} />);
    expect(main.hasAttribute('aria-hidden')).toBe(false);
  });

  it('does not reveal the background when a stacked overlay closes', () => {
    const { rerender, container } = render(
      <Shell outer inner onOuter={vi.fn()} onInner={vi.fn()} />,
    );
    const main = container.querySelector('#main-content')!;
    expect(main.getAttribute('aria-hidden')).toBe('true');

    // Close only the inner one — the outer overlay still covers the page.
    rerender(<Shell outer inner={false} onOuter={vi.fn()} onInner={vi.fn()} />);
    expect(main.getAttribute('aria-hidden')).toBe('true');
  });
});

// #17: the palette called preventDefault() on every Tab, which disables tabbing
// rather than cycling it, and swallowed Shift+Tab too.
describe('useOverlay — focus trap cycles instead of blocking (#17)', () => {
  it('wraps from the last focusable back to the first', () => {
    render(<Shell outer inner={false} onOuter={vi.fn()} onInner={vi.fn()} />);
    const last = screen.getByText('outer-last');
    const first = screen.getByText('outer-first');
    last.focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(first);
  });

  it('wraps backwards from the first to the last on Shift+Tab', () => {
    render(<Shell outer inner={false} onOuter={vi.fn()} onInner={vi.fn()} />);
    const first = screen.getByText('outer-first');
    const last = screen.getByText('outer-last');
    first.focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('pulls focus back in when it has drifted to the background', () => {
    render(<Shell outer inner={false} onOuter={vi.fn()} onInner={vi.fn()} />);
    screen.getByText('background').focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByText('outer-first'));
  });

  it('only the topmost overlay traps focus', () => {
    render(<Shell outer inner onOuter={vi.fn()} onInner={vi.fn()} />);
    screen.getByText('inner-last').focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByText('inner-first'));
  });
});
