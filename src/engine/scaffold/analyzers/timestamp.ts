import { AUTO_TIME_FORMATS } from '../../processors/timestampExtractor';
import { strftimeToRegex } from '../../../utils/strftime';
import { escapeRegex } from '../../../utils/splunkRegex';
import type { Confidence, ScaffoldSuggestion } from '../types';

// Reuse the engine's priority-ordered recognition table (single source of truth).
const PATTERNS = AUTO_TIME_FORMATS.map((fmt) => ({ fmt, regex: strftimeToRegex(fmt) }));

const SAMPLE_SIZE = 20;

export function detectTimestamp(lines: string[]): ScaffoldSuggestion[] {
  const sample = lines.filter((l) => l.trim().length > 0).slice(0, SAMPLE_SIZE);
  if (sample.length === 0) return [];

  // Leading epoch (10s / 13ms) → TIME_FORMAT = %s.
  const epochLines = sample.filter((l) => /^\s*\d{10}(\d{3})?(?!\d)/.test(l)).length;
  if (epochLines / sample.length >= 0.8) {
    const conf: Confidence = epochLines === sample.length ? 'high' : 'medium';
    return [{ key: 'TIME_FORMAT', value: '%s', confidence: conf, evidence: `${epochLines}/${sample.length} lines start with an epoch timestamp`, enabledByDefault: true }];
  }

  // Tally the highest-priority format that matches each line.
  const tally = new Map<string, { count: number; match: RegExpExecArray; line: string }>();
  for (const line of sample) {
    for (const { fmt, regex } of PATTERNS) {
      const m = regex.exec(line);
      if (!m) continue;
      const e = tally.get(fmt);
      if (e) e.count++;
      else tally.set(fmt, { count: 1, match: m, line });
      break;
    }
  }
  if (tally.size === 0) return [];

  let bestFmt = '';
  let best: { count: number; match: RegExpExecArray; line: string } | null = null;
  for (const [fmt, e] of tally) {
    if (!best || e.count > best.count) {
      bestFmt = fmt;
      best = e;
    }
  }
  if (!best) return [];

  const ratio = best.count / sample.length;
  const confidence: Confidence = ratio >= 0.9 ? 'high' : ratio >= 0.5 ? 'medium' : 'low';
  const out: ScaffoldSuggestion[] = [
    { key: 'TIME_FORMAT', value: bestFmt, confidence, evidence: `Matched in ${best.count}/${sample.length} sample lines`, enabledByDefault: true },
  ];

  const matchEnd = best.match.index + best.match[0].length;
  const prefix = derivePrefix(best.line.slice(0, best.match.index));

  if (prefix) {
    // A stable key/delimiter boundary right before the timestamp. Splunk searches
    // for the timestamp immediately after it, so no large lookahead is needed.
    out.push({
      key: 'TIME_PREFIX',
      value: escapeRegex(prefix),
      confidence: 'medium',
      evidence: `Timestamp follows the literal "${prefix}"`,
      enabledByDefault: true,
    });
  } else if (matchEnd > 128) {
    // No stable prefix and the timestamp sits past the 128-char default window.
    out.push({
      key: 'MAX_TIMESTAMP_LOOKAHEAD',
      value: String(matchEnd + 10),
      confidence,
      evidence: `Timestamp ends near character ${matchEnd} with no stable prefix`,
      enabledByDefault: true,
    });
  }

  return out;
}

/**
 * Derive a STABLE TIME_PREFIX from the text preceding the timestamp — the
 * surrounding key/delimiter, never the per-event field values (which would only
 * match the one sample event). Returns '' when there is no useful prefix.
 */
function derivePrefix(before: string): string {
  if (!before) return '';
  // Trailing `"key":` / key= boundary (JSON or key=value), incl. the value's opening quote.
  const kv = /(["']?[\w.-]+["']?\s*[:=]\s*["']?)$/.exec(before);
  if (kv) return kv[1];
  // Otherwise a short trailing punctuation delimiter (e.g. "[").
  const punct = /([^\w\s]{1,4})$/.exec(before);
  if (punct) return punct[1];
  return '';
}
