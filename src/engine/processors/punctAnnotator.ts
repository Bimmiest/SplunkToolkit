/**
 * Punct Annotator
 *
 * Simulates ANNOTATE_PUNCT: Splunk's annotation processor indexes a `punct`
 * field holding the event's punctuation signature, used to find structurally
 * similar events. It runs in the typing pipeline after regex replacement, so
 * the signature reflects the event as indexed — after SEDCMD and index-time
 * transforms have rewritten `_raw`.
 *
 * The signature itself is under-documented. What is implemented here follows
 * the worked example in Splunk's search documentation plus well-established
 * community observations:
 *  - letters and digits are dropped, every other character survives in order;
 *  - a space becomes `_`;
 *  - tab and newline become the two-character sequences `\t` and `\n`, which
 *    is what makes `punct="*\\t*"` a working idiom for finding tab-indented
 *    stack traces;
 *  - the signature is capped at 30 characters.
 *
 * The cap and the carriage-return handling (dropped here) are inferred rather
 * than measured. No fidelity capture pins any of this yet: the capture script
 * currently excludes `punct` from every fixture, so pinning it means removing
 * that exclusion and re-capturing (#185).
 */

import type { ConfDirective, SplunkEvent } from '../types';
import { setField } from '../utils/fieldBag';

const PUNCT_MAX_LENGTH = 30;

/** Build the punctuation signature for one event's `_raw`. */
export function buildPunct(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (out.length >= PUNCT_MAX_LENGTH) break;
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')) continue;
    if (ch === ' ') out += '_';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') continue;
    else out += ch;
  }
  return out.slice(0, PUNCT_MAX_LENGTH);
}

export function annotatePunct(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const declared = directives.find((d) => d.key === 'ANNOTATE_PUNCT')?.value.trim().toLowerCase();
  // Splunk's default is true; only an explicit false disables the field.
  const enabled = declared === undefined ? true : declared !== 'false';
  if (!enabled) return events;

  return events.map((event) => {
    const punct = buildPunct(event._raw);
    const fields = { ...event.fields };
    setField(fields, 'punct', punct);
    return {
      ...event,
      fields,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'ANNOTATE_PUNCT',
          phase: 'index-time' as const,
          description: `Annotated punctuation signature punct="${punct}"`,
          fieldsAdded: ['punct'],
        },
      ],
    };
  });
}
