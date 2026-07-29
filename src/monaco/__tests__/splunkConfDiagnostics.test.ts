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

describe('computeDiagnostics — continued values are validated as a whole (#70.1)', () => {
  it('does not report a regex error on a valid backslash-continued LINE_BREAKER', () => {
    const text = '[st]\nLINE_BREAKER = ([\\r\\n]+)(?=\\d{4}-\\\n\\d{2})';
    const markers = computeDiagnostics(fakeModel(text), 'props.conf');
    expect(markers.filter((m) => /Invalid regex/.test(m.message))).toHaveLength(0);
  });

  it('still reports a regex error that survives the join', () => {
    const text = '[st]\nLINE_BREAKER = ([\\r\\n]+)(?=\\d{4}-\\\n\\d{2}';
    const markers = computeDiagnostics(fakeModel(text), 'props.conf');
    expect(markers.some((m) => /Invalid regex/.test(m.message))).toBe(true);
  });

  it('treats an even backslash run as a literal, not a continuation', () => {
    // `C:\\` is a Windows path ending in one escaped backslash, not a continuation.
    const text = '[st]\nEXTRACT-p = path=(?<path>C:\\\\)\n';
    const markers = computeDiagnostics(fakeModel(text), 'props.conf');
    expect(markers.filter((m) => /Invalid regex/.test(m.message))).toHaveLength(0);
  });
});

describe('computeDiagnostics — named groups count as capturing (#70.2)', () => {
  it('does not warn for a named LINE_BREAKER group', () => {
    const markers = computeDiagnostics(fakeModel('[st]\nLINE_BREAKER = (?<br>[\\r\\n]+)'), 'props.conf');
    expect(markers.some((m) => /at least one capturing group/.test(m.message))).toBe(false);
  });

  it('does not warn for a Python-style named group', () => {
    const markers = computeDiagnostics(fakeModel('[st]\nLINE_BREAKER = (?P<br>[\\r\\n]+)'), 'props.conf');
    expect(markers.some((m) => /at least one capturing group/.test(m.message))).toBe(false);
  });

  it('still warns when the only group is a lookbehind', () => {
    const markers = computeDiagnostics(fakeModel('[st]\nLINE_BREAKER = (?<=x)[\\r\\n]+'), 'props.conf');
    expect(markers.some((m) => /at least one capturing group/.test(m.message))).toBe(true);
  });

  it('still warns when the only group is non-capturing', () => {
    const markers = computeDiagnostics(fakeModel('[st]\nLINE_BREAKER = (?:[\\r\\n]+)'), 'props.conf');
    expect(markers.some((m) => /at least one capturing group/.test(m.message))).toBe(true);
  });
});

describe('computeDiagnostics — SHOULD_LINEMERGE best practice inspects the value (#31.2)', () => {
  const withBreaker = (linemerge: string) =>
    computeDiagnostics(fakeModel(`[st]\nLINE_BREAKER = ([\\r\\n]+)\n${linemerge}`), 'props.conf');

  const warned = (markers: { message: string }[]) =>
    markers.some((m) => /SHOULD_LINEMERGE = false/.test(m.message));

  it('warns when SHOULD_LINEMERGE is set to true', () => {
    expect(warned(withBreaker('SHOULD_LINEMERGE = true'))).toBe(true);
  });

  it('stays quiet when it is set to false', () => {
    expect(warned(withBreaker('SHOULD_LINEMERGE = false'))).toBe(false);
  });

  it('accepts 0 and no as false', () => {
    expect(warned(withBreaker('SHOULD_LINEMERGE = 0'))).toBe(false);
    expect(warned(withBreaker('SHOULD_LINEMERGE = no'))).toBe(false);
  });

  it('still warns when it is absent entirely', () => {
    expect(warned(computeDiagnostics(fakeModel('[st]\nLINE_BREAKER = ([\\r\\n]+)'), 'props.conf'))).toBe(true);
  });
});
