import type { ConfStanza, EventMetadata } from '../types';
import { safeRegex, escapeRegex } from '../../utils/splunkRegex';

// Splunk stanza precedence (highest wins): source > host > sourcetype > default
const STANZA_PRIORITY: Record<ConfStanza['type'], number> = {
  default: 0,
  sourcetype: 1,
  host: 2,
  source: 3,
};

/**
 * Splunk's documented default `priority` per stanza kind: 100 for the
 * pattern-matched `[host::…]` and `[source::…]` stanzas, 0 for `[<sourcetype>]`.
 *
 * These exist so that an explicit `priority` is measured on the same scale
 * Splunk measures it on — a `priority = 50` on a sourcetype stanza is meant to
 * lose to an undeclared `source::` stanza, and would beat it if undeclared
 * stanzas were treated as 0 across the board.
 *
 * With no stanza declaring a priority this changes nothing: source and host tie
 * at 100 and are separated by STANZA_PRIORITY exactly as before, and sourcetype
 * ties with default and is separated the same way.
 */
const DEFAULT_PRIORITY: Record<ConfStanza['type'], number> = {
  default: 0,
  sourcetype: 0,
  host: 100,
  source: 100,
};

/** Splunk's boolean spellings. Anything unrecognised reads as false, as it does there. */
function isTruthy(value: string): boolean {
  return ['1', 'true', 't', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

/**
 * A stanza switched off with `disabled = 1` takes no part in resolution at all.
 *
 * Last definition wins within the stanza, matching `mergeDirectives` — and
 * mattering here for a layered conf, where `local/` re-enabling something
 * `default/` disabled is the whole point of writing it.
 */
export function isStanzaDisabled(stanza: ConfStanza): boolean {
  const declared = stanza.directives.filter((d) => d.key === 'disabled').at(-1);
  return declared !== undefined && isTruthy(declared.value);
}

/** The effective precedence number for a stanza: explicit `priority`, or its kind's default. */
function stanzaPriority(stanza: ConfStanza): number {
  const declared = stanza.directives.filter((d) => d.key === 'priority').at(-1);
  if (declared) {
    const parsed = Number.parseInt(declared.value.trim(), 10);
    // A malformed priority is ignored rather than treated as 0, which would
    // silently demote a source:: stanza below every sourcetype stanza.
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_PRIORITY[stanza.type];
}

export function matchStanzas(stanzas: ConfStanza[], metadata: EventMetadata): ConfStanza[] {
  const matched: {
    stanza: ConfStanza;
    explicitPriority: number;
    priority: number;
    specificity: number;
  }[] = [];

  for (const stanza of stanzas) {
    if (isStanzaDisabled(stanza)) continue;

    switch (stanza.type) {
      case 'default':
        matched.push({
          stanza,
          explicitPriority: stanzaPriority(stanza),
          priority: STANZA_PRIORITY.default,
          specificity: 0,
        });
        break;

      case 'sourcetype':
        if (metadata.sourcetype && stanza.name === metadata.sourcetype) {
          matched.push({
            stanza,
            explicitPriority: stanzaPriority(stanza),
            priority: STANZA_PRIORITY.sourcetype,
            specificity: stanza.name.length,
          });
        }
        break;

      case 'host':
        if (metadata.host && matchPattern(metadata.host, stanza.hostPattern ?? stanza.name, true)) {
          const specificity = getPatternSpecificity(stanza.hostPattern ?? stanza.name);
          matched.push({
            stanza,
            explicitPriority: stanzaPriority(stanza),
            priority: STANZA_PRIORITY.host,
            specificity,
          });
        }
        break;

      case 'source':
        // source:: matching is case-sensitive in Splunk
        if (metadata.source && matchPattern(metadata.source, stanza.sourcePattern ?? stanza.name, false)) {
          const specificity = getPatternSpecificity(stanza.sourcePattern ?? stanza.name);
          matched.push({
            stanza,
            explicitPriority: stanzaPriority(stanza),
            priority: STANZA_PRIORITY.source,
            specificity,
          });
        }
        break;
    }
  }

  // `priority` outranks the stanza-kind ordering, which is what makes it useful:
  // it exists precisely so a config can invert the usual source > host >
  // sourcetype ranking. Kind and specificity then break ties among stanzas that
  // share a priority, which is every stanza until one declares otherwise.
  matched.sort((a, b) => {
    if (a.explicitPriority !== b.explicitPriority) return b.explicitPriority - a.explicitPriority;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.specificity - a.specificity;
  });

  return matched.map((m) => m.stanza);
}

/**
 * Resolve the stanzas that apply to an event, honouring an input-time
 * `sourcetype` assignment.
 *
 * `sourcetype = <name>` inside a `[source::…]` or `[host::…]` stanza is how
 * Splunk assigns a sourcetype at input, before any of the props resolution that
 * depends on it. So the assignment cannot be read out of the resolved directive
 * set — reading it there would mean resolving against the sourcetype it is
 * about to replace. Matching runs twice instead: once to find the assignment,
 * then again against the sourcetype it names.
 *
 * Returns the metadata actually used, so callers can report and carry the
 * rewritten sourcetype rather than the one they passed in.
 */
export function resolveStanzasForEvent(
  stanzas: ConfStanza[],
  metadata: EventMetadata,
): { stanzas: ConfStanza[]; metadata: EventMetadata; assignedSourcetype?: string } {
  const first = matchStanzas(stanzas, metadata);

  // Only a pattern-matched stanza can assign a sourcetype: on a `[<sourcetype>]`
  // stanza the key would be naming the sourcetype it already matched, and Splunk
  // uses `rename` for that instead.
  const assignment = first
    .filter((s) => s.type === 'source' || s.type === 'host')
    .flatMap((s) => s.directives.filter((d) => d.key === 'sourcetype').slice(-1))
    .at(0);

  const assigned = assignment?.value.trim();
  if (!assigned || assigned === metadata.sourcetype) {
    return { stanzas: first, metadata };
  }

  const rewritten = { ...metadata, sourcetype: assigned };
  // Matched once more and not iterated: the newly matched `[<sourcetype>]`
  // stanza cannot assign a sourcetype (see above), so a second pass is the
  // fixed point rather than one step of a loop that might not terminate.
  return { stanzas: matchStanzas(stanzas, rewritten), metadata: rewritten, assignedSourcetype: assigned };
}

/**
 * The sourcetype a `rename` points at, if the resolved stanzas declare one.
 *
 * `rename` applies at SEARCH time only: the events keep the sourcetype they were
 * indexed with, and only search-time configuration is read from the target. It
 * is also not a merge — Splunk documents that a renamed sourcetype uses the
 * target's search-time configuration and *not* the original's, so an EXTRACT on
 * the original stanza stops applying. That is the surprising half, and the
 * reason a config using `rename` is worth simulating rather than approximating.
 */
export function getRenamedSourcetype(matchedStanzas: ConfStanza[]): string | undefined {
  for (const stanza of matchedStanzas) {
    const declared = stanza.directives.filter((d) => d.key === 'rename').at(-1);
    const value = declared?.value.trim();
    if (value) return value;
  }
  return undefined;
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
