import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';
import { isInternalField } from '../utils/internalFields';

export function applyFieldAliases(
  events: SplunkEvent[],
  directives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const aliasDirectives = directives
    .filter((d) => d.directiveType === 'FIELDALIAS')
    .sort((a, b) => (a.className ?? '').localeCompare(b.className ?? ''));

  if (aliasDirectives.length === 0) return events;

  const aliases = aliasDirectives.flatMap((dir) =>
    parseAliases(dir.value).map((alias) => ({ ...alias, directive: dir })),
  );

  if (aliases.length === 0) return events;

  const reportedStrippedRefs = new Set<string>();

  return events.map((event) => {
    const newFields = { ...event.fields };
    const added: string[] = [];

    for (const alias of aliases) {
      const sourceValue = event.fields[alias.source];
      if (sourceValue === undefined) {
        if (
          diagnostics &&
          alias.source.startsWith('_') &&
          !isInternalField(alias.source) &&
          !reportedStrippedRefs.has(alias.source)
        ) {
          const stripped = alias.source.replace(/^_+/, '');
          if (stripped && event.fields[stripped] !== undefined) {
            reportedStrippedRefs.add(alias.source);
            diagnostics.push({
              level: 'warning',
              message: `FIELDALIAS references "${alias.source}", but index-time extractions strip leading underscores — Splunk will resolve this as "${stripped}". Update the alias to use "${stripped}".`,
              file: 'props.conf',
              line: alias.directive.line,
              directiveKey: alias.directive.key,
              suggestion: `Replace "${alias.source}" with "${stripped}"`,
            });
          }
        }
        continue;
      }

      if (alias.mode === 'ASNEW' && newFields[alias.target] !== undefined) {
        continue;
      }

      newFields[alias.target] = sourceValue;
      added.push(`${alias.target} (from ${alias.source})`);
    }

    if (added.length === 0) return event;

    return {
      ...event,
      fields: newFields,
      processingTrace: [
        ...event.processingTrace,
        {
          processor: 'FIELDALIAS',
          phase: 'search-time' as const,
          description: `Created aliases: ${added.join(', ')}`,
          fieldsAdded: added.map((a) => a.split(' ')[0]),
        },
      ],
    };
  });
}

interface AliasMapping {
  source: string;
  target: string;
  mode: 'AS' | 'ASNEW';
}

function parseAliases(value: string): AliasMapping[] {
  const aliases: AliasMapping[] = [];
  // Match patterns: field1 AS field2, field1 ASNEW field2
  const regex = /(\S+)\s+\b(AS(?:NEW)?)\b\s+(\S+)/gi;
  let match;

  while ((match = regex.exec(value)) !== null) {
    aliases.push({
      source: match[1],
      target: match[3],
      mode: match[2].toUpperCase() as 'AS' | 'ASNEW',
    });
  }

  return aliases;
}
