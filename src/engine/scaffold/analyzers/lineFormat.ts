import type { Confidence, ScaffoldSuggestion } from '../types';

/**
 * Detect the line/event format and propose the matching props.conf directives
 * (KV_MODE / INDEXED_EXTRACTIONS / LINE_BREAKER / SHOULD_LINEMERGE).
 *
 * Precedent — INDEXED_EXTRACTIONS vs KV_MODE (Splunk guidance: prefer search-time
 * extraction unless index-time is specifically needed):
 *   • Delimited files (CSV / TSV / PSV / W3C) → INDEXED_EXTRACTIONS. They require
 *     index-time structured parsing; there is no search-time KV_MODE equivalent.
 *   • JSON / XML / key=value → KV_MODE (search-time). Flexible, no index bloat, no
 *     extra storage/license cost. We deliberately do NOT propose
 *     INDEXED_EXTRACTIONS=json — and never both (that double-extracts and
 *     duplicates field values). Index-time JSON is a niche choice (e.g. tstats /
 *     accelerated data models) left to the engineer.
 */
export function detectLineFormat(rawData: string, lines: string[]): ScaffoldSuggestion[] {
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  if (nonBlank.length === 0) return [];

  // XML — declaration or a leading element.
  if (/<\?xml/i.test(rawData) || /^\s*<[a-zA-Z!]/.test(rawData)) {
    return [{ key: 'KV_MODE', value: 'xml', confidence: 'high', evidence: 'Input looks like XML', enabledByDefault: true }];
  }

  // JSON, one object per line.
  const jsonLines = nonBlank.filter(isJsonLine).length;
  const jsonRatio = jsonLines / nonBlank.length;
  if (jsonRatio >= 0.8) {
    return [
      { key: 'LINE_BREAKER', value: '([\\r\\n]+)', confidence: 'medium', evidence: 'One JSON object per line — break on newlines', enabledByDefault: true },
      { key: 'SHOULD_LINEMERGE', value: 'false', confidence: 'high', evidence: 'JSON events are a single line each; do not merge', enabledByDefault: true },
      { key: 'KV_MODE', value: 'json', confidence: jsonRatio === 1 ? 'high' : 'medium', evidence: `${jsonLines}/${nonBlank.length} lines parse as JSON — search-time KV_MODE preferred over INDEXED_EXTRACTIONS (no index bloat)`, enabledByDefault: true },
    ];
  }

  // A single multi-line JSON object.
  const trimmed = rawData.trim();
  if (nonBlank.length > 1 && trimmed.startsWith('{') && tryParse(trimmed)) {
    return [
      { key: 'LINE_BREAKER', value: '([\\r\\n]+)(?=\\{)', confidence: 'medium', evidence: 'Input is a multi-line JSON object', enabledByDefault: true },
      { key: 'SHOULD_LINEMERGE', value: 'false', confidence: 'medium', evidence: 'Break before each new JSON object', enabledByDefault: true },
      { key: 'KV_MODE', value: 'json', confidence: 'medium', evidence: 'JSON payload', enabledByDefault: true },
    ];
  }

  // Delimited (CSV / TSV / PSV).
  const delim = detectDelimiter(nonBlank);
  if (delim) {
    return [{ key: 'INDEXED_EXTRACTIONS', value: delim.format, confidence: delim.confidence, evidence: `${delim.evidence} — delimited files use index-time structured extraction`, enabledByDefault: true }];
  }

  // Whitespace-indented continuation lines → merge into the preceding event.
  const continuation = nonBlank.filter((l) => /^\s/.test(l)).length;
  if (continuation > 0 && continuation / nonBlank.length >= 0.1) {
    return [
      { key: 'SHOULD_LINEMERGE', value: 'true', confidence: 'medium', evidence: `${continuation} line(s) start with whitespace (continuations)`, enabledByDefault: true },
      { key: 'BREAK_ONLY_BEFORE', value: '^\\S', confidence: 'medium', evidence: 'Start a new event only on a non-indented line', enabledByDefault: true },
    ];
  }

  return [];
}

function isJsonLine(line: string): boolean {
  const t = line.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  return tryParse(t);
}

function tryParse(text: string): boolean {
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null;
  } catch {
    return false;
  }
}

function countChar(line: string, ch: string): number {
  let n = 0;
  for (const c of line) if (c === ch) n++;
  return n;
}

function detectDelimiter(lines: string[]): { format: string; confidence: Confidence; evidence: string } | null {
  const candidates: Array<[string, string]> = [[',', 'csv'], ['\t', 'tsv'], ['|', 'psv']];
  const sample = lines.slice(0, 50);
  let best: { format: string; confidence: Confidence; evidence: string; score: number } | null = null;

  for (const [ch, format] of candidates) {
    const counts = sample.map((l) => countChar(l, ch));
    const headerCount = counts[0];
    if (headerCount < 1) continue;
    const consistent = counts.filter((c) => c === headerCount).length;
    const ratio = consistent / counts.length;
    if (ratio < 0.7) continue;
    const score = ratio * headerCount;
    if (!best || score > best.score) {
      best = {
        format,
        confidence: ratio >= 0.95 ? 'high' : 'medium',
        evidence: `Consistent ${headerCount + 1} ${format.toUpperCase()} columns across ${consistent}/${counts.length} lines`,
        score,
      };
    }
  }
  return best ? { format: best.format, confidence: best.confidence, evidence: best.evidence } : null;
}
