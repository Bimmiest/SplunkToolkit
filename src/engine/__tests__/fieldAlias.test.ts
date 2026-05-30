import { describe, it, expect } from 'vitest';
import { applyFieldAliases } from '../processors/fieldAlias';
import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';

function event(fields: Record<string, string | string[]>): SplunkEvent {
  return {
    _raw: 'raw',
    _time: null,
    _meta: {},
    fields,
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: [],
  };
}

function dir(className: string, value: string): ConfDirective {
  return { key: `FIELDALIAS-${className}`, value, line: 1, directiveType: 'FIELDALIAS', className };
}

describe('applyFieldAliases — literal', () => {
  it('creates an alias and keeps the original field', () => {
    const [e] = applyFieldAliases([event({ ip: '10.0.0.1' })], [dir('a', 'ip AS ipaddress')]);
    expect(e.fields['ipaddress']).toBe('10.0.0.1');
    expect(e.fields['ip']).toBe('10.0.0.1');
  });

  it('ASNEW does not overwrite an existing target', () => {
    const [e] = applyFieldAliases([event({ ip: '10.0.0.1', addr: 'keep' })], [dir('a', 'ip ASNEW addr')]);
    expect(e.fields['addr']).toBe('keep');
  });

  it('does nothing when the source field is absent', () => {
    const [e] = applyFieldAliases([event({ other: 'x' })], [dir('a', 'ip AS ipaddress')]);
    expect(e.fields['ipaddress']).toBeUndefined();
  });
});

describe('applyFieldAliases — wildcards', () => {
  it('maps a single wildcard positionally across matching fields', () => {
    const [e] = applyFieldAliases(
      [event({ src_ip: '10.0.0.1', src_port: '443', other: 'x' })],
      [dir('w', 'src_* AS dest_*')],
    );
    expect(e.fields['dest_ip']).toBe('10.0.0.1');
    expect(e.fields['dest_port']).toBe('443');
    // Originals are kept; non-matching fields are untouched.
    expect(e.fields['src_ip']).toBe('10.0.0.1');
    expect(e.fields['other']).toBe('x');
    expect(e.fields['dest_other']).toBeUndefined();
  });

  it('can reposition the captured text in the target', () => {
    const [e] = applyFieldAliases([event({ error_count: '5' })], [dir('w', '*_count AS count_*')]);
    expect(e.fields['count_error']).toBe('5');
  });

  it('handles multiple wildcards positionally', () => {
    const [e] = applyFieldAliases(
      [event({ start_X_mid_Y: 'v' })],
      [dir('w', 'start_*_mid_* AS s_*_m_*')],
    );
    expect(e.fields['s_X_m_Y']).toBe('v');
  });

  it('emits a diagnostic and skips when wildcard counts do not match', () => {
    const diags: ValidationDiagnostic[] = [];
    const [e] = applyFieldAliases([event({ src_ip: '10.0.0.1' })], [dir('w', 'src_* AS dest')], diags);
    expect(e.fields['dest']).toBeUndefined();
    expect(diags.some((d) => d.message.includes('mismatched wildcards'))).toBe(true);
  });

  it('wildcard ASNEW does not overwrite an existing target', () => {
    const [e] = applyFieldAliases(
      [event({ src_ip: '10.0.0.1', dest_ip: 'keep' })],
      [dir('w', 'src_* ASNEW dest_*')],
    );
    expect(e.fields['dest_ip']).toBe('keep');
  });
});
