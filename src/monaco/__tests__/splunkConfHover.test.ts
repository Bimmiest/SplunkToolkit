import { describe, it, expect } from 'vitest';
import { createHoverProvider } from '../splunkConfHover';
import type { editor, Position, languages } from 'monaco-editor';

function fakeModel(text: string): editor.ITextModel {
  const lines = text.split('\n');
  return {
    getLineCount: () => lines.length,
    getLineContent: (n: number) => lines[n - 1] ?? '',
    getValue: () => text,
    getWordAtPosition: () => null,
  } as unknown as editor.ITextModel;
}

const at = (lineNumber: number, column: number) => ({ lineNumber, column }) as Position;

function hoverText(line: string): string {
  const provider = createHoverProvider('props.conf');
  const result = provider.provideHover(
    fakeModel(line),
    at(1, 2),
    {} as never,
    undefined as never,
  ) as languages.Hover | null | undefined;
  return result?.contents?.map((c) => c.value).join('\n') ?? '';
}

// #31.1: hover matched `/^\[(.+)\]$/` against the RAW line, so `[foo] ` (with a
// trailing space) got no hover at all — stricter than confParser's STANZA_RE,
// which tolerates surrounding whitespace.
describe('splunkConfHover — stanza headers with surrounding whitespace (#31.1)', () => {
  it('hovers a stanza header with a trailing space', () => {
    expect(hoverText('[my:sourcetype] ')).not.toBe('');
  });

  it('hovers a stanza header with a leading space', () => {
    expect(hoverText('  [source::/var/log/app.log]')).not.toBe('');
  });

  it('still hovers a plain stanza header', () => {
    expect(hoverText('[my:sourcetype]')).not.toBe('');
  });
});
