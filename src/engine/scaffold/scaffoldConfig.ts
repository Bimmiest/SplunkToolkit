import type { EventMetadata } from '../types';
import type { ScaffoldResult, ScaffoldSuggestion } from './types';
import { detectLineFormat } from './analyzers/lineFormat';
import { detectTimestamp } from './analyzers/timestamp';
import { detectTruncate } from './analyzers/truncate';
import { detectSourcetypeHygiene } from './analyzers/sourcetype';

/**
 * Inspect raw sample data + metadata and propose a starter props.conf stanza.
 * Pure and deterministic — the UI renders the result as a diff the user applies.
 */
export function scaffoldConfig(rawData: string, metadata: EventMetadata): ScaffoldResult {
  const lines = rawData.split(/\r?\n/);

  // Timestamp first so TIME_* directives lead the stanza, then format, then sizing.
  let suggestions: ScaffoldSuggestion[] = [
    ...detectTimestamp(lines),
    ...detectLineFormat(rawData, lines),
    ...detectTruncate(lines),
  ];

  // Structured (indexed) extraction supersedes search-time KV_MODE — never both.
  if (suggestions.some((s) => s.key === 'INDEXED_EXTRACTIONS')) {
    suggestions = suggestions.filter((s) => s.key !== 'KV_MODE');
  }

  const sourcetypeSuggestion = detectSourcetypeHygiene(metadata.sourcetype) ?? undefined;
  const sourcetype = sourcetypeSuggestion?.value || metadata.sourcetype.trim() || 'my:sourcetype';

  return { sourcetype, sourcetypeSuggestion, suggestions };
}
