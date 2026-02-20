import type { SplunkEvent, ConfDirective } from '../types';
import { flattenJson } from '../utils/flattenJson';

export function applyKvMode(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const kvModeDir = directives.find((d) => d.key === 'KV_MODE');
  const mode = kvModeDir?.value.trim().toLowerCase() ?? 'auto';

  if (mode === 'none') return events;

  return events.map((event) => {
    const newFields = { ...event.fields };
    const added: string[] = [];

    switch (mode) {
      case 'json':
        extractJson(event._raw, newFields, added);
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
          description: `Extracted ${added.length} fields via KV_MODE=${mode}`,
          fieldsAdded: added,
        },
      ],
    };
  });
}

function extractJson(raw: string, fields: Record<string, string | string[]>, added: string[]): void {
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return;

    const jsonStr = raw.substring(jsonStart, jsonEnd + 1);
    const obj = JSON.parse(jsonStr);

    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      flattenJson(obj, fields, added);
    }
  } catch {
    // Not valid JSON, skip
  }
}

function extractXml(raw: string, fields: Record<string, string | string[]>, added: string[]): void {
  const tagRegex = /<(\w+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
  let match;
  while ((match = tagRegex.exec(raw)) !== null) {
    const key = match[1];
    const value = match[2].trim();
    if (key && value) {
      fields[key] = value;
      added.push(key);
    }
  }

  // Also extract attributes
  const attrRegex = /(\w+)="([^"]*)"/g;
  while ((match = attrRegex.exec(raw)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key && value && !fields[key]) {
      fields[key] = value;
      added.push(key);
    }
  }
}

function extractKeyValue(raw: string, fields: Record<string, string | string[]>, added: string[]): void {
  // Match key=value, key="value", key='value'
  const patterns = [
    /(?:^|[\s,;])(\w+)="([^"]*)"/g,
    /(?:^|[\s,;])(\w+)='([^']*)'/g,
    /(?:^|[\s,;])(\w+)=([\w.:\-/\\@#+]+)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      const key = match[1];
      const value = match[2];
      if (key && value !== undefined && !fields[key]) {
        fields[key] = value;
        added.push(key);
      }
    }
  }
}
