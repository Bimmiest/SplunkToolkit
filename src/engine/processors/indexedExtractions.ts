import type { SplunkEvent, ConfDirective } from '../types';
import { flattenJson, flattenArray } from '../utils/flattenJson';

export function applyIndexedExtractions(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const extractionDir = directives.find((d) => d.key === 'INDEXED_EXTRACTIONS');
  if (!extractionDir) return events;

  const mode = extractionDir.value.trim().toLowerCase();

  switch (mode) {
    case 'json':
      return extractJsonFields(events);
    case 'csv':
      return extractDelimited(events, ',', 'csv');
    case 'tsv':
      return extractDelimited(events, '\t', 'tsv');
    case 'psv':
      return extractDelimited(events, '|', 'psv');
    case 'w3c':
      return extractW3c(events);
    default:
      return events;
  }
}

function extractJsonFields(events: SplunkEvent[]): SplunkEvent[] {
  return events.map((event) => {
    try {
      const obj = JSON.parse(event._raw);
      if (typeof obj !== 'object' || obj === null) return event;

      const fields = { ...event.fields };
      const added: string[] = [];
      const sourceKeys: Record<string, string> = {};
      const opts = { stripLeadingUnderscore: true, sourceKeys };
      const depthTruncated = Array.isArray(obj)
        ? flattenArray(obj, fields, added, '', 0, opts)
        : flattenJson(obj, fields, added, '', 0, opts);

      return {
        ...event,
        fields,
        fieldSourceKeys: { ...event.fieldSourceKeys, ...sourceKeys },
        processingTrace: [
          ...event.processingTrace,
          {
            processor: 'INDEXED_EXTRACTIONS(json)',
            phase: 'index-time' as const,
            description: `Extracted ${added.length} JSON fields${depthTruncated ? ' (depth limit reached — deeply nested fields omitted)' : ''}`,
            fieldsAdded: added,
          },
        ],
      };
    } catch {
      return event;
    }
  });
}

function extractDelimited(events: SplunkEvent[], delimiter: string, mode: string): SplunkEvent[] {
  if (events.length === 0) return events;

  // The first event is the header row (produced by LINE_BREAKER splitting the file).
  // All subsequent events are data rows. This matches Splunk's INDEXED_EXTRACTIONS
  // behaviour: headers are read once from the first line and applied to every data event.
  const headers = parseDelimitedLine(events[0]._raw, delimiter).map(stripLeadingUnderscore);

  if (headers.length === 0) return events;

  // The header row is consumed as metadata — Splunk does not index it as an event.
  return events.slice(1).map((event) => {
    const values = parseDelimitedLine(event._raw, delimiter);

    const fields = { ...event.fields };
    const added: string[] = [];

    for (let i = 0; i < headers.length && i < values.length; i++) {
      if (headers[i] && values[i]) {
        fields[headers[i]] = values[i];
        added.push(headers[i]);
      }
    }

    return {
      ...event,
      fields,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: `INDEXED_EXTRACTIONS(${mode})`,
          phase: 'index-time' as const,
          description: `Extracted ${added.length} fields from ${mode.toUpperCase()}`,
          fieldsAdded: added,
        },
      ],
    };
  });
}

function extractW3c(events: SplunkEvent[]): SplunkEvent[] {
  // W3C format: header line starts with #Fields:
  let headers: string[] = [];

  for (const event of events) {
    const fieldsMatch = event._raw.match(/^#Fields:\s*(.+)$/m);
    if (fieldsMatch) {
      headers = fieldsMatch[1].split(/\s+/).map(stripLeadingUnderscore);
      break;
    }
  }

  if (headers.length === 0) return events;

  // Drop W3C directive/comment lines (#Version, #Fields, #Software, …) — they
  // are not indexed as events.
  return events
    .filter((event) => !event._raw.startsWith('#'))
    .map((event) => {
    const values = parseW3cLine(event._raw);
    const fields = { ...event.fields };
    const added: string[] = [];

    for (let i = 0; i < headers.length && i < values.length; i++) {
      if (headers[i] && values[i] && values[i] !== '-') {
        fields[headers[i]] = values[i];
        added.push(headers[i]);
      }
    }

    return {
      ...event,
      fields,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'INDEXED_EXTRACTIONS(w3c)',
          phase: 'index-time' as const,
          description: `Extracted ${added.length} W3C fields`,
          fieldsAdded: added,
        },
      ],
    };
  });
}

function stripLeadingUnderscore(name: string): string {
  return name.replace(/^_+/, '');
}

/**
 * Split a W3C/IIS log line on unquoted whitespace, keeping double-quoted fields
 * (e.g. a User-Agent containing spaces) intact and stripping the surrounding
 * quotes. A plain `.split(/\s+/)` would tear quoted values into several columns.
 */
function parseW3cLine(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  // Quoted fields preserve their interior whitespace; unquoted fields are trimmed.
  let fieldQuoted = false;

  const pushField = () => {
    fields.push(fieldQuoted ? current : current.trim());
    current = '';
    fieldQuoted = false;
  };

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        if (inQuotes) fieldQuoted = true;
      }
    } else if (ch === delimiter && !inQuotes) {
      pushField();
    } else {
      current += ch;
    }
  }

  pushField();
  return fields;
}
