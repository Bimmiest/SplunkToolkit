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
  // Pass 0: Extract self-closing tags with attributes: <Tag Attr="Y"/>
  // e.g. <Provider Name="Microsoft-Windows-Security-Auditing" Guid="{...}"/>
  // e.g. <Execution ProcessId="3120" ThreadId="3240"/>
  // Splunk extracts attributes directly as field names; if an attribute is "Name",
  // use TagName as the field name to avoid a generic "Name" field
  const selfClosingRegex = /<(\w+)\s+((?:\w+="[^"]*"\s*)+)\/>/g;
  let match;

  while ((match = selfClosingRegex.exec(raw)) !== null) {
    const tagName = match[1];
    const attrString = match[2];
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const attrName = attrMatch[1];
      const attrValue = attrMatch[2];
      if (attrName && attrValue) {
        // "Name" attribute uses TagName as field (e.g. <Provider Name="X"/> → Provider_Name)
        // Other attributes use their name directly (e.g. <Execution ProcessId="3120"/> → ProcessId)
        const fieldName = attrName === 'Name' ? `${tagName}_Name` : attrName;
        if (!fields[fieldName]) {
          fields[fieldName] = attrValue;
          added.push(fieldName);
        }
      }
    }
  }

  // Pass 1: Extract <Tag Name="fieldName">value</Tag> patterns (e.g. Windows EventLog XML)
  // This must run before the generic tag extraction to handle <Data Name="X">val</Data> correctly
  const namedTagRegex = /<(\w+)\s+Name="([^"]+)"[^>]*>([^<]*)<\/\1>/g;
  const handledPositions = new Set<number>();

  while ((match = namedTagRegex.exec(raw)) !== null) {
    const fieldName = match[2];
    const value = match[3].trim();
    if (fieldName && value) {
      // Support multi-value: if same field name appears multiple times, collect as array
      addXmlField(fields, added, fieldName, value);
      handledPositions.add(match.index);
    }
  }

  // Pass 2: Extract simple <Tag>value</Tag> leaf nodes (no child elements)
  const tagRegex = /<(\w+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
  while ((match = tagRegex.exec(raw)) !== null) {
    if (handledPositions.has(match.index)) continue;

    const key = match[1];
    const value = match[2].trim();
    if (key && value) {
      addXmlField(fields, added, key, value);
    }
  }

  // Pass 3: Recursively extract from nested elements that contain children
  extractNestedXml(raw, fields, added);
}

/** Add a field value, supporting multi-value for duplicate field names */
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

/** Extract fields from XML elements that contain child elements (not just text) */
function extractNestedXml(raw: string, fields: Record<string, string | string[]>, added: string[]): void {
  // Find elements whose content contains other tags (i.e. parent elements)
  // Match opening tags, then find their closing tags accounting for nesting
  const openTagRegex = /<(\w+)(?:\s[^>]*)?>(?=[\s\S]*<)/g;
  let match;

  while ((match = openTagRegex.exec(raw)) !== null) {
    const tagName = match[1];
    const startAfterOpen = match.index + match[0].length;

    // Find the matching closing tag (handle nesting)
    const closeTag = `</${tagName}>`;
    let depth = 1;
    let pos = startAfterOpen;
    let found = false;

    while (pos < raw.length && depth > 0) {
      const nextOpen = raw.indexOf(`<${tagName}`, pos);
      const nextClose = raw.indexOf(closeTag, pos);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        // Check it's actually an opening tag (not a different tag starting with same name)
        const charAfterName = raw[nextOpen + tagName.length + 1];
        if (charAfterName === '>' || charAfterName === ' ' || charAfterName === '/') {
          depth++;
        }
        pos = nextOpen + 1;
      } else {
        depth--;
        if (depth === 0) {
          found = true;
          // The inner content is between startAfterOpen and nextClose
          const innerContent = raw.substring(startAfterOpen, nextClose);

          // Only process if inner content contains child tags (it's a parent)
          if (innerContent.includes('<') && !fields[tagName]) {
            // Recursively extract from inner content
            extractXmlInner(innerContent, fields, added, tagName);
          }
        }
        pos = nextClose + closeTag.length;
      }
    }

    if (!found) continue;
  }
}

/** Extract fields from inner XML content */
function extractXmlInner(content: string, fields: Record<string, string | string[]>, added: string[], _parentTag: string): void {
  let match;

  // Self-closing tags within nested content
  const selfClosingRegex = /<(\w+)\s+((?:\w+="[^"]*"\s*)+)\/>/g;
  while ((match = selfClosingRegex.exec(content)) !== null) {
    const tagName = match[1];
    const attrString = match[2];
    const attrRegex = /(\w+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      const fieldName = attrMatch[1] === 'Name' ? `${tagName}_Name` : attrMatch[1];
      if (attrMatch[2] && !fields[fieldName]) {
        fields[fieldName] = attrMatch[2];
        added.push(fieldName);
      }
    }
  }

  // Extract <Tag Name="fieldName">value</Tag> within nested content
  const namedTagRegex = /<(\w+)\s+Name="([^"]+)"[^>]*>([^<]*)<\/\1>/g;
  while ((match = namedTagRegex.exec(content)) !== null) {
    const fieldName = match[2];
    const value = match[3].trim();
    if (fieldName && value) {
      addXmlField(fields, added, fieldName, value);
    }
  }

  // Extract simple leaf <Tag>value</Tag> within nested content
  const tagRegex = /<(\w+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
  while ((match = tagRegex.exec(content)) !== null) {
    const key = match[1];
    const value = match[2].trim();
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
