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

/**
 * Case-insensitive matching lower-cases both sides rather than compiling with
 * `'i'`, which is equivalent here and keeps the regex eligible for V8's
 * linear-time fallback — that engine cannot compile a pattern carrying `d`, `i`
 * or `u`, and stanza matching runs per event.
 *
 * Equivalent *here* specifically because `patternToRegex` can only emit `.*`,
 * `[^/\\]*`, `[^/\\]` and `escapeRegex(char)`, and `escapeRegex` only ever
 * backslashes a metacharacter — none of which are letters. So there is no
 * case-bearing escape (`\w`, `\W`, `\s`, `\S`) for lower-casing to invert — a
 * risk that would be real if this built patterns from arbitrary regex source.
 *
 * The residue is Unicode case folding: `toLowerCase()` and the `'i'` flag
 * disagree on a handful of characters (Turkish dotless i, `ß`/`SS`). Splunk
 * `source::`/`host::` specs are host names and file paths, so this is theory
 * rather than practice — but it is the reason to keep it to this function.
 */
function matchPattern(value: string, pattern: string, caseInsensitive: boolean): boolean {
  const subject = caseInsensitive ? value.toLowerCase() : value;
  const spec = caseInsensitive ? pattern.toLowerCase() : pattern;
  const regex = safeRegex(`^${patternToRegex(spec)}$`);
  if (regex) return regex.test(subject);
  return subject === spec;
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
      result += escapeRegex(pattern.charAt(i));
      i++;
    }
  }
  return result;
}

function getPatternSpecificity(pattern: string): number {
  // Score literal characters; wildcards contribute nothing. Mirror
  // patternToRegex's tokenisation exactly: only `*`, `?`, and the `...`
  // multi-segment wildcard are wildcards — a lone `.` is a LITERAL dot (Splunk
  // source::/host:: syntax), so it must count. Otherwise `host::a.b.c.d` scores
  // below a shorter all-literal pattern and can wrongly lose precedence.
  let score = 0;
  let i = 0;
  while (i < pattern.length) {
    if (pattern.substring(i, i + 3) === '...') {
      i += 3;
    } else if (pattern[i] === '*' || pattern[i] === '?') {
      i++;
    } else {
      score++;
      i++;
    }
  }
  return score;
}

/**
 * Value of `key` for a set of already-matched stanzas (highest precedence
 * first).
 *
 * Across stanzas the first match wins; WITHIN a stanza the LAST definition wins,
 * for the same reason `mergeDirectives` does it that way — that is Splunk's rule
 * for a key repeated in a file, and it is also what makes a `local/` layer
 * override the `default/` one it was concatenated after. Taking the first match
 * within the stanza would silently return the lower layer's value.
 */
export function getDirectiveValue(stanzas: ConfStanza[], key: string): string | undefined {
  for (const stanza of stanzas) {
    let value: string | undefined;
    for (const directive of stanza.directives) {
      if (directive.key === key) value = directive.value;
    }
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Every directive of `directiveType` across the matched stanzas, in stanza
 * precedence order. This does NOT resolve overrides — for a layered conf a key
 * redefined in `local/` appears alongside the `default/` definition it beat, and
 * the loser carries `overriddenBy`. Callers that want only the winners should go
 * through `mergeDirectives`.
 */
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
  // Stanzas arrive in precedence order (highest first), so across stanzas the
  // first match wins. WITHIN a single stanza, however, a repeated key takes its
  // LAST value — Splunk's documented "last definition in the file wins" rule.
  //
  // For a layered conf the layers were concatenated lowest-precedence-first, so
  // that same rule is what makes `local/` beat `default/`; the returned directive
  // carries the `layer` it won from and the `overrides` it beat.
  for (const stanza of stanzas) {
    const stanzaLatest = new Map<string, import('../types').ConfDirective>();
    for (const directive of stanza.directives) {
      stanzaLatest.set(directive.key, directive);
    }
    for (const [key, directive] of stanzaLatest) {
      if (!seen.has(key)) {
        seen.set(key, directive);
      }
    }
  }
  return Array.from(seen.values());
}
