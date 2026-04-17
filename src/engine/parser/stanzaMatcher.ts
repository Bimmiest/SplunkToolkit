import type { ConfStanza, EventMetadata } from '../types';
import { safeRegex, escapeRegex } from '../../utils/splunkRegex';

// Splunk stanza precedence (highest wins): source > host > sourcetype > default
const STANZA_PRIORITY: Record<ConfStanza['type'], number> = {
  default: 0,
  sourcetype: 1,
  host: 2,
  source: 3,
};

export function matchStanzas(stanzas: ConfStanza[], metadata: EventMetadata): ConfStanza[] {
  const matched: { stanza: ConfStanza; priority: number; specificity: number }[] = [];

  for (const stanza of stanzas) {
    switch (stanza.type) {
      case 'default':
        matched.push({ stanza, priority: STANZA_PRIORITY.default, specificity: 0 });
        break;

      case 'sourcetype':
        if (metadata.sourcetype && stanza.name === metadata.sourcetype) {
          matched.push({ stanza, priority: STANZA_PRIORITY.sourcetype, specificity: stanza.name.length });
        }
        break;

      case 'host':
        if (metadata.host && matchPattern(metadata.host, stanza.hostPattern ?? stanza.name, true)) {
          const specificity = getPatternSpecificity(stanza.hostPattern ?? stanza.name);
          matched.push({ stanza, priority: STANZA_PRIORITY.host, specificity });
        }
        break;

      case 'source':
        // source:: matching is case-sensitive in Splunk
        if (metadata.source && matchPattern(metadata.source, stanza.sourcePattern ?? stanza.name, false)) {
          const specificity = getPatternSpecificity(stanza.sourcePattern ?? stanza.name);
          matched.push({ stanza, priority: STANZA_PRIORITY.source, specificity });
        }
        break;
    }
  }

  matched.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.specificity - a.specificity;
  });

  return matched.map((m) => m.stanza);
}

function matchPattern(value: string, pattern: string, caseInsensitive: boolean): boolean {
  const regexStr = patternToRegex(pattern);
  const regex = safeRegex(`^${regexStr}$`, caseInsensitive ? 'i' : undefined);
  if (regex) return regex.test(value);
  return caseInsensitive ? value.toLowerCase() === pattern.toLowerCase() : value === pattern;
}

function patternToRegex(pattern: string): string {
  let result = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.substring(i, i + 3) === '...') {
      result += '.*';
      i += 3;
    } else if (pattern[i] === '*') {
      result += '[^/\\\\]*';
      i++;
    } else if (pattern[i] === '?') {
      result += '[^/\\\\]';
      i++;
    } else {
      result += escapeRegex(pattern[i]);
      i++;
    }
  }
  return result;
}

function getPatternSpecificity(pattern: string): number {
  let score = 0;
  for (const ch of pattern) {
    if (ch !== '*' && ch !== '?' && ch !== '.') {
      score++;
    }
  }
  return score;
}

export function getDirectiveValue(stanzas: ConfStanza[], key: string): string | undefined {
  for (const stanza of stanzas) {
    for (const directive of stanza.directives) {
      if (directive.key === key) return directive.value;
    }
  }
  return undefined;
}

export function getDirectivesByType(stanzas: ConfStanza[], directiveType: string): import('../types').ConfDirective[] {
  const results: import('../types').ConfDirective[] = [];
  for (const stanza of stanzas) {
    for (const directive of stanza.directives) {
      if (directive.directiveType === directiveType) {
        results.push(directive);
      }
    }
  }
  return results;
}

export function mergeDirectives(stanzas: ConfStanza[]): import('../types').ConfDirective[] {
  const seen = new Map<string, import('../types').ConfDirective>();
  // Iterate in precedence order (highest first), so first match wins
  for (const stanza of stanzas) {
    for (const directive of stanza.directives) {
      if (!seen.has(directive.key)) {
        seen.set(directive.key, directive);
      }
    }
  }
  return Array.from(seen.values());
}
