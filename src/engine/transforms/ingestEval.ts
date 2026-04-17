import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';
import { evaluateExpression } from '../processors/evalProcessor';

// Split "field=expr, field2=fn(a,b)" on top-level commas only (not inside parens).
function splitAssignments(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts.filter(Boolean);
}

export function applyIngestEval(
  events: SplunkEvent[],
  directives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const ingestEvalDirs = directives.filter((d) => d.key === 'INGEST_EVAL');
  if (ingestEvalDirs.length === 0) return events;

  const reportedErrors = new Set<string>();
  const reportedStubs = new Set<string>();

  return events.map((event) => {
    const currentEvent = { ...event, fields: { ...event.fields } };
    let totalExpressions = 0;

    for (const ingestEvalDir of ingestEvalDirs) {
      const expressions = splitAssignments(ingestEvalDir.value);
      totalExpressions += expressions.length;

      for (const expr of expressions) {
        const eqIdx = expr.indexOf('=');
        if (eqIdx <= 0) continue;

        const fieldName = expr.substring(0, eqIdx).trim();
        const evalExpr = expr.substring(eqIdx + 1).trim();

        try {
          const result = evaluateExpression(evalExpr, currentEvent, (fn) => {
            if (diagnostics && !reportedStubs.has(fn)) {
              reportedStubs.add(fn);
              diagnostics.push({
                level: 'warning',
                message: `${fn}() is not fully simulated — results may differ from real Splunk`,
                file: 'transforms.conf',
                line: ingestEvalDir.line,
                directiveKey: ingestEvalDir.key,
              });
            }
          });
          if (result === null) {
            delete currentEvent.fields[fieldName];
          } else if (Array.isArray(result)) {
            currentEvent.fields[fieldName] = result;
          } else {
            currentEvent.fields[fieldName] = String(result);
          }
        } catch (err) {
          if (diagnostics && !reportedErrors.has(fieldName)) {
            reportedErrors.add(fieldName);
            diagnostics.push({
              level: 'error',
              message: `INGEST_EVAL ${fieldName}: ${err instanceof Error ? err.message : String(err)}`,
              file: 'transforms.conf',
              line: ingestEvalDir.line,
              directiveKey: ingestEvalDir.key,
            });
          }
        }
      }
    }

    return {
      ...currentEvent,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'INGEST_EVAL',
          phase: 'index-time' as const,
          description: `Evaluated ${totalExpressions} ingest-time expression(s)`,
        },
      ],
    };
  });
}
