import { describe, it, expect } from 'vitest';
import { computeDiagnostics } from '../splunkConfDiagnostics';
import type { editor } from 'monaco-editor';

// Minimal ITextModel stand-in — computeDiagnostics only reads line count / content / value.
function fakeModel(text: string): editor.ITextModel {
  const lines = text.split('\n');
  return {
    getLineCount: () => lines.length,
    getLineContent: (n: number) => lines[n - 1] ?? '',
    getValue: () => text,
  } as unknown as editor.ITextModel;
}

describe('computeDiagnostics — continuation gating (#24)', () => {
  it('validates the line after a backslash-terminated stanza header', () => {
    const text = '[my_stanza] \\\nREGEX = (unbalanced';
    const markers = computeDiagnostics(fakeModel(text), 'transforms.conf');
    // The invalid regex on line 2 must be reported — a stanza header cannot have
    // a continuation, so line 2 must not be swallowed as one.
    expect(markers.some((m) => m.startLineNumber === 2 && /Invalid regex/.test(m.message))).toBe(true);
  });

  it('validates a directive after a backslash-terminated malformed line', () => {
    const text = 'garbage line \\\nREGEX = (unbalanced';
    const markers = computeDiagnostics(fakeModel(text), 'transforms.conf');
    expect(markers.some((m) => m.startLineNumber === 2 && /Invalid regex/.test(m.message))).toBe(true);
  });

  it('still treats a real directive continuation as value, not a malformed line', () => {
    const text = 'TIME_FORMAT = %Y \\\n%m %d';
    const markers = computeDiagnostics(fakeModel(text), 'props.conf');
    // Line 2 is part of TIME_FORMAT's value — it must not be flagged.
    expect(markers.some((m) => m.startLineNumber === 2)).toBe(false);
  });
});
