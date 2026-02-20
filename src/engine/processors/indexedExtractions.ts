import type { SplunkEvent, ConfDirective } from '../types';
import { flattenJson } from '../utils/flattenJson';

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
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return event;

      const fields = { ...event.fields };
      const added: string[] = [];

      flattenJson(obj, fields, added);

      return {
        ...event,
        fields,
        processingTrace: [
          ...event.processingTrace,
          {
            processor: 'INDEXED_EXTRACTIONS(json)',
            phase: 'index-time' as const,
            description: `Extracted ${added.length} JSON fields`,
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

  // First event's first line contains headers
  const firstRaw = events[0]._raw;
  const headerLine = firstRaw.split('\n')[0];
  const headers = parseDelimitedLine(headerLine, delimiter);

  if (headers.length === 0) return events;

  return events.map((event) => {
    const lines = event._raw.split('\n');
    const dataLine = lines.length > 1 ? lines[1] : lines[0];
    const values = parseDelimitedLine(dataLine, delimiter);

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
      headers = fieldsMatch[1].split(/\s+/);
      break;
    }
  }

  if (headers.length === 0) return events;

  return events.map((event) => {
    if (event._raw.startsWith('#')) return event;

    const values = event._raw.split(/\s+/);
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

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current.trim());
  return fields;
}
