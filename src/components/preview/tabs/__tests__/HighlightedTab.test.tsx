// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HighlightedTab } from '../HighlightedTab';
import { useAppStore } from '../../../../store/useAppStore';
import type { EnrichedEvent } from '../../PreviewPanel';
import type { SplunkEvent, ProcessingStep } from '../../../../engine/types';

function makeEvent(
  raw: string,
  fields: Record<string, string | string[]>,
  traces: ProcessingStep[],
): SplunkEvent {
  return {
    _raw: raw,
    _time: null,
    _meta: {},
    fields,
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: traces,
  };
}

function toItem(event: SplunkEvent): EnrichedEvent {
  return {
    event,
    originalRaw: event._raw,
    hasChanges: false,
    hasMetadataChanges: false,
    isDropped: false,
  };
}

const eventWithAuto = makeEvent(
  '{"user":"alice","status":"ok"}',
  { user: 'alice', status: 'ok' },
  [{ processor: 'KV_MODE', phase: 'search-time', description: '', fieldsAdded: ['user', 'status'] }],
);

const eventWithManual = makeEvent(
  'admin logged in',
  { username: 'admin' },
  [{ processor: 'EXTRACT-user', phase: 'search-time', description: '', fieldsAdded: ['username'] }],
);

const eventWithBoth = makeEvent(
  'login: bob',
  { user: 'bob', action: 'login' },
  [
    { processor: 'KV_MODE', phase: 'search-time', description: '', fieldsAdded: ['user'] },
    { processor: 'EXTRACT-action', phase: 'search-time', description: '', fieldsAdded: ['action'] },
  ],
);

const items: EnrichedEvent[] = [toItem(eventWithAuto), toItem(eventWithManual), toItem(eventWithBoth)];

const initial = useAppStore.getState();

describe('HighlightedTab', () => {
  beforeEach(() => {
    useAppStore.setState(initial, true);
  });

  it('renders an event card per item by default', () => {
    render(<HighlightedTab items={items} allEvents={items} currentPage={1} eventsPerPage={10} />);
    expect(screen.getAllByText(/Event #/)).toHaveLength(3);
  });

  it('shows Auto / Manual / Calculated / All filter pills', () => {
    render(<HighlightedTab items={items} allEvents={items} currentPage={1} eventsPerPage={10} />);
    for (const label of ['Auto', 'Manual', 'Calculated', 'All']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it('filter pill counts reflect auto vs manual classification', () => {
    render(<HighlightedTab items={items} allEvents={items} currentPage={1} eventsPerPage={10} />);
    // auto fields: user, status (user also appears as auto in eventWithBoth)
    expect(screen.getByRole('button', { name: /^Auto\s*\(2\)/ })).toBeInTheDocument();
    // manual fields: username, action
    expect(screen.getByRole('button', { name: /^Manual\s*\(2\)/ })).toBeInTheDocument();
  });

  it('toggles sidebar on Fields button click', () => {
    render(<HighlightedTab items={items} allEvents={items} currentPage={1} eventsPerPage={10} />);
    const fieldsBtn = screen.getByRole('button', { name: /^Fields/ });
    // Sidebar starts open — at least one field name should be visible in the sidebar tree.
    // Search input in sidebar has placeholder "Filter fields..." — look for it.
    expect(screen.getByPlaceholderText(/Filter fields/i)).toBeInTheDocument();
    fireEvent.click(fieldsBtn);
    expect(screen.queryByPlaceholderText(/Filter fields/i)).not.toBeInTheDocument();
  });

  it('renders "events match pinned" counter when a field is pinned via Fields sidebar', () => {
    const { container } = render(
      <HighlightedTab items={items} allEvents={items} currentPage={1} eventsPerPage={10} />,
    );
    // Click the "username" field chip in the sidebar to pin it.
    const sidebarUsername = within(container).getAllByText('username')[0];
    fireEvent.click(sidebarUsername);
    // Only events containing `username` (eventWithManual) should remain — pin counter appears.
    expect(screen.getByText(/events match 1 pinned field/i)).toBeInTheDocument();
  });
});
