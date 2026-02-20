import type { SplunkEvent, ConfDirective } from '../types';

export function applyFieldAliases(events: SplunkEvent[], directives: ConfDirective[]): SplunkEvent[] {
  const aliasDirectives = directives
    .filter((d) => d.directiveType === 'FIELDALIAS')
    .sort((a, b) => (a.className ?? '').localeCompare(b.className ?? ''));

  if (aliasDirectives.length === 0) return events;

  const aliases = aliasDirectives.flatMap((dir) => parseAliases(dir.value));

  if (aliases.length === 0) return events;

  return events.map((event) => {
    const newFields = { ...event.fields };
    const added: string[] = [];

    for (const alias of aliases) {
      const sourceValue = event.fields[alias.source];
      if (sourceValue === undefined) continue;

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
  const regex = /(\S+)\s+(AS(?:NEW)?)\s+(\S+)/gi;
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
