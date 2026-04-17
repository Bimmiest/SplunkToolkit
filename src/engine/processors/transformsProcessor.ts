import type { SplunkEvent, ConfDirective, ParsedConf } from '../types';
import { applyRegexTransform } from '../transforms/regexTransform';
import { applyDestKey } from '../transforms/destKeyRouter';

export function applyTransforms(
  events: SplunkEvent[],
  directives: ConfDirective[],
  transformsConf: ParsedConf,
  phase: 'index-time' | 'search-time'
): SplunkEvent[] {
  const directiveType = phase === 'index-time' ? 'TRANSFORMS' : 'REPORT';
  const transformDirectives = directives.filter((d) => d.directiveType === directiveType);

  if (transformDirectives.length === 0) return events;

  const stanzaMap = new Map(transformsConf.stanzas.map((s) => [s.name, s]));

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
          const routed = applyDestKey(currentEvent, result);
          if (routed === null) return []; // nullQueue — drop the event
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

