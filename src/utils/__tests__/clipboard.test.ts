// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyToClipboard } from '../clipboard';

// jsdom does not implement document.execCommand, so assign a stub directly.
function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockReturnValue(result);
  (document as unknown as { execCommand: unknown }).execCommand = fn;
  return fn;
}

describe('copyToClipboard — fallback failure (#30.4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  // Force the async Clipboard API to reject so the execCommand fallback runs.
  function forceFallback() {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('unavailable')) },
    });
  }

  it('rejects when execCommand reports failure (no false "copied")', async () => {
    forceFallback();
    const exec = stubExecCommand(false);
    await expect(copyToClipboard('hi')).rejects.toThrow(/failed/i);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('resolves when execCommand reports success', async () => {
    forceFallback();
    stubExecCommand(true);
    await expect(copyToClipboard('hi')).resolves.toBeUndefined();
  });
});
