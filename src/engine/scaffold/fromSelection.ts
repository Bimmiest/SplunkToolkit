import { escapeRegex } from '../../utils/splunkRegex';
import { derivePrefix } from './analyzers/timestamp';

export interface GeneratedDirective {
  key: string;
  value: string;
}

/**
 * Turn a literal selection into a regex fragment ("regex by example"): all-digits
 * → \d+, dotted-quad IP → an IP pattern, UUID-ish → hex/dash, a single word → \w+,
 * otherwise a non-space run. Conservative on purpose — the user edits from here.
 */
export function generalize(text: string): string {
  if (/^\d+$/.test(text)) return '\\d+';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return '\\d+\\.\\d+\\.\\d+\\.\\d+';
  if (/-/.test(text) && /^[0-9a-fA-F-]{8,}$/.test(text)) return '[0-9a-fA-F-]+';
  if (/^\w+$/.test(text)) return '\\w+';
  return '\\S+';
}

/**
 * Build an `EXTRACT-<field>` directive that captures `selectedText` within `raw`,
 * anchored on the stable literal that precedes it (a key/delimiter boundary, via
 * derivePrefix) so the regex isn't position-dependent. Returns null for empty input.
 */
export function buildExtractFromSelection(
  raw: string,
  selectedText: string,
  fieldName: string,
): GeneratedDirective | null {
  if (!selectedText) return null;
  const name = fieldName.trim() || 'field';
  const idx = raw.indexOf(selectedText);
  const before = idx > 0 ? raw.slice(0, idx) : '';
  const prefixLiteral = before ? derivePrefix(before) : '';
  const prefix = prefixLiteral ? escapeRegex(prefixLiteral) : '';
  return { key: `EXTRACT-${name}`, value: `${prefix}(?<${name}>${generalize(selectedText)})` };
}

/**
 * Derive a TIME_PREFIX (escaped) from the stable literal immediately preceding the
 * selected timestamp. Returns null when there is no usable preceding boundary.
 */
export function timePrefixFromSelection(raw: string, selectedText: string): string | null {
  const idx = raw.indexOf(selectedText);
  if (idx <= 0) return null;
  const literal = derivePrefix(raw.slice(0, idx));
  return literal ? escapeRegex(literal) : null;
}
