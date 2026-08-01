// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { DictionaryView } from '../DictionaryView';
import { useAppStore } from '../../../store/useAppStore';

function renderDictionary() {
  return render(
    <RadixTooltip.Provider>
      <DictionaryView />
    </RadixTooltip.Provider>,
  );
}

const initial = useAppStore.getState();

describe('DictionaryView', () => {
  beforeEach(() => {
    useAppStore.setState(initial, true);
  });

  it('shows a detail pane without waiting for a selection', () => {
    renderDictionary();
    // Falls back to the first visible entry, which is a stanza header.
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders the entry the store points at', () => {
    useAppStore.setState({ dictionarySelection: 'TIME_FORMAT' });
    renderDictionary();
    expect(screen.getByRole('heading', { level: 2, name: 'TIME_FORMAT' })).toBeInTheDocument();
  });

  it('resolves a deep link to a key that exists once per conf file', () => {
    useAppStore.setState({ dictionarySelection: 'MATCH_LIMIT' });
    renderDictionary();
    expect(screen.getByRole('heading', { level: 2, name: 'MATCH_LIMIT' })).toBeInTheDocument();
  });

  it('shows the phase badge for the selected directive', () => {
    useAppStore.setState({ dictionarySelection: 'TIME_FORMAT' });
    renderDictionary();
    // TIME_FORMAT is index-time only.
    expect(screen.getAllByText('Index-time').length).toBeGreaterThan(0);
  });

  it('selects an entry when its row is clicked', () => {
    renderDictionary();
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByText('TRUNCATE'));
    expect(useAppStore.getState().dictionarySelection).toBe('TRUNCATE');
    expect(screen.getByRole('heading', { level: 2, name: 'TRUNCATE' })).toBeInTheDocument();
  });

  it('narrows the list as you search', () => {
    renderDictionary();
    const listbox = screen.getByRole('listbox');
    const before = within(listbox).getAllByRole('option').length;

    fireEvent.change(screen.getByLabelText('Search directives'), {
      target: { value: 'TIME_' },
    });

    const after = within(screen.getByRole('listbox')).getAllByRole('option').length;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
  });

  it('reports how many entries a filter left', () => {
    renderDictionary();
    fireEvent.change(screen.getByLabelText('Search directives'), {
      target: { value: 'TIME_PREFIX' },
    });
    expect(screen.getByRole('status')).toHaveTextContent(/of \d+ entries/);
  });

  it('says so when nothing matches, instead of showing an empty list', () => {
    renderDictionary();
    fireEvent.change(screen.getByLabelText('Search directives'), {
      target: { value: 'zzzznotathing' },
    });
    expect(screen.getByText('No directives match these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps the selected entry rendered when a filter would exclude it', () => {
    useAppStore.setState({ dictionarySelection: 'TIME_FORMAT' });
    renderDictionary();
    fireEvent.click(screen.getByRole('button', { name: 'transforms' }));
    // TIME_FORMAT is props-only, so it leaves the list — but the pane the user
    // is reading must not blank out from under them.
    expect(screen.getByRole('heading', { level: 2, name: 'TIME_FORMAT' })).toBeInTheDocument();
  });

  it('walks the list with the arrow keys', () => {
    renderDictionary();
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    const firstId = options[0]?.getAttribute('data-entry-id');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });

    expect(useAppStore.getState().dictionarySelection).not.toBe(firstId);
    expect(useAppStore.getState().dictionarySelection).toBe(
      options[1]?.getAttribute('data-entry-id'),
    );
  });

  it('points aria-activedescendant at the selected row', () => {
    useAppStore.setState({ dictionarySelection: 'TRUNCATE' });
    renderDictionary();
    const listbox = screen.getByRole('listbox');
    const active = listbox.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)).toHaveAttribute('data-entry-id', 'TRUNCATE');
  });

  it('documents stanza headers alongside directives', () => {
    useAppStore.setState({ dictionarySelection: 'stanza:source' });
    renderDictionary();
    expect(screen.getByRole('heading', { level: 2, name: '[source::<pattern>]' })).toBeInTheDocument();
    expect(screen.getByText(/Highest/)).toBeInTheDocument();
  });
});
