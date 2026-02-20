import type { SplunkEvent, ConfDirective, ConfStanza, ParsedConf } from '../types';
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

  return events.map((event) => {
    let currentEvent = event;

    for (const dir of transformDirectives) {
      // Value can be comma-separated list of transform stanza names
      const stanzaNames = dir.value.split(',').map((s) => s.trim()).filter(Boolean);

      for (const stanzaName of stanzaNames) {
        const transformStanza = transformsConf.stanzas.find((s) => s.name === stanzaName);
        if (!transformStanza) continue;

        const result = applyRegexTransform(currentEvent, transformStanza);

        if (result.matched) {
          currentEvent = applyDestKey(currentEvent, result);
          currentEvent = {
            ...currentEvent,
            processingTrace: [
              ...currentEvent.processingTrace,
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
        }
      }
    }

    return currentEvent;
  });
}

export function resolveTransformStanza(
  transformsConf: ParsedConf,
  stanzaName: string
): ConfStanza | undefined {
  return transformsConf.stanzas.find((s) => s.name === stanzaName);
}
