import type { EventMetadata, PipelineOptions, ProcessingResult, ValidationDiagnostic, ConfDirective, SplunkEvent } from './types';
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
import { attributeRawMutations } from './processors/rawMutationAttribution';

function safeProcessor(
  name: string,
  events: SplunkEvent[],
  fn: () => SplunkEvent[],
  diagnostics: ValidationDiagnostic[],
  file: ValidationDiagnostic['file'] = 'props.conf'
): SplunkEvent[] {
  try {
    return fn();
  } catch (err) {
    diagnostics.push({
      level: 'error',
      message: `Processor "${name}" failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      file,
    });
    return events; // Return unmodified events on failure
  }
}

export function runPipeline(
  rawData: string,
  metadata: EventMetadata,
  propsConfText: string,
  transformsConfText: string,
  options?: PipelineOptions
): { result: ProcessingResult; diagnostics: ValidationDiagnostic[] } {
  const diagnostics: ValidationDiagnostic[] = [];

  if (!rawData.trim()) {
    return {
      result: { events: [], originalRaw: rawData, eventCount: 0, processingSteps: [] },
      diagnostics,
    };
  }

  // Guard against excessively large inputs (> 1MB). Cut back to the last line
  // break inside the cap rather than at an arbitrary character: slicing
  // mid-line hands the pipeline a half-event, which then mis-breaks,
  // mis-timestamps, or extracts a truncated final field — a corrupt result
  // presented as a real one. Losing the partial trailing line is the honest
  // outcome, and the warning says so.
  const MAX_RAW_SIZE = 1_000_000;
  let truncatedRaw = rawData;
  if (rawData.length > MAX_RAW_SIZE) {
    const capped = rawData.slice(0, MAX_RAW_SIZE);
    const lastBreak = capped.lastIndexOf('\n');
    truncatedRaw = lastBreak > 0 ? capped.slice(0, lastBreak) : capped;
    diagnostics.push({
      level: 'warning',
      message:
        `Input truncated to ${truncatedRaw.length.toLocaleString()} characters for performance ` +
        `(original: ${rawData.length.toLocaleString()}). Truncation is aligned to the last complete ` +
        'line, so the final partial event is dropped rather than processed half-formed.',
      file: 'props.conf',
    });
  }

  // 1. Parse configurations
  const propsConf = parseConf(propsConfText, 'props.conf');
  const transformsConf = parseConf(transformsConfText, 'transforms.conf');

  diagnostics.push(...propsConf.errors, ...transformsConf.errors);

  // Warn about LOOKUP directives — lookup table execution is not simulated
  for (const stanza of propsConf.stanzas) {
    for (const dir of stanza.directives) {
      if (dir.directiveType === 'LOOKUP') {
        diagnostics.push({
          level: 'warning',
          message: `LOOKUP-${dir.className ?? dir.key} is configured but lookup table execution is not simulated — fields will not be populated`,
          file: 'props.conf',
          line: dir.line,
          directiveKey: dir.key,
        });
      }
    }
  }

  // Validate DEST_KEY=MetaData:* stanzas require the matching prefix in FORMAT
  const DEST_KEY_REQUIRED_PREFIX: Record<string, string> = {
    'MetaData:Host': 'host::',
    'MetaData:Source': 'source::',
    'MetaData:Sourcetype': 'sourcetype::',
    'MetaData:Index': 'index::',
  };
  // DEST_KEY only accepts a documented set of routing keys; the simulator otherwise
  // falls back to "treat as a field name", which Splunk does not do.
  const DEST_KEY_SIMULATED = new Set([
    'queue', '_raw', '_meta', '_time',
    'MetaData:Host', 'MetaData:Source', 'MetaData:Sourcetype', 'MetaData:Index',
  ]);
  const DEST_KEY_UNSIMULATED = new Set(['_TCP_ROUTING', '_SYSLOG_ROUTING', '_INDEX_AND_FORWARD_ROUTING']);
  for (const stanza of transformsConf.stanzas) {
    const destKeyDir = stanza.directives.find((d) => d.key === 'DEST_KEY');
    const formatDir = stanza.directives.find((d) => d.key === 'FORMAT');
    if (!destKeyDir) continue;

    // Normalise the _MetaData: alias the same way the router does.
    const destKey = destKeyDir.value.trim().replace(/^_(?=MetaData:)/i, '');

    if (DEST_KEY_UNSIMULATED.has(destKey)) {
      diagnostics.push({
        level: 'warning',
        message: `DEST_KEY = ${destKeyDir.value.trim()} is a valid Splunk routing key but is not simulated — events will not be cloned/routed in the preview.`,
        file: 'transforms.conf',
        line: destKeyDir.line,
        directiveKey: destKeyDir.key,
      });
    } else if (!DEST_KEY_SIMULATED.has(destKey)) {
      diagnostics.push({
        level: 'warning',
        message: `DEST_KEY = ${destKeyDir.value.trim()} is not a recognised Splunk DEST_KEY. Splunk only accepts the documented keys (queue, _raw, _meta, _time, MetaData:Host/Source/Sourcetype/Index, _TCP_ROUTING, _SYSLOG_ROUTING). An unrecognised key has no routing effect.`,
        file: 'transforms.conf',
        line: destKeyDir.line,
        directiveKey: destKeyDir.key,
      });
    }

    if (formatDir) {
      const requiredPrefix = DEST_KEY_REQUIRED_PREFIX[destKey];
      if (requiredPrefix && !formatDir.value.includes(requiredPrefix)) {
        diagnostics.push({
          level: 'warning',
          message: `DEST_KEY = ${destKeyDir.value.trim()} requires FORMAT to include the "${requiredPrefix}" prefix (e.g. FORMAT = ${requiredPrefix}$1). Without it Splunk silently skips the metadata update.`,
          file: 'transforms.conf',
          line: formatDir.line,
          directiveKey: formatDir.key,
          suggestion: `Change FORMAT = ${formatDir.value.trim()} to FORMAT = ${requiredPrefix}${formatDir.value.trim()}`,
        });
      }
    }
  }

  // Cross-reference validation: check TRANSFORMS/REPORT references exist, and collect
  // referenced stanza names in one pass (avoids iterating props stanzas twice).
  const referencedTransforms = new Set<string>();
  for (const stanza of propsConf.stanzas) {
    for (const dir of stanza.directives) {
      if (dir.directiveType === 'TRANSFORMS' || dir.directiveType === 'REPORT') {
        const stanzaNames = dir.value.split(',').map((s) => s.trim()).filter(Boolean);
        for (const name of stanzaNames) {
          referencedTransforms.add(name);
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

  // 2. Match stanzas to metadata (by precedence) and merge directives (deduped by key, first wins).
  const matchedStanzas = matchStanzas(propsConf.stanzas, metadata);
  const directives = mergeDirectives(matchedStanzas);

  // Warn when INDEXED_EXTRACTIONS = json is paired with search-time JSON extraction.
  // Splunk extracts the fields at BOTH index time and search time, producing duplicate
  // (multivalue) values. The simulator currently suppresses the duplicate in the preview,
  // so without this warning an operator could ship a config that misbehaves in Splunk.
  const indexedExtJson = directives.find((d) => d.key === 'INDEXED_EXTRACTIONS')?.value.trim().toLowerCase() === 'json';
  if (indexedExtJson) {
    const kvModeDir = directives.find((d) => d.key === 'KV_MODE');
    const kvMode = kvModeDir?.value.trim().toLowerCase();
    const autoKvJsonDir = directives.find((d) => d.key === 'AUTO_KV_JSON');
    const autoKvJson = autoKvJsonDir ? autoKvJsonDir.value.trim().toLowerCase() !== 'false' : true;
    const searchTimeJson =
      kvMode === 'json' ||
      ((kvMode === undefined || kvMode === 'auto' || kvMode === 'auto_escaped') && autoKvJson);
    if (kvMode !== 'none' && searchTimeJson) {
      const kvDesc = kvMode ? `KV_MODE = ${kvMode}` : 'the default KV_MODE = auto';
      diagnostics.push({
        level: 'warning',
        message:
          `INDEXED_EXTRACTIONS = json already extracts fields at index time, but ${kvDesc} extracts them again at search time. ` +
          'In Splunk this produces duplicate (multivalue) field values. Set KV_MODE = none for this sourcetype when using INDEXED_EXTRACTIONS = json.',
        file: 'props.conf',
        line: kvModeDir?.line ?? directives.find((d) => d.key === 'INDEXED_EXTRACTIONS')?.line,
      });
    }
  }

  // ── Index-time processing ─────────────────────────────

  // Step 1-2: Line breaking and merging.
  // Real Splunk implicitly sets SHOULD_LINEMERGE=false when INDEXED_EXTRACTIONS is a
  // structured format (csv/tsv/psv/w3c), so each line becomes its own event.
  const STRUCTURED_EXTRACTIONS = new Set(['csv', 'tsv', 'psv', 'w3c']);
  const indexedExtDir = directives.find((d) => d.key === 'INDEXED_EXTRACTIONS');
  const lineBreakDirectives =
    indexedExtDir && STRUCTURED_EXTRACTIONS.has(indexedExtDir.value.trim().toLowerCase()) &&
    !directives.some((d) => d.key.toUpperCase() === 'SHOULD_LINEMERGE')
      ? [...directives, { key: 'SHOULD_LINEMERGE', value: 'false', directiveType: 'SHOULD_LINEMERGE', line: 0 } as ConfDirective]
      : directives;
  let events = breakLines(truncatedRaw, lineBreakDirectives, metadata, diagnostics);

  // Step 3: Truncation
  events = safeProcessor('TRUNCATE', events, () => truncateEvents(events, directives, diagnostics), diagnostics);

  // Step 4: Timestamp extraction
  events = safeProcessor('Timestamp', events, () => extractTimestamps(events, directives, diagnostics), diagnostics);

  // Step 5: Indexed extractions
  events = safeProcessor('INDEXED_EXTRACTIONS', events, () => applyIndexedExtractions(events, directives), diagnostics);

  // Step 6: SEDCMD
  events = safeProcessor('SEDCMD', events, () => applySedCommands(events, directives, diagnostics), diagnostics);

  // Step 7: Index-time TRANSFORMS — regex transforms, DEST_KEY routing, and
  // INGEST_EVAL stanzas are all applied here, interleaved in TRANSFORMS-<class>
  // list order (only when a props.conf stanza references them).
  events = safeProcessor('TRANSFORMS', events, () => applyTransforms(events, directives, transformsConf, 'index-time', diagnostics), diagnostics, 'transforms.conf');

  // ── Search-time processing ────────────────────────────

  const metaKey = (m: EventMetadata) => `${m.sourcetype}|${m.host}|${m.source}`;
  const originalMetaKey = metaKey(metadata);

  if (options?.perEventPipeline) {
    // Resolve per-event directives; re-match stanzas for events whose metadata changed at index-time.
    const directivesCache = new Map<string, ConfDirective[]>();
    directivesCache.set(originalMetaKey, directives);

    const eventDirectives = events.map((event) => {
      const key = metaKey(event.metadata);
      if (directivesCache.has(key)) return directivesCache.get(key)!;
      const stanzas = matchStanzas(propsConf.stanzas, event.metadata);
      const resolved = mergeDirectives(stanzas);
      directivesCache.set(key, resolved);
      return resolved;
    });

    // Annotate events whose metadata was rewritten so the trace shows the re-match.
    events = events.map((event, i) => {
      if (metaKey(event.metadata) === originalMetaKey) return event;
      return {
        ...event,
        processingTrace: [
          ...event.processingTrace,
          {
            processor: 'StanzaRematch',
            phase: 'search-time' as const,
            description: `Metadata rewritten at index-time (sourcetype → "${event.metadata.sourcetype}"); stanzas re-matched for search-time using ${eventDirectives[i].length} directives`,
          },
        ],
      };
    });

    // Run search-time steps per-event with their resolved directives.
    const processed: SplunkEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const evDirs = eventDirectives[i];
      let ev: SplunkEvent[] = [events[i]];
      // Splunk's search-time order is EXTRACT → REPORT → automatic KV (KV_MODE) → FIELDALIAS → EVAL.
      ev = safeProcessor('EXTRACT', ev, () => extractFields(ev, evDirs, diagnostics), diagnostics);
      ev = safeProcessor('REPORT', ev, () => applyTransforms(ev, evDirs, transformsConf, 'search-time'), diagnostics, 'transforms.conf');
      ev = safeProcessor('KV_MODE', ev, () => applyKvMode(ev, evDirs, diagnostics), diagnostics);
      ev = safeProcessor('FIELDALIAS', ev, () => applyFieldAliases(ev, evDirs, diagnostics), diagnostics);
      ev = safeProcessor('EVAL', ev, () => applyEvalExpressions(ev, evDirs, diagnostics), diagnostics);
      // Step 13: attribute index-time `_raw` rewrites to the fields they hit.
      // Must run last — it replays extraction, which only exists now.
      ev = safeProcessor('SEDCMD attribution', ev, () => attributeRawMutations(ev, () => evDirs, transformsConf), diagnostics);
      processed.push(...ev);
    }
    events = processed;
  } else {
    // Warn if any event had its routing metadata rewritten at index-time — search-time directives
    // are still resolved from the original metadata in batch mode.
    const rewroteMetadata = events.some((e) => metaKey(e.metadata) !== originalMetaKey);
    if (rewroteMetadata) {
      diagnostics.push({
        level: 'warning',
        message:
          'One or more events had their sourcetype/host/source rewritten by a DEST_KEY = MetaData:* transform at index-time. ' +
          'In batch mode, search-time processors (EXTRACT, REPORT, FIELDALIAS, EVAL) still use the original stanza match and will not apply directives from the new sourcetype. ' +
          'Enable "Re-match stanzas after metadata rewrites" in Settings to simulate this correctly.',
        file: 'transforms.conf',
      });
    }

    // Step 8: EXTRACT (inline field extraction)
    events = safeProcessor('EXTRACT', events, () => extractFields(events, directives, diagnostics), diagnostics);

    // Step 9: Search-time REPORT transforms (run BEFORE automatic KV — Splunk's
    // documented order is inline EXTRACT → REPORT field transforms → automatic KV).
    events = safeProcessor('REPORT', events, () => applyTransforms(events, directives, transformsConf, 'search-time'), diagnostics, 'transforms.conf');

    // Step 10: KV_MODE (automatic key-value extraction)
    events = safeProcessor('KV_MODE', events, () => applyKvMode(events, directives, diagnostics), diagnostics);

    // Step 11: FIELDALIAS
    events = safeProcessor('FIELDALIAS', events, () => applyFieldAliases(events, directives, diagnostics), diagnostics);

    // Step 12: EVAL (calculated fields)
    events = safeProcessor('EVAL', events, () => applyEvalExpressions(events, directives, diagnostics), diagnostics);

    // Step 13: attribute index-time `_raw` rewrites (SEDCMD, DEST_KEY = _raw) to
    // the fields whose extracted value they changed or destroyed. Runs last
    // because it replays search-time extraction against the pre-rewrite text,
    // which is the only way the association can be computed at all.
    events = safeProcessor('SEDCMD attribution', events, () => attributeRawMutations(events, () => directives, transformsConf), diagnostics);
  }

  // Belt and braces: a processor that threw leaves `rawMutations` in place, and
  // the transient record must never reach a caller.
  events = events.map((e) => {
    if (!e.rawMutations) return e;
    const { rawMutations: _rawMutations, ...rest } = e;
    return rest;
  });

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
