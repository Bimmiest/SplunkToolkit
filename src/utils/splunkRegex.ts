/**
 * Utilities for working with Splunk regex patterns.
 */

/** Escape a literal string for use inside a RegExp. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert Splunk Python-style (?P<name>...) named groups to JS (?<name>...) syntax. */
export function convertSplunkToJsRegex(pattern: string): string {
  return pattern.replace(/\(\?P<(\w+)>/g, '(?<$1>');
}

/** Inline flag letters JS can represent (i = ignore-case, m = multiline, s = dotall). */
const JS_REPRESENTABLE_INLINE_FLAGS = 'ims';
/** All PCRE inline mode-modifier letters we recognise as a flag group (others are dropped). */
const PCRE_INLINE_FLAG_LETTERS = 'imsxuUJADX';

/**
 * Translate the subset of PCRE (Splunk regex) syntax that the JS engine does not
 * accept into an equivalent JS form, returning the rewritten source plus any
 * flags that must be applied. Without this, common Splunk patterns throw at
 * compile time and `safeRegex` returns null, silently producing no extraction.
 *
 * Handled:
 *  - `(?P<name>…)` / `(?P=name)`  → `(?<name>…)` / `\k<name>`
 *  - inline flag groups `(?i)`, `(?ims)` → merged into the flags (applied globally;
 *    JS has no scoped inline flags, which is correct for the common leading case)
 *  - atomic groups `(?>…)`        → non-capturing `(?:…)` (loses atomicity only)
 *  - possessive quantifiers `a++`, `\d*+`, `x?+`, `{2,3}+` → greedy equivalents
 *
 * Not handled (still throw → null): conditionals `(?(…)…)`, recursion, `\p{…}`
 * outside unicode mode, POSIX classes `[[:alpha:]]`.
 */
export function translatePcreToJs(pattern: string, flags = ''): { source: string; flags: string } {
  let source = pattern;
  let extraFlags = '';

  // Python-style named groups and backreferences.
  source = source.replace(/\(\?P<(\w+)>/g, '(?<$1>');
  source = source.replace(/\(\?P=(\w+)\)/g, '\\k<$1>');

  // Inline flag groups: (?i), (?ims) … — strip and hoist representable flags.
  source = source.replace(/\(\?([a-zA-Z]+)\)/g, (whole, letters: string) => {
    if (![...letters].every((c) => PCRE_INLINE_FLAG_LETTERS.includes(c))) {
      return whole; // not a recognised flag group — leave it for the compiler to reject
    }
    for (const c of letters) {
      if (JS_REPRESENTABLE_INLINE_FLAGS.includes(c) && !extraFlags.includes(c)) {
        extraFlags += c;
      }
    }
    return '';
  });

  // Atomic groups → non-capturing (JS lacks atomic groups before ES2025).
  source = source.replace(/\(\?>/g, '(?:');

  // Possessive quantifiers → greedy. The (?<!\\) guard avoids touching an escaped
  // literal quantifier char (e.g. `\++` = "one or more literal plus", valid in JS).
  source = source.replace(/(?<!\\)([*+?}])\+/g, '$1');

  let mergedFlags = flags;
  for (const c of extraFlags) {
    if (!mergedFlags.includes(c)) mergedFlags += c;
  }

  return { source, flags: mergedFlags };
}

/**
 * Patterns that exhibit catastrophic backtracking when applied to long input.
 * Reject these before compiling to prevent main-thread hangs.
 *
 * Heuristic: an unescaped capturing or non-capturing group whose body itself
 * contains a `+` or `*` quantifier, followed by another `+` or `*` on the group.
 * Examples: (a+)+  (\w+)+  (.+)+  (?:\d*)*
 */
const REDOS_RE = /\((?:[^()\\]|\\.)*[+*][^()]*\)[+*]/;

export function hasReDoSRisk(pattern: string): boolean {
  return REDOS_RE.test(pattern);
}

/**
 * Safely compile a regex pattern, returning null on invalid patterns
 * or patterns with known ReDoS risk.
 */
export function safeRegex(pattern: string, flags?: string): RegExp | null {
  const { source, flags: mergedFlags } = translatePcreToJs(pattern, flags ?? '');
  if (hasReDoSRisk(source)) return null;
  try {
    return new RegExp(source, mergedFlags);
  } catch {
    return null;
  }
}

/**
 * Validate a regex pattern string.
 *
 * @returns An error message describing why the pattern is invalid, or `null`
 *          if the pattern compiles successfully.
 */
export function validateRegex(pattern: string): string | null {
  const { source, flags } = translatePcreToJs(pattern);
  if (hasReDoSRisk(source)) {
    return 'Pattern contains a structure prone to catastrophic backtracking (ReDoS risk).';
  }
  try {
    new RegExp(source, flags);
    return null;
  } catch (e: unknown) {
    if (e instanceof SyntaxError) {
      return e.message;
    }
    return String(e);
  }
}
