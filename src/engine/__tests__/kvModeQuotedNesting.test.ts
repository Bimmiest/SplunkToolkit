import { describe, it, expect } from 'vitest';
import { applyKvMode } from '../processors/kvMode';
import type { ConfDirective, SplunkEvent } from '../types';

const ev = (raw: string): SplunkEvent => ({
  _raw: raw, _time: null, _meta: {}, fields: {},
  metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
  lineNumbers: { start: 1, end: 1 }, processingTrace: [],
});
const kv = (mode: string): ConfDirective[] =>
  [{ key: 'KV_MODE', value: mode, line: 1, directiveType: 'KV_MODE' }];

// #123: the double-quoted pass blanks its spans out of a working copy so the
// bare pass cannot mine inside a quoted value — but the single-quoted pass was
// still scanning the untouched original, so it never saw the blanking.
describe('KV_MODE auto — quoted passes do not mine inside each other (#123)', () => {
  it('does not extract a single-quoted pair from inside a double-quoted value', () => {
    const [r] = applyKvMode([ev(`msg="an x='inner' thing" a=1`)], kv('auto'));
    expect(r.fields.msg).toBe("an x='inner' thing");
    expect(r.fields.a).toBe('1');
    expect(r.fields).not.toHaveProperty('x');
  });

  it('does not extract a double-quoted pair from inside a single-quoted value', () => {
    const [r] = applyKvMode([ev(`msg='an x="inner" thing' a=1`)], kv('auto'));
    expect(r.fields.msg).toBe('an x="inner" thing');
    expect(r.fields.a).toBe('1');
    expect(r.fields).not.toHaveProperty('x');
  });

  it('still extracts genuine single-quoted pairs outside any quoted value', () => {
    const [r] = applyKvMode([ev(`user='alice' role="admin" id=7`)], kv('auto'));
    expect(r.fields.user).toBe('alice');
    expect(r.fields.role).toBe('admin');
    expect(r.fields.id).toBe('7');
  });

  it('still keeps the bare pass out of quoted values', () => {
    const [r] = applyKvMode([ev(`msg="error code=42" status=ok`)], kv('auto'));
    expect(r.fields.msg).toBe('error code=42');
    expect(r.fields.status).toBe('ok');
    expect(r.fields).not.toHaveProperty('code');
  });

  it('auto_escaped still unescapes and still blocks nested mining', () => {
    const [r] = applyKvMode([ev(`msg="say \\"hi\\" x='inner'" a=1`)], kv('auto_escaped'));
    expect(r.fields.msg).toBe(`say "hi" x='inner'`);
    expect(r.fields.a).toBe('1');
    expect(r.fields).not.toHaveProperty('x');
  });
});
