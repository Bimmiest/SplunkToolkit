import type { SplunkEvent, ConfDirective } from '../types';
import { evaluateExpression } from '../processors/evalProcessor';

export function applyIngestEval(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const ingestEvalDir = directives.find((d) => d.key === 'INGEST_EVAL');
  if (!ingestEvalDir) return events;

  // INGEST_EVAL can have multiple expressions separated by semicolons
  const expressions = ingestEvalDir.value.split(';').map((e) => e.trim()).filter(Boolean);

  return events.map((event) => {
    let currentEvent = { ...event, fields: { ...event.fields } };

    for (const expr of expressions) {
      const eqIdx = expr.indexOf('=');
      if (eqIdx <= 0) continue;

      const fieldName = expr.substring(0, eqIdx).trim();
      const evalExpr = expr.substring(eqIdx + 1).trim();

      try {
        const result = evaluateExpression(evalExpr, currentEvent);
        if (result === null) {
          delete currentEvent.fields[fieldName];
        } else if (Array.isArray(result)) {
          currentEvent.fields[fieldName] = result;
        } else {
          currentEvent.fields[fieldName] = String(result);
        }
      } catch {
        // Skip failed evaluations
      }
    }

    return {
      ...currentEvent,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'INGEST_EVAL',
          phase: 'index-time' as const,
          description: `Evaluated ${expressions.length} ingest-time expression(s)`,
        },
      ],
    };
  });
}
