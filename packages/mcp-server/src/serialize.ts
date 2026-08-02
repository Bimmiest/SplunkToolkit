/**
 * Shapes a ProcessingResult for an LLM consumer: bounded event count, `_time`
 * as ISO-8601, and trace snapshots stripped unless asked for — a trace step's
 * before/after `_raw` snapshots dwarf everything else in the payload and the
 * agent can already see `_raw` on the event.
 */
import type { ProcessingResult, ProcessingStep, SplunkEvent } from '../../../src/engine/types';

export interface SerializeOptions {
  maxEvents: number;
  includeSnapshots: boolean;
}

function serializeStep(step: ProcessingStep, includeSnapshots: boolean) {
  const { inputSnapshot, outputSnapshot, ...rest } = step;
  return includeSnapshots ? { ...rest, inputSnapshot, outputSnapshot } : rest;
}

function serializeEvent(event: SplunkEvent, includeSnapshots: boolean) {
  return {
    _raw: event._raw,
    _time: event._time ? event._time.toISOString() : null,
    metadata: event.metadata,
    fields: event.fields,
    indexedFields: event._meta,
    lineNumbers: event.lineNumbers,
    processingTrace: event.processingTrace.map((s) => serializeStep(s, includeSnapshots)),
  };
}

export function serializeResult(result: ProcessingResult, options: SerializeOptions) {
  const events = result.events.slice(0, options.maxEvents);
  return {
    eventCount: result.eventCount,
    returnedEvents: events.length,
    ...(result.eventCount > events.length
      ? {
          truncationNote:
            `Only the first ${events.length} of ${result.eventCount} events are returned; ` +
            'raise max_events or use a smaller sample to see the rest.',
        }
      : {}),
    events: events.map((e) => serializeEvent(e, options.includeSnapshots)),
    processingSteps: result.processingSteps.map((s) =>
      serializeStep(s, options.includeSnapshots),
    ),
  };
}
