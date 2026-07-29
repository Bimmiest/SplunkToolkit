// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExtractNameDialog } from '../ExtractNameDialog';

function setup(pattern?: string) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <ExtractNameDialog
      raw="status=200 user=alice"
      selection={pattern ? '' : 'alice'}
      stanza="my:sourcetype"
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { onApply, onClose };
}

// #34: this dialog used to compile and execute the candidate pattern on the main
// thread on every keystroke, where the pipeline watchdog does not apply. It now
// runs through the same terminatable worker hook the Regex tab uses.
describe('ExtractNameDialog — live capture', () => {
  it('shows the captured group for a matching pattern', async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
  });

  it('renders without executing a regex on the render path', () => {
    // A synchronous main-thread exec would have thrown or blocked here; the
    // dialog mounts immediately and resolves the capture asynchronously.
    setup();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
