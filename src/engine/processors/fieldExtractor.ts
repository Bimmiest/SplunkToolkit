import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';
import { safeRegex, convertSplunkToJsRegex } from '../../utils/splunkRegex';
import { isInternalField } from '../utils/internalFields';

export function extractFields(
  events: SplunkEvent[],
  directives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const extractDirectives = directives
    .filter((d) => d.directiveType === 'EXTRACT')
    .sort((a, b) => (a.className ?? '').localeCompare(b.className ?? ''));

  if (extractDirectives.length === 0) return events;

  const extractions = extractDirectives.map((dir) => {
    const { pattern, sourceField } = parseExtractValue(dir.value);
    const jsPattern = pattern ? convertSplunkToJsRegex(pattern) : null;
    // Use global flag so matchAll finds all occurrences (multivalue support).
    const regex = jsPattern ? safeRegex(jsPattern, 'g') : null;
    return { directive: dir, regex, sourceField };
  });

  const reportedStrippedRefs = new Set<string>();

  return events.map((event) => {
    const newFields = { ...event.fields };
    const traces: SplunkEvent['processingTrace'] = [];

    for (const extraction of extractions) {
      if (!extraction.regex) continue;

      const sourceValue = extraction.sourceField
        ? getFieldValue(event, extraction.sourceField)
        : event._raw;

      if (!sourceValue) {
        if (
          diagnostics &&
          extraction.sourceField &&
          extraction.sourceField.startsWith('_') &&
          !isInternalField(extraction.sourceField) &&
          !reportedStrippedRefs.has(extraction.sourceField)
        ) {
          const stripped = extraction.sourceField.replace(/^_+/, '');
          if (stripped && event.fields[stripped] !== undefined) {
            reportedStrippedRefs.add(extraction.sourceField);
            diagnostics.push({
              level: 'warning',
              message: `EXTRACT-${extraction.directive.className ?? ''} references source field "${extraction.sourceField}", but index-time extractions strip leading underscores — Splunk will resolve this as "${stripped}".`,
              file: 'props.conf',
              line: extraction.directive.line,
              directiveKey: extraction.directive.key,
              suggestion: `Replace "in ${extraction.sourceField}" with "in ${stripped}"`,
            });
          }
        }
        continue;
      }

      // Collect all matches; named groups captured more than once become arrays.
      const groupValues: Record<string, string[]> = {};
      for (const m of sourceValue.matchAll(extraction.regex)) {
        if (!m.groups) continue;
        for (const [name, value] of Object.entries(m.groups)) {
          if (value !== undefined) {
            (groupValues[name] ??= []).push(value);
          }
        }
      }

      const added: string[] = [];
      for (const [name, values] of Object.entries(groupValues)) {
        newFields[name] = values.length === 1 ? values[0] : values;
        added.push(name);
      }

      if (added.length > 0) {
        traces.push({
          processor: `EXTRACT-${extraction.directive.className ?? ''}`,
          phase: 'search-time',
          description: `Extracted fields: ${added.join(', ')}`,
          fieldsAdded: added,
        });
      }
    }

    return {
      ...event,
      fields: newFields,
      processingTrace: [...event.processingTrace, ...traces],
    };
  });
}

function parseExtractValue(value: string): { pattern: string; sourceField?: string } {
  const trimmed = value.trim();
  // Greedy match: consume as much as possible before the last " in <field>" suffix.
  // This avoids mis-splitting on regex bodies that contain the word "in".
  const inMatch = trimmed.match(/^([\s\S]+)\s+in\s+([\w.]+)\s*$/);
  if (inMatch) {
    return { pattern: inMatch[1], sourceField: inMatch[2] };
  }
  return { pattern: trimmed };
}

function getFieldValue(event: SplunkEvent, fieldName: string): string | undefined {
  if (fieldName === '_raw') return event._raw;
  const val = event.fields[fieldName];
  if (Array.isArray(val)) return val[0];
  return val;
}
