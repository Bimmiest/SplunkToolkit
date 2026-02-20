import type { editor } from 'monaco-editor';
import { getDirectiveInfo, getClassBasedDirectiveBase } from './directiveRegistry';
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

  for (let i = 1; i <= lineCount; i++) {
    const line = model.getLineContent(i);
    const trimmed = line.trim();

    // Skip comments and blank lines
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

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
          message: `Duplicate stanza "${stanzaName}" — later definition will override earlier one`,
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
      // Check if regex has a capturing group
      if (!value.includes('(')) {
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
