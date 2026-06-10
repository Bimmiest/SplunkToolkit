import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';
import { isInternalField } from '../utils/internalFields';
import { safeRegex, escapeRegex } from '../../utils/splunkRegex';
import { byClassName } from '../utils/asciiCompare';

interface AliasMapping {
  source: string;
  target: string;
  mode: 'AS' | 'ASNEW';
}

interface CompiledAlias extends AliasMapping {
  directive: ConfDirective;
  /** Present when the alias uses `*` wildcards (positional, equal count both sides). */
  wildcard?: { sourceRegex: RegExp; targetSegments: string[] };
}

export function applyFieldAliases(
  events: SplunkEvent[],
  directives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): SplunkEvent[] {
  const aliasDirectives = directives
    .filter((d) => d.directiveType === 'FIELDALIAS')
    .sort(byClassName);

  if (aliasDirectives.length === 0) return events;

  const aliases = compileAliases(aliasDirectives, diagnostics);
  if (aliases.length === 0) return events;

  const reportedStrippedRefs = new Set<string>();

  return events.map((event) => {
    const newFields = { ...event.fields };
    const added: string[] = [];

    for (const alias of aliases) {
      if (alias.wildcard) {
        applyWildcardAlias(alias, event, newFields, added);
        continue;
      }

      const sourceValue = event.fields[alias.source];
      if (sourceValue === undefined) {
        maybeWarnStrippedRef(alias, event, diagnostics, reportedStrippedRefs);
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

/**
 * Apply a wildcard alias against every field on the event whose name matches the
 * source pattern. Each `*` in the source maps positionally to the corresponding
 * `*` in the target (e.g. `src_* AS dest_*` turns `src_ip` into `dest_ip`).
 */
function applyWildcardAlias(
  alias: CompiledAlias,
  event: SplunkEvent,
  newFields: Record<string, string | string[]>,
  added: string[],
): void {
  const { sourceRegex, targetSegments } = alias.wildcard!;
  for (const fieldName of Object.keys(event.fields)) {
    const m = sourceRegex.exec(fieldName);
    if (!m) continue;
    const captures = m.slice(1);
    let target = targetSegments[0];
    for (let i = 0; i < captures.length; i++) {
      target += captures[i] + (targetSegments[i + 1] ?? '');
    }
    if (!target || target === fieldName) continue;
    if (alias.mode === 'ASNEW' && newFields[target] !== undefined) continue;
    newFields[target] = event.fields[fieldName];
    added.push(`${target} (from ${fieldName})`);
  }
}

function compileAliases(
  aliasDirectives: ConfDirective[],
  diagnostics?: ValidationDiagnostic[],
): CompiledAlias[] {
  const compiled: CompiledAlias[] = [];
  for (const dir of aliasDirectives) {
    for (const a of parseAliases(dir.value)) {
      const srcStars = (a.source.match(/\*/g) ?? []).length;
      const tgtStars = (a.target.match(/\*/g) ?? []).length;

      if (srcStars === 0 && tgtStars === 0) {
        compiled.push({ ...a, directive: dir });
        continue;
      }

      // Splunk requires the number of wildcards to match on both sides.
      if (srcStars !== tgtStars) {
        diagnostics?.push({
          level: 'warning',
          message: `FIELDALIAS "${a.source} ${a.mode} ${a.target}" has mismatched wildcards — the number of "*" in the original (${srcStars}) and new (${tgtStars}) field names must be equal. Splunk skips this alias.`,
          file: 'props.conf',
          line: dir.line,
          directiveKey: dir.key,
        });
        continue;
      }

      const sourceRegex = safeRegex('^' + a.source.split('*').map(escapeRegex).join('(.*)') + '$');
      if (!sourceRegex) continue;
      compiled.push({ ...a, directive: dir, wildcard: { sourceRegex, targetSegments: a.target.split('*') } });
    }
  }
  return compiled;
}

function maybeWarnStrippedRef(
  alias: CompiledAlias,
  event: SplunkEvent,
  diagnostics: ValidationDiagnostic[] | undefined,
  reportedStrippedRefs: Set<string>,
): void {
  if (
    !diagnostics ||
    !alias.source.startsWith('_') ||
    isInternalField(alias.source) ||
    reportedStrippedRefs.has(alias.source)
  ) {
    return;
  }
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
