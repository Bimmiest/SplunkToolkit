import type { ScaffoldSuggestion } from '../types';

/**
 * Normalise a sourcetype toward Splunk's `vendor:product:technology` convention:
 * lowercase, with runs of non-alphanumeric characters collapsed to a single `:`.
 * Returns null when the input is empty or already hygienic.
 */
export function normalizeSourcetype(current: string): string | null {
  const trimmed = current.trim();
  if (!trimmed) return null;
  // Already lowercase, colon/underscore/hyphen-segmented, no spaces.
  if (/^[a-z0-9]+([:_-][a-z0-9]+)*$/.test(trimmed)) return null;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ':')
    .replace(/^:+|:+$/g, '');

  return normalized && normalized !== trimmed ? normalized : null;
}

export function detectSourcetypeHygiene(current: string): ScaffoldSuggestion | null {
  const normalized = normalizeSourcetype(current);
  if (!normalized) return null;
  return {
    key: 'sourcetype',
    value: normalized,
    confidence: 'low',
    evidence: `"${current}" → "${normalized}" (vendor:product:technology convention)`,
    enabledByDefault: false,
  };
}
