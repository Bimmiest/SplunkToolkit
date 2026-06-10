import type { SplunkEvent, ConfDirective } from '../types';
import { flattenJson, flattenArray } from '../utils/flattenJson';

export function applyKvMode(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const kvModeDir = directives.find((d) => d.key === 'KV_MODE');
  const mode = kvModeDir?.value.trim().toLowerCase() ?? 'auto';

  if (mode === 'none') return events;

  // AUTO_KV_JSON (default true): in auto / auto_escaped mode Splunk also extracts
  // JSON automatically when the whole event is JSON-formatted.
  const autoKvJsonDir = directives.find((d) => d.key === 'AUTO_KV_JSON');
  const autoKvJson = autoKvJsonDir ? autoKvJsonDir.value.trim().toLowerCase() !== 'false' : true;

  return events.map((event) => {
    const newFields = { ...event.fields };
    const added: string[] = [];
    let depthWarning = false;

    switch (mode) {
      case 'json':
        depthWarning = extractJson(event._raw, newFields, added);
        break;
      case 'xml':
        extractXml(event._raw, newFields, added);
        break;
      case 'multi':
        extractMultiKv(event._raw, newFields, added);
        break;
      case 'auto_escaped':
      case 'auto':
      default: {
        // Auto JSON extraction runs first so its leaf fields take precedence; the
        // key=value pass then fills in anything outside the JSON structure.
        if (autoKvJson) {
          const parsed = parseWholeJson(event._raw);
          if (parsed !== undefined) depthWarning = flattenParsed(parsed, newFields, added);
        }
        extractKeyValue(event._raw, newFields, added, mode === 'auto_escaped');
        break;
      }
    }

    if (added.length === 0) return event;

    return {
      ...event,
      fields: newFields,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: `KV_MODE(${mode})`,
          phase: 'search-time' as const,
          description: `Extracted ${added.length} fields via KV_MODE=${mode}${depthWarning ? ' (depth limit reached — deeply nested fields omitted)' : ''}`,
          fieldsAdded: added,
        },
      ],
    };
  });
}

function* jsonObjectCandidates(raw: string): Generator<string> {
  let searchFrom = 0;
  let attempts = 0;
  while (attempts < 5) {
    const start = raw.indexOf('{', searchFrom);
    if (start === -1) return;
    let depth = 0;
    let inString = false;
    let escape = false;
    let found = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { yield raw.slice(start, i + 1); found = true; break; }
      }
    }
    if (!found) return; // no closing brace found — nothing further to try
    searchFrom = start + 1;
    attempts++;
  }
}

/** Parse the whole event as JSON (object or array), or undefined if it isn't JSON. */
function parseWholeJson(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** Flatten an already-parsed JSON value (object or array). Returns true if depth limit hit. */
function flattenParsed(parsed: unknown, fields: Record<string, string | string[]>, added: string[]): boolean {
  if (Array.isArray(parsed)) return flattenArray(parsed, fields, added, '');
  if (parsed !== null && typeof parsed === 'object') {
    return flattenJson(parsed as Record<string, unknown>, fields, added);
  }
  return false;
}

function extractJson(raw: string, fields: Record<string, string | string[]>, added: string[]): boolean {
  // KV_MODE=json treats the event as structured JSON, so try to parse the whole
  // event first — this also covers top-level arrays, which the embedded-object
  // scan below would otherwise reduce to just their first element.
  const whole = parseWholeJson(raw);
  if (whole !== undefined) return flattenParsed(whole, fields, added);

  for (const candidate of jsonObjectCandidates(raw)) {
    try {
      const obj = JSON.parse(candidate);
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        return flattenJson(obj, fields, added);
      }
    } catch {
      // Not valid JSON at this position — try next candidate
    }
  }
  return false;
}

function addMvField(fields: Record<string, string | string[]>, added: string[], key: string, value: string): void {
  const existing = fields[key];
  if (existing !== undefined) {
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      fields[key] = [existing, value];
    }
  } else {
    fields[key] = value;
    added.push(key);
  }
}

