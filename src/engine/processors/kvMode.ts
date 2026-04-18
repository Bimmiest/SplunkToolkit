import type { SplunkEvent, ConfDirective } from '../types';
import { flattenJson } from '../utils/flattenJson';

export function applyKvMode(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const kvModeDir = directives.find((d) => d.key === 'KV_MODE');
  const mode = kvModeDir?.value.trim().toLowerCase() ?? 'auto';

  if (mode === 'none') return events;

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
      case 'auto':
      default:
        extractKeyValue(event._raw, newFields, added);
        break;
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

function extractJson(raw: string, fields: Record<string, string | string[]>, added: string[]): boolean {
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

function addXmlField(fields: Record<string, string | string[]>, added: string[], key: string, value: string): void {
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
    if (attr.value && !fields[fieldName]) {
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
      addXmlField(fields, added, fieldKey, value);
    }
  } else {
    // Parent node — recurse into children.
    for (const child of children) {
      walkXmlElement(child, fields, added, false);
    }
  }
}

function extractKeyValue(raw: string, fields: Record<string, string | string[]>, added: string[]): void {
  // Match key=value, key="value", key='value'
  // Key character class broadened to include hyphen, dot, colon (e.g. x-forwarded-for=...)
  const patterns = [
    /(?:^|[\s,;])([\w.\-:]+)="([^"]*)"/g,
    /(?:^|[\s,;])([\w.\-:]+)='([^']*)'/g,
    /(?:^|[\s,;])([\w.\-:]+)=([\w.:\-/\\@#+]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const key = match[1];
      const value = match[2];
      if (key && value !== undefined && !fields[key]) {
        fields[key] = value;
        added.push(key);
      }
    }
  }
}
