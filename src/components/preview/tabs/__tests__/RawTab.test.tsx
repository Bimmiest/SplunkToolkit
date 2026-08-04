// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RawTab } from '../RawTab';
import type { EnrichedEvent } from '../../PreviewPanel';
import type { SplunkEvent } from '../../../../engine/types';

function makeItem(raw: string, line: number): EnrichedEvent {
  const event: SplunkEvent = {
    _raw: raw,
    _time: null,
    _meta: {},
    fields: {},
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: line, end: line },
    processingTrace: [],
  };
  return { event, originalRaw: raw, hasChanges: false, hasMetadataChanges: false, isDropped: false };
}

const pageOne = [makeItem('first event', 1)];
const pageTwo = [makeItem('second event', 2)];

// The expanded metadata bar renders `sourcetype=…`; the label and value live in
// separate elements, so match against the flattened text rather than a node.
const metadataShown = () => document.body.textContent?.includes('sourcetype') === true;

// #23: EventRow holds expand/selection state locally. Keying rows by their slot
// on the page let React reuse the instance across a page change, so one event's
// expanded state appeared on a different event.
describe('RawTab — row state does not bleed across pages', () => {
  it('does not carry an expanded row onto the next page', () => {
    const { rerender } = render(
      <RawTab items={pageOne} currentPage={1} eventsPerPage={1} search="" />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Metadata/i }));
    expect(metadataShown()).toBe(true);

    rerender(<RawTab items={pageTwo} currentPage={2} eventsPerPage={1} search="" />);

    expect(screen.getByText(/Event #\s*2/)).toBeInTheDocument();
    expect(metadataShown()).toBe(false);
  });

  it('keeps the row expanded when the same event re-renders', () => {
    const { rerender } = render(
      <RawTab items={pageOne} currentPage={1} eventsPerPage={1} search="" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Metadata/i }));
    rerender(<RawTab items={pageOne} currentPage={1} eventsPerPage={1} search="" />);
    expect(metadataShown()).toBe(true);
  });
});

describe('RawTab — CLONE_SOURCETYPE badge (#87)', () => {
  it('says where a cloned event came from', () => {
    const cloned = makeItem('2024-01-15 user=alice', 1);
    cloned.event.clonedFrom = 'my_app';
    const { container } = render(
      <RawTab items={[cloned]} currentPage={1} eventsPerPage={10} search="" />,
    );
    expect(container.textContent).toContain('Cloned from my_app');
  });

  it('badges nothing on an ordinary event', () => {
    const { container } = render(
      <RawTab items={[makeItem('2024-01-15 user=alice', 1)]} currentPage={1} eventsPerPage={10} search="" />,
    );
    expect(container.textContent).not.toContain('Cloned from');
  });
});