function extractXml(raw: string, fields: Record<string, string | string[]>, added: string[]): void {
  // Wrap in a root element so DOMParser handles fragments without a single root.
  // DOMParser decodes entities, handles CDATA, and correctly matches multi-line content.
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(`<_root_>${raw}</_root_>`, 'text/xml');
  } catch {
    return;
  }
  // If parsing failed, the document contains a <parsererror> element.
  if (doc.querySelector('parsererror')) {
    // Try wrapping the raw text as-is in case it is already a valid document.
    try {
      doc = new DOMParser().parseFromString(raw, 'text/xml');
      if (doc.querySelector('parsererror')) return;
    } catch {
      return;
    }
  }

  walkXmlElement(doc.documentElement, fields, added, true);
}

function walkXmlElement(
  el: Element,
  fields: Record<string, string | string[]>,
  added: string[],
  isRoot: boolean,
): void {
  const tagName = el.localName;

  // Extract attributes.
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    // "Name" attribute on an element uses TagName_Name as field name (Windows EventLog convention).
    const fieldName = attr.name === 'Name' ? `${tagName}_Name` : attr.name;
    if (attr.value && fields[fieldName] === undefined) {
      fields[fieldName] = attr.value;
      added.push(fieldName);
    }
  }

  const children = Array.from(el.children);

  if (children.length === 0) {
    // Leaf node — extract text content as a field.
    const value = el.textContent?.trim() ?? '';
    // For <Tag Name="fieldName">value</Tag>, use the Name attribute as the field name.
    const nameAttr = el.getAttribute('Name');
    const fieldKey = nameAttr ?? (isRoot ? null : tagName);
    if (fieldKey && value) {
      addMvField(fields, added, fieldKey, value);
    }
  } else {
    // Parent node — recurse into children.
    for (const child of children) {
      walkXmlElement(child, fields, added, false);
    }
  }
}

function extractKeyValue(
  raw: string,
  fields: Record<string, string | string[]>,
  added: string[],
  escaped: boolean,
): void {
  // Match key=value, key="value", key='value'
  // Key character class broadened to include hyphen, dot, colon (e.g. x-forwarded-for=...)
  // In auto_escaped mode the quoted patterns allow backslash escapes inside the value
  // (e.g. key="say \"hi\""), which Splunk's auto_escaped KV_MODE honours.
  const doubleQuoted = escaped
    ? /(?:^|[\s,;])([\w.\-:]+)="((?:[^"\\]|\\.)*)"/g
    : /(?:^|[\s,;])([\w.\-:]+)="([^"]*)"/g;
  const singleQuoted = escaped
    ? /(?:^|[\s,;])([\w.\-:]+)='((?:[^'\\]|\\.)*)'/g
    : /(?:^|[\s,;])([\w.\-:]+)='([^']*)'/g;
  const bare = /(?:^|[\s,;])([\w.\-:]+)=([\w.:\-/\\@#+]+)/g;

  const patterns: Array<{ re: RegExp; unescape: boolean }> = [
    { re: doubleQuoted, unescape: escaped },
    { re: singleQuoted, unescape: escaped },
    { re: bare, unescape: false },
  ];

  for (const { re, unescape } of patterns) {
    for (const match of raw.matchAll(re)) {
      const key = match[1];
      let value = match[2];
      if (key && value !== undefined && fields[key] === undefined) {
        if (unescape) value = value.replace(/\\(["'\\])/g, '$1');
        fields[key] = value;
        added.push(key);
      }
    }
  }
}

/**
 * KV_MODE = multi (multikv): extract fields from a tabular event. The first
 * non-blank line is the column header; column boundaries are taken from the
 * start offset of each header token, and each subsequent row contributes one
 * value per column. Repeated rows accumulate into multivalue fields.
 *
 * This is a pragmatic subset of Splunk's multikv: it assumes space-aligned
 * columns and does not consult the multikv.conf table definitions.
 */
function extractMultiKv(raw: string, fields: Record<string, string | string[]>, added: string[]): void {
  const isSeparator = (line: string) => /^[\s\-=_|+]+$/.test(line);
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return;

  const header = lines[0];
  const cols: Array<{ name: string; start: number }> = [];
  for (const m of header.matchAll(/\S+/g)) {
    cols.push({ name: m[0], start: m.index ?? 0 });
  }
  if (cols.length < 2) return;

  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    if (isSeparator(line)) continue;
    for (let c = 0; c < cols.length; c++) {
      const start = cols[c].start;
      const end = c + 1 < cols.length ? cols[c + 1].start : line.length;
      const value = line.slice(start, end).trim();
      if (value) addMvField(fields, added, cols[c].name, value);
    }
  }
}
