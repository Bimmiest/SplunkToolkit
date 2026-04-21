// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RegexTab } from '../RegexTab';
import type { EnrichedEvent } from '../../PreviewPanel';
import type { SplunkEvent } from '../../../../engine/types';

function makeEvent(raw: string): SplunkEvent {
  return {
    _raw: raw,
    _time: null,
    _meta: {},
    fields: {},
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: [],
  };
}

function makeItem(raw: string): EnrichedEvent {
  return {
    event: makeEvent(raw),
    originalRaw: raw,
    hasChanges: false,
    hasMetadataChanges: false,
    isDropped: false,
  };
}

const items: EnrichedEvent[] = [
  makeItem('192.168.1.1 - GET /foo 200'),
  makeItem('10.0.0.5 - POST /bar 404'),
  makeItem('no ip here, just text'),
];

describe('RegexTab', () => {
  it('renders empty-state prompt when no pattern is typed', () => {
    render(<RegexTab items={items} currentPage={1} eventsPerPage={10} />);
    expect(screen.getByText(/Enter a pattern above to test matches/i)).toBeInTheDocument();
    // No event cards
    expect(screen.queryByText(/Event #/)).not.toBeInTheDocument();
  });

  it('renders only matching events when pattern is typed', () => {
    render(<RegexTab items={items} currentPage={1} eventsPerPage={10} />);
    const input = screen.getByPlaceholderText(/\\d\+/);
    fireEvent.change(input, { target: { value: '\\d+\\.\\d+\\.\\d+\\.\\d+' } });

    // Only two events match (third has no IP)
    const cards = screen.getAllByText(/Event #/);
    expect(cards).toHaveLength(2);
    expect(screen.getByText('2/3 events matched')).toBeInTheDocument();
  });

  it('shows "No events matched" when pattern is valid but has no hits', () => {
    render(<RegexTab items={items} currentPage={1} eventsPerPage={10} />);
    const input = screen.getByPlaceholderText(/\\d\+/);
    fireEvent.change(input, { target: { value: 'this_text_does_not_appear' } });

    expect(screen.getByText(/No events matched/i)).toBeInTheDocument();
    expect(screen.queryByText(/Event #/)).not.toBeInTheDocument();
  });

  it('surfaces validation error for invalid regex', () => {
    render(<RegexTab items={items} currentPage={1} eventsPerPage={10} />);
    const input = screen.getByPlaceholderText(/\\d\+/);
    fireEvent.change(input, { target: { value: '[unterminated' } });

    expect(screen.getByText(/Fix the regex error above/i)).toBeInTheDocument();
  });
});
