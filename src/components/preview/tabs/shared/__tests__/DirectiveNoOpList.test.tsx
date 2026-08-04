// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { DirectiveNoOpList } from '../DirectiveNoOpList';
import { groupNoOps } from '../../../../../engine/groupNoOps';
import type { DirectiveNoOp, SplunkEvent } from '../../../../../engine/types';

function event(noOps: DirectiveNoOp[]): SplunkEvent {
  return {
    _raw: 'raw',
    _time: null,
    _meta: {},
    fields: {},
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: [],
    noOps,
  };
}

const noMatch: DirectiveNoOp = {
  directive: 'EXTRACT-user',
  file: 'props.conf',
  line: 3,
  phase: 'search-time',
  reason: { kind: 'no-match', partialEnd: 10 },
};

const missingStanza: DirectiveNoOp = {
  directive: 'TRANSFORMS-mask → [maskit]',
  file: 'props.conf',
  line: 4,
  phase: 'index-time',
  reason: { kind: 'transforms-stanza-missing', name: 'maskit' },
};

describe('groupNoOps', () => {
  it('collapses the same directive across events into one row', () => {
    const groups = groupNoOps([event([noMatch]), event([noMatch]), event([noMatch])]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.eventsAffected).toBe(3);
  });

  it('keeps distinct reasons for the same directive, commonest first', () => {
    const other: DirectiveNoOp = { ...noMatch, reason: { kind: 'source-key-empty', sourceKey: '_raw' } };
    const groups = groupNoOps([event([noMatch]), event([other]), event([other])]);
    expect(groups[0]?.reasons).toHaveLength(2);
    expect(groups[0]?.reasons[0]?.events).toBe(2);
    expect(groups[0]?.reasons[0]?.text).toContain('_raw is empty');
  });

  it('keeps two directives on the same line apart', () => {
    const sameLine: DirectiveNoOp = { ...missingStanza, line: 3 };
    expect(groupNoOps([event([noMatch, sameLine])])).toHaveLength(2);
  });

  it('returns nothing for events with no no-ops', () => {
    expect(groupNoOps([event([])])).toEqual([]);
  });
});

describe('DirectiveNoOpList', () => {
  it('renders nothing at all when every directive fired', () => {
    // An empty panel heading would be noise on a working config.
    const { container } = render(<DirectiveNoOpList events={[event([])]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the directive and explains it', () => {
    const { container } = render(<DirectiveNoOpList events={[event([noMatch])]} />);
    expect(within(container).getByText('EXTRACT-user')).toBeInTheDocument();
    expect(within(container).getByText(/stopped agreeing at character 10/)).toBeInTheDocument();
  });

  it('says how many events it had no effect on', () => {
    const { container } = render(
      <DirectiveNoOpList events={[event([noMatch]), event([noMatch]), event([])]} />,
    );
    expect(container.textContent).toContain('no effect on 2 of 3 events');
  });

  it('offers a jump to the line it is written on', () => {
    const { container } = render(<DirectiveNoOpList events={[event([noMatch])]} />);
    expect(within(container).getByRole('button', { name: 'props.conf:3' })).toBeInTheDocument();
  });

  it('filters by phase when asked', () => {
    const events = [event([noMatch, missingStanza])];
    const searchTime = render(<DirectiveNoOpList events={events} phase="search-time" />);
    expect(searchTime.container.textContent).toContain('EXTRACT-user');
    expect(searchTime.container.textContent).not.toContain('maskit');

    const indexTime = render(<DirectiveNoOpList events={events} phase="index-time" />);
    expect(indexTime.container.textContent).toContain('maskit');
    expect(indexTime.container.textContent).not.toContain('EXTRACT-user');
  });

  it('hides secondary reasons behind a toggle', () => {
    const other: DirectiveNoOp = { ...noMatch, reason: { kind: 'source-key-empty', sourceKey: '_raw' } };
    const { container } = render(<DirectiveNoOpList events={[event([noMatch]), event([other])]} />);

    expect(container.textContent).not.toContain('_raw is empty');
    fireEvent.click(within(container).getByRole('button', { name: /1 other reason/ }));
    expect(container.textContent).toContain('_raw is empty');
  });
});
