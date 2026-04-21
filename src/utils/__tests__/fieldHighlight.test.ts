import { describe, it, expect } from 'vitest';
import { findFieldValuePositions } from '../fieldHighlight';

describe('findFieldValuePositions — basic context matching', () => {
  it('matches JSON string value via context pattern', () => {
    const raw = '{"user":"alice","status":"active"}';
    const pos = findFieldValuePositions(raw, 'user', 'alice');
    expect(pos).toHaveLength(1);
    expect(raw.substring(pos[0], pos[0] + 5)).toBe('alice');
  });

  it('matches JSON numeric value via context pattern', () => {
    const raw = '{"pid":1234,"ppid":5678}';
    const pos = findFieldValuePositions(raw, 'pid', '1234');
    expect(pos).toHaveLength(1);
    expect(raw.substring(pos[0], pos[0] + 4)).toBe('1234');
  });

  it('matches key=value via context pattern', () => {
    const raw = 'uid=1000 gid=100 euid=1000';
    const pos = findFieldValuePositions(raw, 'uid', '1000');
    // Should only match the uid=1000 occurrence, not euid=1000
    expect(pos).toHaveLength(1);
  });

  it('falls back to plain indexOf (first occurrence only) for uncontextualised values (length >= 2)', () => {
    const raw = 'some event containing foobar twice: foobar';
    const pos = findFieldValuePositions(raw, 'myfield', 'foobar');
    // Returns only the first occurrence to prevent double-highlighting coincidental matches.
    expect(pos).toHaveLength(1);
    expect(pos[0]).toBe(raw.indexOf('foobar'));
  });

  it('fallback skips values shorter than 2 chars to avoid false-positive noise', () => {
    const raw = 'a=0 b=0 c=1';
    // "0" is too short for fallback and no context match for field "x"
    const pos = findFieldValuePositions(raw, 'x', '0');
    expect(pos).toHaveLength(0);
  });
});

describe('findFieldValuePositions — underscore-stripped JSON keys (originalKey param)', () => {
  const raw = '{"_UID":"1000","_GID":"100","_EGID":"100","_FSGID":"100"}';

  it('matches _GID via originalKey instead of falling back to indexOf', () => {
    const pos = findFieldValuePositions(raw, 'GID', '100', '_GID');
    expect(pos).toHaveLength(1);
    // Should point into `"_GID":"100"`, not into _EGID or _FSGID
    const match = raw.substring(pos[0], pos[0] + 3);
    expect(match).toBe('100');
    // Verify the preceding context is "_GID":"
    const context = raw.substring(0, pos[0]);
    expect(context.endsWith('"_GID":"')).toBe(true);
  });

  it('does not claim _EGID or _FSGID positions for field GID', () => {
    const pos = findFieldValuePositions(raw, 'GID', '100', '_GID');
    // Only one position — the _GID one
    expect(pos).toHaveLength(1);
  });

  it('matches _EGID via its own originalKey', () => {
    const pos = findFieldValuePositions(raw, 'EGID', '100', '_EGID');
    expect(pos).toHaveLength(1);
    const context = raw.substring(0, pos[0]);
    expect(context.endsWith('"_EGID":"')).toBe(true);
  });

  it('matches single-char value with originalKey context', () => {
    const raw2 = '{"_AUDIT_SESSION":"3","_AUDIT_FIELD_EXIT":"0"}';
    const pos = findFieldValuePositions(raw2, 'AUDIT_SESSION', '3', '_AUDIT_SESSION');
    expect(pos).toHaveLength(1);
    expect(raw2.substring(pos[0], pos[0] + 1)).toBe('3');
  });

  it('does not highlight single-char value without context match', () => {
    const raw2 = '{"_AUDIT_SESSION":"3"}';
    // No originalKey — context pattern uses "AUDIT_SESSION" which won't match "_AUDIT_SESSION"
    const pos = findFieldValuePositions(raw2, 'AUDIT_SESSION', '3');
    expect(pos).toHaveLength(0);
  });
});

describe('findFieldValuePositions — collision prevention', () => {
  it('fields sharing a value do not steal each other\'s positions when originalKey provided', () => {
    const raw = '{"_UID":"1000","_FSUID":"1000","_EUID":"1000"}';
    const uidPos = findFieldValuePositions(raw, 'UID', '1000', '_UID');
    const fsuidPos = findFieldValuePositions(raw, 'FSUID', '1000', '_FSUID');
    const euidPos = findFieldValuePositions(raw, 'EUID', '1000', '_EUID');

    // Each field should find exactly one position, and they must be distinct
    expect(uidPos).toHaveLength(1);
    expect(fsuidPos).toHaveLength(1);
    expect(euidPos).toHaveLength(1);
    const positions = new Set([uidPos[0], fsuidPos[0], euidPos[0]]);
    expect(positions.size).toBe(3);
  });
});
