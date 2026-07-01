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
 * Best-effort detection of patterns that exhibit catastrophic backtracking on
 * long input. These are rejected before compiling so they never execute — the
 * live regex testers (RegexTab / ExtractNameDialog) run on the main thread,
 * where the 5 s Web Worker watchdog does NOT apply, so a hang there freezes the
 * tab with no recovery.
 *
 * This is a heuristic, not a complete ReDoS analysis. It catches:
 *  1. A quantified group whose body has its own `*`/`+` (nested/grouped
 *     ambiguity), where the outer quantifier is `*`, `+`, or a `{n[,m]}` bound.
 *     Examples: `(a+)+`, `(\w+)*`, `(.+)+`, `(?:\d*)*`, `(.*,){20}`.
 *  2. Two adjacent unbounded quantifiers on the SAME atom. Examples: `a*a*`,
 *     `\d+\d+` — and by extension long runs like `a*a*a*a*c`.
 *
 * It does NOT catch alternation-overlap forms such as `(a|aa)+`: flagging those
 * without also rejecting benign alternations like `(foo|bar)+` needs a real
 * overlap analysis. Such patterns remain covered by the worker watchdog for the
 * main pipeline, but not for the main-thread live testers.
 */
const REDOS_NESTED_GROUP = /\((?:[^()\\]|\\.)*[*+][^()]*\)(?:[*+]|\{\d+,?\d*\})/;
const REDOS_ADJACENT_QUANTIFIER = /(\\?[A-Za-z0-9.])[*+]\1[*+]/;

export function hasReDoSRisk(pattern: string): boolean {
  return REDOS_NESTED_GROUP.test(pattern) || REDOS_ADJACENT_QUANTIFIER.test(pattern);
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
