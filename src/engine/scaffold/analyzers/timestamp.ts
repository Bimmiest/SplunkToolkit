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

  const matchStart = best.match.index;
  const matchEnd = matchStart + best.match[0].length;

  // TIME_PREFIX: the literal token immediately preceding the timestamp (when any).
  if (matchStart > 0) {
    const before = best.line.slice(0, matchStart);
    const token = /(\S+)\s*$/.exec(before);
    if (token) {
      out.push({
        key: 'TIME_PREFIX',
        value: escapeRegex(token[1]),
        confidence: 'medium',
        evidence: `Timestamp is preceded by "${token[1]}"`,
        enabledByDefault: true,
      });
    }
  }

  // MAX_TIMESTAMP_LOOKAHEAD when the timestamp ends late in the line.
  if (matchEnd > 32) {
    out.push({
      key: 'MAX_TIMESTAMP_LOOKAHEAD',
      value: String(matchEnd + 10),
      confidence,
      evidence: `Timestamp ends near character ${matchEnd}`,
      enabledByDefault: true,
    });
  }

  return out;
}
