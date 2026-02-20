import type { EventMetadata, ProcessingResult, ValidationDiagnostic, ConfDirective, SplunkEvent } from './types';
import { parseConf } from './parser/confParser';
import { matchStanzas, mergeDirectives } from './parser/stanzaMatcher';
import { breakLines } from './processors/lineBreaker';
import { extractTimestamps } from './processors/timestampExtractor';
import { truncateEvents } from './processors/truncator';
import { applyIndexedExtractions } from './processors/indexedExtractions';
import { applySedCommands } from './processors/sedCmd';
import { applyTransforms } from './processors/transformsProcessor';
import { extractFields } from './processors/fieldExtractor';
import { applyKvMode } from './processors/kvMode';
import { applyFieldAliases } from './processors/fieldAlias';
import { applyEvalExpressions } from './processors/evalProcessor';
import { applyIngestEval } from './transforms/ingestEval';

function safeProcessor(
  name: string,
  events: SplunkEvent[],
  fn: () => SplunkEvent[],
  diagnostics: ValidationDiagnostic[]
): SplunkEvent[] {
  try {
    return fn();
  } catch (err) {
    diagnostics.push({
      level: 'error',
      message: `Processor "${name}" failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      file: 'props.conf',
    });
    return events; // Return unmodified events on failure
  }
}

export function runPipeline(
  rawData: string,
  metadata: EventMetadata,
  propsConfText: string,
  transformsConfText: string
): { result: ProcessingResult; diagnostics: ValidationDiagnostic[] } {
  const diagnostics: ValidationDiagnostic[] = [];

  if (!rawData.trim()) {
    return {
      result: { events: [], originalRaw: rawData, eventCount: 0, processingSteps: [] },
      diagnostics,
    };
  }

  // Guard against excessively large inputs (> 1MB)
  const MAX_RAW_SIZE = 1_000_000;
  const truncatedRaw = rawData.length > MAX_RAW_SIZE ? rawData.slice(0, MAX_RAW_SIZE) : rawData;
  if (rawData.length > MAX_RAW_SIZE) {
    diagnostics.push({
      level: 'warning',
      message: `Input truncated to ${MAX_RAW_SIZE.toLocaleString()} characters for performance (original: ${rawData.length.toLocaleString()})`,
      file: 'props.conf',
    });
  }

  // 1. Parse configurations
  const propsConf = parseConf(propsConfText, 'props.conf');
  const transformsConf = parseConf(transformsConfText, 'transforms.conf');

  diagnostics.push(...propsConf.errors, ...transformsConf.errors);

  // Cross-reference validation: check TRANSFORMS/REPORT references exist in transforms.conf
  for (const stanza of propsConf.stanzas) {
    for (const dir of stanza.directives) {
      if (dir.directiveType === 'TRANSFORMS' || dir.directiveType === 'REPORT') {
        const stanzaNames = dir.value.split(',').map((s) => s.trim()).filter(Boolean);
        for (const name of stanzaNames) {
          if (!transformsConf.stanzas.find((s) => s.name === name)) {
            diagnostics.push({
              level: 'error',
              message: `Referenced transform stanza "${name}" not found in transforms.conf`,
              file: 'props.conf',
              line: dir.line,
              directiveKey: dir.key,
            });
          }
        }
      }
    }
  }

  // Check for unreferenced transforms.conf stanzas
  const referencedTransforms = new Set<string>();
  for (const stanza of propsConf.stanzas) {
    for (const dir of stanza.directives) {
      if (dir.directiveType === 'TRANSFORMS' || dir.directiveType === 'REPORT') {
        dir.value.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => referencedTransforms.add(n));
      }
    }
  }
  for (const stanza of transformsConf.stanzas) {
    if (stanza.type !== 'default' && !referencedTransforms.has(stanza.name)) {
      diagnostics.push({
        level: 'warning',
        message: `Transform stanza "${stanza.name}" is defined but never referenced from props.conf`,
        file: 'transforms.conf',
        line: stanza.lineRange.start,
      });
    }
  }

  // 2. Match stanzas to metadata (by precedence)
  const matchedStanzas = matchStanzas(propsConf.stanzas, metadata);
  const directives = mergeDirectives(matchedStanzas);

  // Collect all directives (not merged) for class-based ones
  const allDirectives: ConfDirective[] = [];
  for (const stanza of matchedStanzas) {
    allDirectives.push(...stanza.directives);
  }

  // ── Index-time processing ─────────────────────────────

  // Step 1-2: Line breaking and merging
  let events = breakLines(truncatedRaw, allDirectives, metadata);

  // Step 3: Truncation
  events = safeProcessor('TRUNCATE', events, () => truncateEvents(events, directives), diagnostics);

  // Step 4: Timestamp extraction
  events = safeProcessor('Timestamp', events, () => extractTimestamps(events, directives), diagnostics);

  // Step 5: Indexed extractions
  events = safeProcessor('INDEXED_EXTRACTIONS', events, () => applyIndexedExtractions(events, directives), diagnostics);

  // Step 6: SEDCMD
  events = safeProcessor('SEDCMD', events, () => applySedCommands(events, allDirectives), diagnostics);

  // Step 7: Index-time TRANSFORMS
  events = safeProcessor('TRANSFORMS', events, () => applyTransforms(events, allDirectives, transformsConf, 'index-time'), diagnostics);

  // Step 7b: INGEST_EVAL (from transforms.conf stanzas)
  events = safeProcessor('INGEST_EVAL', events, () => {
    let result = events;
    for (const stanza of transformsConf.stanzas) {
      const ingestEvalDirs = stanza.directives.filter((d) => d.key === 'INGEST_EVAL');
      if (ingestEvalDirs.length > 0) {
        result = applyIngestEval(result, ingestEvalDirs);
      }
    }
    return result;
  }, diagnostics);

  // ── Search-time processing ────────────────────────────

  // Step 8: EXTRACT (inline field extraction)
  events = safeProcessor('EXTRACT', events, () => extractFields(events, allDirectives), diagnostics);

  // Step 9: KV_MODE
  events = safeProcessor('KV_MODE', events, () => applyKvMode(events, directives), diagnostics);

  // Step 10: Search-time REPORT transforms
  events = safeProcessor('REPORT', events, () => applyTransforms(events, allDirectives, transformsConf, 'search-time'), diagnostics);

  // Step 11: FIELDALIAS
  events = safeProcessor('FIELDALIAS', events, () => applyFieldAliases(events, allDirectives), diagnostics);

  // Step 12: EVAL (calculated fields)
  events = safeProcessor('EVAL', events, () => applyEvalExpressions(events, allDirectives), diagnostics);

  // Collect all processing steps
  const processingSteps = events.flatMap((e) => e.processingTrace);

  return {
    result: {
      events,
      originalRaw: truncatedRaw,
      eventCount: events.length,
      processingSteps,
    },
    diagnostics,
  };
}
