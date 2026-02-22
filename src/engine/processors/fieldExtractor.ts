import type { SplunkEvent, ConfDirective } from '../types';
import { safeRegex } from '../../utils/splunkRegex';

export function extractFields(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const extractDirectives = directives
    .filter((d) => d.directiveType === 'EXTRACT')
    .sort((a, b) => (a.className ?? '').localeCompare(b.className ?? ''));

  if (extractDirectives.length === 0) return events;

  const extractions = extractDirectives.map((dir) => {
    const { pattern, sourceField } = parseExtractValue(dir.value);
    const jsPattern = pattern ? convertSplunkToJsRegex(pattern) : null;
    const regex = jsPattern ? safeRegex(jsPattern) : null;
    return { directive: dir, regex, sourceField };
  });

  return events.map((event) => {
    const newFields = { ...event.fields };
    const traces: SplunkEvent['processingTrace'] = [];

    for (const extraction of extractions) {
      if (!extraction.regex) continue;

      const sourceValue = extraction.sourceField
        ? getFieldValue(event, extraction.sourceField)
        : event._raw;

      if (!sourceValue) continue;

      extraction.regex.lastIndex = 0;
      const match = extraction.regex.exec(sourceValue);
      if (!match?.groups) continue;

      const added: string[] = [];
      for (const [name, value] of Object.entries(match.groups)) {
        if (value !== undefined) {
          newFields[name] = value;
          added.push(name);
        }
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
  const inMatch = trimmed.match(/^(.+?)\s+in\s+(\w+)\s*$/);
  if (inMatch) {
    return { pattern: inMatch[1], sourceField: inMatch[2] };
  }
  return { pattern: trimmed };
}

/** Convert Splunk Python-style (?P<name>...) to JS (?<name>...) */
function convertSplunkToJsRegex(pattern: string): string {
  return pattern.replace(/\(\?P<(\w+)>/g, '(?<$1>');
}

function getFieldValue(event: SplunkEvent, fieldName: string): string | undefined {
  if (fieldName === '_raw') return event._raw;
  const val = event.fields[fieldName];
  if (Array.isArray(val)) return val[0];
  return val;
}
