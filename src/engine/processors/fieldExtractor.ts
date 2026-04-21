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
    // 'g' for matchAll, 'd' so match.indices records capture offsets for positional extractions.
    const regex = jsPattern ? safeRegex(jsPattern, 'gd') : null;
    return { directive: dir, regex, sourceField };
  });

  const reportedStrippedRefs = new Set<string>();

  return events.map((event) => {
    const newFields = { ...event.fields };
    const newOffsets: Record<string, Array<[number, number]>> = { ...(event.fieldOffsets ?? {}) };
    let offsetsChanged = false;
    const traces: SplunkEvent['processingTrace'] = [];

    for (const extraction of extractions) {
      if (!extraction.regex) continue;

      const sourceValue = extraction.sourceField
        ? getFieldValue(event, extraction.sourceField)
        : event._raw;
      // Offsets only authoritative when extracting from _raw — a captured position in a
      // derived source field cannot be translated back to _raw coordinates reliably.
      const isPositional = !extraction.sourceField;

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
      const groupOffsets: Record<string, Array<[number, number]>> = {};
      for (const m of sourceValue.matchAll(extraction.regex)) {
        if (!m.groups) continue;
        const indices = isPositional
          ? (m as RegExpMatchArray & { indices?: { groups?: Record<string, [number, number] | undefined> } }).indices?.groups
          : undefined;
        for (const [name, value] of Object.entries(m.groups)) {
          if (value !== undefined) {
            (groupValues[name] ??= []).push(value);
            const span = indices?.[name];
            if (span) (groupOffsets[name] ??= []).push([span[0], span[1]]);
          }
        }
      }

      const added: string[] = [];
      for (const [name, values] of Object.entries(groupValues)) {
        newFields[name] = values.length === 1 ? values[0] : values;
        added.push(name);
        const offsets = groupOffsets[name];
        if (offsets && offsets.length > 0) {
          newOffsets[name] = offsets;
          offsetsChanged = true;
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
      ...(offsetsChanged ? { fieldOffsets: newOffsets } : {}),
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
