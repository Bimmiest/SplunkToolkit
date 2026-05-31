import type { ScaffoldSuggestion } from '../types';

const DEFAULT_TRUNCATE = 10000;

/**
 * Suggest raising TRUNCATE only when events are long enough that the 10000-byte
 * default would cut them. Suggesting a *lower* value would risk truncating valid
 * events, so the default is left alone for short data.
 */
export function detectTruncate(lines: string[]): ScaffoldSuggestion[] {
  const lengths = lines.map((l) => l.length).filter((n) => n > 0).sort((a, b) => a - b);
  if (lengths.length === 0) return [];

  const p99 = percentile(lengths, 0.99);
  const maxLen = lengths[lengths.length - 1];
  const headroom = Math.ceil((p99 * 1.5) / 1000) * 1000;
  if (headroom <= DEFAULT_TRUNCATE) return [];

  return [{
    key: 'TRUNCATE',
    value: String(headroom),
    confidence: 'medium',
    evidence: `Longest events ≈ ${maxLen} chars — raise TRUNCATE above the ${DEFAULT_TRUNCATE} default`,
    enabledByDefault: true,
  }];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
