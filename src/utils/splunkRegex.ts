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
  if (hasReDoSRisk(pattern)) return null;
  try {
    return new RegExp(pattern, flags);
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
  if (hasReDoSRisk(pattern)) {
    return 'Pattern contains a structure prone to catastrophic backtracking (ReDoS risk).';
  }
  try {
    new RegExp(pattern);
    return null;
  } catch (e: unknown) {
    if (e instanceof SyntaxError) {
      return e.message;
    }
    return String(e);
  }
}
