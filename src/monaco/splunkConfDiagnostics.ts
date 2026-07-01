import type { editor } from 'monaco-editor';
import { getDirectiveInfo, getClassBasedDirectiveBase } from '../engine/directiveRegistry';
import { validateRegex } from '../utils/splunkRegex';

export interface DiagnosticMarker {
  severity: 8 | 4 | 2 | 1; // Error=8, Warning=4, Info=2, Hint=1
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export function computeDiagnostics(
  model: editor.ITextModel,
  fileType: 'props.conf' | 'transforms.conf'
): DiagnosticMarker[] {
  const markers: DiagnosticMarker[] = [];
  const lineCount = model.getLineCount();
  const seenStanzas = new Set<string>();

  // Splunk continues a directive onto the next line when the line ends with a
  // trailing backslash (NOT when the next line begins with whitespace). Only a
  // line that is actually a DIRECTIVE (or an ongoing continuation of one) can
  // start a continuation — a stanza header or a malformed line ending in `\`
  // must not. This mirrors confParser's `lastDirective` gating; without it the
  // line after any backslash-terminated header/garbage line was silently skipped.
  let inDirectiveValue = false;

  for (let i = 1; i <= lineCount; i++) {
    const line = model.getLineContent(i);
    const trimmed = line.trim();
    const endsWithBackslash = line.trimEnd().endsWith('\\');

    if (inDirectiveValue && trimmed !== '') {
      // Part of the previous directive's value — skip it. It continues the
      // value further only if it too ends with a trailing backslash.
      inDirectiveValue = endsWithBackslash;
      continue;
    }

    // Not a continuation: reset. Only the directive branch below re-arms it.
    inDirectiveValue = false;

    // Skip comments and blank lines. Splunk .conf uses `#` only — `;` is NOT a comment.
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Stanza headers
    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) {
        markers.push({
          severity: 8,
          message: 'Missing closing bracket "]" for stanza header',
          startLineNumber: i,
          startColumn: 1,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
        continue;
      }

      const stanzaName = trimmed.slice(1, -1).trim();
      if (seenStanzas.has(stanzaName)) {
        markers.push({
          severity: 4,
          message: `Duplicate stanza "${stanzaName}" — Splunk merges duplicate stanzas key-by-key (a later key overrides the same earlier key; keys only in the earlier stanza are kept)`,
          startLineNumber: i,
          startColumn: 1,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
      }
      seenStanzas.add(stanzaName);
      continue;
    }

    // Directives
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) {
      // Not a continuation line (doesn't start with whitespace)
      if (!line.startsWith(' ') && !line.startsWith('\t')) {
        markers.push({
          severity: 4,
          message: `Unrecognized line format — expected "key = value" or stanza header`,
          startLineNumber: i,
          startColumn: 1,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
      }
      continue;
    }

    // This line is a directive — a trailing backslash now legitimately starts a
    // continuation onto the next line.
    inDirectiveValue = endsWithBackslash;

    const key = line.substring(0, eqIdx).trim();
    const value = line.substring(eqIdx + 1).trim();

    // Check if directive is known
    let info = getDirectiveInfo(key, fileType);
    let baseKey = key;

    if (!info) {
      const parsed = getClassBasedDirectiveBase(key);
      if (parsed) {
        info = getDirectiveInfo(parsed.base, fileType);
        baseKey = parsed.base;
      }
    }

    if (!info) {
      markers.push({
        severity: 2, // Info
        message: `Unknown directive "${key}" — possible typo?`,
        startLineNumber: i,
        startColumn: 1,
        endLineNumber: i,
        endColumn: eqIdx + 1,
      });
      continue;
    }

    // Validate value types
    if (info.valueType === 'regex' && value) {
      const error = validateRegex(value);
      if (error) {
        markers.push({
          severity: 8,
          message: `Invalid regex pattern: ${error}`,
          startLineNumber: i,
          startColumn: eqIdx + 2,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
      }
    }

    if (info.valueType === 'boolean' && value) {
      if (!['true', 'false', '0', '1', 'yes', 'no'].includes(value.toLowerCase())) {
        markers.push({
          severity: 4,
          message: `Expected boolean value (true/false) for "${baseKey}", got "${value}"`,
          startLineNumber: i,
          startColumn: eqIdx + 2,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
      }
    }

    if (info.valueType === 'number' && value) {
      if (isNaN(Number(value))) {
        markers.push({
          severity: 4,
          message: `Expected numeric value for "${baseKey}", got "${value}"`,
          startLineNumber: i,
          startColumn: eqIdx + 2,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
      }
    }

    if (info.valueType === 'enum' && value && info.enumValues) {
      if (!info.enumValues.includes(value.toLowerCase()) && !info.enumValues.includes(value)) {
        markers.push({
          severity: 4,
          message: `Invalid value "${value}" for "${baseKey}". Valid values: ${info.enumValues.join(', ')}`,
          startLineNumber: i,
          startColumn: eqIdx + 2,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
      }
    }

    // Best practice warnings
    if (baseKey === 'LINE_BREAKER' && value) {
      // Check for a real CAPTURING group — not an escaped `\(` literal and not a
      // non-capturing `(?:…)` / lookaround `(?=…)` group.
      if (!hasCapturingGroup(value)) {
        markers.push({
          severity: 4,
          message: 'LINE_BREAKER regex should contain at least one capturing group () — the captured content defines the break point',
          startLineNumber: i,
          startColumn: eqIdx + 2,
          endLineNumber: i,
          endColumn: line.length + 1,
        });
      }
    }

    if (info.deprecated) {
      markers.push({
        severity: 2,
        message: `"${baseKey}" is deprecated — consider using the recommended alternative`,
        startLineNumber: i,
        startColumn: 1,
        endLineNumber: i,
        endColumn: eqIdx + 1,
      });
    }
  }

  // Cross-stanza best practice checks
  checkBestPractices(model, markers, fileType);

  return markers;
}

/**
 * Returns true if the regex contains at least one *capturing* group. Ignores
 * escaped literal parens (`\(`) and non-capturing / lookaround groups (`(?...`),
 * which a naive `includes('(')` check would wrongly accept.
 */
function hasCapturingGroup(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      i++; // skip the escaped character
      continue;
    }
    if (c === '(' && pattern[i + 1] !== '?') return true;
  }
  return false;
}

function checkBestPractices(
  model: editor.ITextModel,
  markers: DiagnosticMarker[],
  _fileType: 'props.conf' | 'transforms.conf'
): void {
  const text = model.getValue();
  const hasLineBreaker = /^LINE_BREAKER\s*=/m.test(text);
  const hasShouldLinemerge = /^SHOULD_LINEMERGE\s*=/m.test(text);
  const hasTimeFormat = /^TIME_FORMAT\s*=/m.test(text);
  const hasTimePrefix = /^TIME_PREFIX\s*=/m.test(text);

  // Warn if LINE_BREAKER is set without explicitly setting SHOULD_LINEMERGE = false
  if (hasLineBreaker && !hasShouldLinemerge) {
    const lineIdx = text.split('\n').findIndex((l) => /^LINE_BREAKER\s*=/.test(l));
    if (lineIdx >= 0) {
      markers.push({
        severity: 4,
        message: 'Best practice: Set SHOULD_LINEMERGE = false when using a custom LINE_BREAKER',
        startLineNumber: lineIdx + 1,
        startColumn: 1,
        endLineNumber: lineIdx + 1,
        endColumn: 1,
      });
    }
  }

  // Warn if TIME_PREFIX is set without TIME_FORMAT
  if (hasTimePrefix && !hasTimeFormat) {
    const lineIdx = text.split('\n').findIndex((l) => /^TIME_PREFIX\s*=/.test(l));
    if (lineIdx >= 0) {
      markers.push({
        severity: 4,
        message: 'Best practice: Set TIME_FORMAT when using TIME_PREFIX for reliable timestamp extraction',
        startLineNumber: lineIdx + 1,
        startColumn: 1,
        endLineNumber: lineIdx + 1,
        endColumn: 1,
      });
    }
  }
}
