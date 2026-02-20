/**
 * Utilities for working with Splunk regex patterns.
 *
 * Handles safe compilation, validation, and conversion of Splunk-specific
 * pattern syntaxes (source:: and host:: patterns) into JavaScript RegExp objects.
 */

/**
 * Safely compile a regex pattern, returning null on invalid patterns
 * instead of throwing an exception.
 */
export function safeRegex(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Escape a string for use as a literal inside a regular expression.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a Splunk `source::` pattern to a JavaScript RegExp.
 *
 * Splunk source patterns use a glob-like syntax:
 *  - `...` matches any number of path segments (equivalent to `**` in globs,
 *    translated to `.*` in regex).
 *  - `*`   matches any characters within a single path segment (translated to
 *    `[^/\\]*` so it does not cross directory boundaries).
 *  - `?`   matches exactly one non-separator character.
 *  - All other characters are treated as literals and properly escaped.
 *
 * The returned regex is anchored (^ ... $) and case-insensitive to match
 * Splunk's behavior on case-insensitive file systems.
 */
export function sourcePatternToRegex(pattern: string): RegExp {
  // Tokenise so we can distinguish the special sequences from literals.
  // We split on the special tokens while keeping the delimiters.
  const tokens = pattern.split(/(\.\.\.|\*|\?)/);

  let regexStr = '^';
  for (const token of tokens) {
    switch (token) {
      case '...':
        // Match any characters including path separators
        regexStr += '.*';
        break;
      case '*':
        // Match any characters except path separators
        regexStr += '[^/\\\\]*';
        break;
      case '?':
        // Match exactly one non-separator character
        regexStr += '[^/\\\\]';
        break;
      default:
        regexStr += escapeRegex(token);
        break;
    }
  }
  regexStr += '$';

  return new RegExp(regexStr, 'i');
}

/**
 * Convert a Splunk `host::` pattern to a JavaScript RegExp.
 *
 * Host patterns are simpler than source patterns since there are no path
 * separators to worry about:
 *  - `*`  matches any sequence of characters.
 *  - `?`  matches exactly one character.
 *  - All other characters are literal.
 *
 * The returned regex is anchored and case-insensitive.
 */
export function hostPatternToRegex(pattern: string): RegExp {
  const tokens = pattern.split(/(\*|\?)/);

  let regexStr = '^';
  for (const token of tokens) {
    switch (token) {
      case '*':
        regexStr += '.*';
        break;
      case '?':
        regexStr += '.';
        break;
      default:
        regexStr += escapeRegex(token);
        break;
    }
  }
  regexStr += '$';

  return new RegExp(regexStr, 'i');
}

/**
 * Validate a regex pattern string.
 *
 * @returns An error message describing why the pattern is invalid, or `null`
 *          if the pattern compiles successfully.
 */
export function validateRegex(pattern: string): string | null {
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
