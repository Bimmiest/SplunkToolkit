import type { SplunkEvent, ConfDirective } from '../types';
import { flattenJson, flattenArray } from '../utils/flattenJson';
import { setField } from '../utils/fieldBag';

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

  // Splunk reads the header from the first *content* line of the file, so a
  // leading blank or comment line that became its own event must be skipped —
  // assuming `events[0]` is the header made every field name garbage whenever
  // the file opened with one.
  const headerIndex = events.findIndex((e) => isContentLine(e._raw));
  if (headerIndex === -1) return events;

  const headers = parseDelimitedLine(events[headerIndex]._raw, delimiter).map(sanitizeHeaderName);

  if (headers.length === 0) return events;

  // The header row is consumed as metadata — Splunk does not index it as an
  // event. Anything before it is preamble and is dropped with it.
  return events.slice(headerIndex + 1).map((event) => {
    const values = parseDelimitedLine(event._raw, delimiter);

    const fields = { ...event.fields };
    const added: string[] = [];

    for (let i = 0; i < headers.length && i < values.length; i++) {
      if (headers[i] && values[i]) {
        setField(fields, headers[i], values[i]);
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
      headers = fieldsMatch[1].trim().split(/\s+/).map(sanitizeHeaderName);
      break;
    }
  }

  if (headers.length === 0) return events;

  // Drop W3C directive/comment lines (#Version, #Fields, #Software, …) — they
  // are not indexed as events. A merged event carries its directive lines
  // inline, so test every line rather than only the first.
  return events
    .filter((event) => !isW3cDirectiveOnly(event._raw))
    .map((event) => {
    const values = parseW3cLine(event._raw);
    const fields = { ...event.fields };
    const added: string[] = [];

    for (let i = 0; i < headers.length && i < values.length; i++) {
      if (headers[i] && values[i] && values[i] !== '-') {
        setField(fields, headers[i], values[i]);
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

/** True for a line that carries data — not blank, not a `#` comment/directive. */
function isContentLine(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length > 0 && !trimmed.startsWith('#');
}

/** True when every line of the event is a W3C directive or blank. */
function isW3cDirectiveOnly(raw: string): boolean {
  return !raw.split(/\r?\n/).some(isContentLine);
}

/**
 * Normalise a structured-header token into the field name Splunk indexes.
 *
 * Splunk's structured-header processor replaces every character that is not
 * alphanumeric or `_` (props.conf.spec, `HEADER_FIELD_ACCEPTABLE_SPECIAL_CHARACTERS`),
 * and strips the leading underscores it reserves for internal fields. Keeping
 * the raw token meant a W3C/IIS log surfaced `cs-uri-stem`, which is not the
 * name anyone can search for — `cs_uri_stem` is.
 */
function sanitizeHeaderName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
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
