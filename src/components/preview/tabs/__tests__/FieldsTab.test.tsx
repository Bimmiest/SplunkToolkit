// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { FieldsTab } from '../FieldsTab';
import { useAppStore } from '../../../../store/useAppStore';
import type { ProcessingResult, SplunkEvent, ProcessingStep } from '../../../../engine/types';

function makeEvent(
  fields: Record<string, string>,
  traces: ProcessingStep[],
): SplunkEvent {
  return {
    _raw: '',
    _time: null,
    _meta: {},
    fields,
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: traces,
  };
}

// An event with fields from both index-time and search-time phases.
const event = makeEvent(
  { idx_field: 'a', ext_field: 'b', evaled: '1' },
  [
    { processor: 'INDEXED_EXTRACTIONS', phase: 'index-time', description: '', fieldsAdded: ['idx_field'] },
    { processor: 'EXTRACT-foo', phase: 'search-time', description: '', fieldsAdded: ['ext_field'] },
    { processor: 'EVAL', phase: 'search-time', description: '', fieldsAdded: ['evaled'] },
  ],
);

const result: ProcessingResult = {
  events: [event],
  originalRaw: '',
  eventCount: 1,
  processingSteps: [],
};

const initial = useAppStore.getState();

describe('FieldsTab', () => {
  beforeEach(() => {
    useAppStore.setState(initial, true);
    useAppStore.setState({ processingResult: result });
  });

  it('renders all fields when phase filter is "All"', () => {
    const { container } = render(<FieldsTab />);
    expect(within(container).getByText('idx_field')).toBeInTheDocument();
    expect(within(container).getByText('ext_field')).toBeInTheDocument();
    expect(within(container).getByText('evaled')).toBeInTheDocument();
    expect(within(container).getByText('3 fields')).toBeInTheDocument();
  });

  it('filters to index-time only when Index-time pill is clicked', () => {
    const { container } = render(<FieldsTab />);
    fireEvent.click(within(container).getByRole('button', { name: 'Index-time' }));
    expect(within(container).getByText('idx_field')).toBeInTheDocument();
    expect(within(container).queryByText('ext_field')).not.toBeInTheDocument();
    expect(within(container).queryByText('evaled')).not.toBeInTheDocument();
    expect(within(container).getByText('1 fields')).toBeInTheDocument();
  });

  it('filters to search-time only when Search-time pill is clicked', () => {
    const { container } = render(<FieldsTab />);
    fireEvent.click(within(container).getByRole('button', { name: 'Search-time' }));
    expect(within(container).queryByText('idx_field')).not.toBeInTheDocument();
    expect(within(container).getByText('ext_field')).toBeInTheDocument();
    expect(within(container).getByText('evaled')).toBeInTheDocument();
    expect(within(container).getByText('2 fields')).toBeInTheDocument();
  });

  it('filters by name when searching', () => {
    const { container } = render(<FieldsTab />);
    const search = within(container).getByPlaceholderText('Search fields...');
    fireEvent.change(search, { target: { value: 'ext' } });
    expect(within(container).getByText('ext_field')).toBeInTheDocument();
    expect(within(container).queryByText('idx_field')).not.toBeInTheDocument();
  });
});
