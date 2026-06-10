import { describe, it, expect } from 'vitest';
import { applySedCommands } from '../processors/sedCmd';
import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';

function event(raw: string): SplunkEvent {
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

function sedDir(className: string, value: string): ConfDirective {
  return { key: `SEDCMD-${className}`, value, line: 1, directiveType: 'SEDCMD', className };
}

describe('applySedCommands', () => {
  it('performs a basic substitution', () => {
    const [e] = applySedCommands([event('hello world')], [sedDir('x', 's/world/there/')]);
    expect(e._raw).toBe('hello there');
  });

  it('honours the global flag', () => {
    const [e] = applySedCommands([event('a a a')], [sedDir('x', 's/a/b/g')]);
    expect(e._raw).toBe('b b b');
  });

  it('uses sed backreferences (\\1) in the replacement', () => {
    const [e] = applySedCommands([event('id=42')], [sedDir('x', 's/id=(\\d+)/user-\\1/')]);
    expect(e._raw).toBe('user-42');
  });

  // BUG-2: a literal `$` in the replacement is a substitution pattern in JS and
  // used to mangle the output (e.g. $5 became part of capture-ref handling).
  it('treats a literal $ in the replacement as literal', () => {
    const [e] = applySedCommands([event('price')], [sedDir('x', 's/price/$5.00/')]);
    expect(e._raw).toBe('$5.00');
  });

  it('applies multiple SEDCMD classes in ASCII order', () => {
    // class "a" runs before class "b": a turns X→Y, then b turns Y→Z.
    const [e] = applySedCommands([event('X')], [sedDir('b', 's/Y/Z/'), sedDir('a', 's/X/Y/')]);
    expect(e._raw).toBe('Z');
  });

  // SEM-14: unsupported sed features warn rather than silently no-op.
  it('warns that y/// transliteration is not simulated', () => {
    const diags: ValidationDiagnostic[] = [];
    const [e] = applySedCommands([event('abc')], [sedDir('x', 'y/abc/xyz/')], diags);
    expect(e._raw).toBe('abc'); // unchanged — not applied
    expect(diags.some((d) => d.message.includes('y/// transliteration'))).toBe(true);
  });

  it('warns that the numeric occurrence flag (s/.../.../N) is not simulated', () => {
    const diags: ValidationDiagnostic[] = [];
    applySedCommands([event('a a a')], [sedDir('x', 's/a/b/2')], diags);
    expect(diags.some((d) => d.message.includes('numeric occurrence flag'))).toBe(true);
  });
});
