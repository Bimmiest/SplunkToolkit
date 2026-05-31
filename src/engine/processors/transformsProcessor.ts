import type { SplunkEvent, ConfDirective, ParsedConf, ValidationDiagnostic } from '../types';
import { applyRegexTransform } from '../transforms/regexTransform';
import { applyDestKey } from '../transforms/destKeyRouter';

// A DEST_KEY=_raw transform that shrinks the event by at least this fraction is
// treated as accidental data loss (FORMAT did not reproduce the rest of the line).
const RAW_LOSS_THRESHOLD = 0.3;

export function applyTransforms(
  events: SplunkEvent[],
  directives: ConfDirective[],
  transformsConf: ParsedConf,
  phase: 'index-time' | 'search-time',
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const directiveType = phase === 'index-time' ? 'TRANSFORMS' : 'REPORT';
  const transformDirectives = directives.filter((d) => d.directiveType === directiveType);

  if (transformDirectives.length === 0) return events;

  const stanzaMap = new Map(transformsConf.stanzas.map((s) => [s.name, s]));
  // Emit the DEST_KEY=_raw data-loss warning at most once per transform stanza.
  const warnedRawLoss = new Set<string>();

  return events.flatMap((event) => {
    let currentEvent: SplunkEvent | null = event;

    outer: for (const dir of transformDirectives) {
      // Value can be comma-separated list of transform stanza names
      const stanzaNames = dir.value.split(',').map((s) => s.trim()).filter(Boolean);

      for (const stanzaName of stanzaNames) {
        const transformStanza = stanzaMap.get(stanzaName);
        if (!transformStanza) continue;

        const result = applyRegexTransform(currentEvent, transformStanza);

        if (result.matched) {
          const beforeRaw = currentEvent._raw;
          const routed = applyDestKey(currentEvent, result);
          if (routed === null) return []; // nullQueue — drop the event
          if (result.destKey === '_raw' && diagnostics) {
            warnRawLoss(beforeRaw, routed._raw, stanzaName, transformStanza, diagnostics, warnedRawLoss);
          }
          currentEvent = {
            ...routed,
            processingTrace: [
              ...routed.processingTrace,
              {
                processor: `${directiveType}-${dir.className ?? ''}:${stanzaName}`,
                phase,
                description: result.destKey
                  ? `Transform routed to ${result.destKey}`
                  : `Transform extracted fields: ${Object.keys(result.fields).join(', ')}`,
                fieldsAdded: Object.keys(result.fields),
              },
            ],
          };
          if (result.destKey === 'queue') break outer; // routing is final
        }
      }
    }

    return currentEvent ? [currentEvent] : [];
  });
}

/**
 * Warn when a DEST_KEY=_raw transform discards a large chunk of the event — the
 * classic footgun where FORMAT captures only part of the line and the rest is
 * lost. Fires at most once per stanza.
 */
function warnRawLoss(
  beforeRaw: string,
  afterRaw: string,
  stanzaName: string,
  transformStanza: ParsedConf['stanzas'][number],
  diagnostics: ValidationDiagnostic[],
  warned: Set<string>,
): void {
  if (warned.has(stanzaName)) return;
  const origLen = beforeRaw.length;
  const dropped = origLen - afterRaw.length;
  if (origLen === 0 || dropped <= 0 || dropped / origLen <= RAW_LOSS_THRESHOLD) return;

  warned.add(stanzaName);
  diagnostics.push({
    level: 'warning',
    message:
      `DEST_KEY = _raw in transform "${stanzaName}" replaced the event and dropped ${dropped} of ${origLen} characters. ` +
      'DEST_KEY = _raw overwrites the entire event with the FORMAT output — any text the REGEX does not capture and ' +
      'FORMAT does not reproduce is discarded. To keep the surrounding text, capture the whole line ' +
      '(e.g. REGEX = (.*?)(secret)(.*), FORMAT = $1XXXX$3) or use SEDCMD to substitute in place.',
    file: 'transforms.conf',
    line: transformStanza.directives.find((d) => d.key === 'DEST_KEY')?.line ?? transformStanza.lineRange.start,
  });
}

