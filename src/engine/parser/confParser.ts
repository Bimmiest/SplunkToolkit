/**
 * Parser for Splunk .conf INI-style configuration files.
 *
 * Takes raw text from a props.conf or transforms.conf file and returns a
 * `ParsedConf` object containing an ordered list of stanzas (with their
 * directives) and any parse errors encountered along the way.
 */

import type {
  ConfDirective,
  ConfStanza,
  ParsedConf,
  ValidationDiagnostic,
} from '../types';
import { getCanonicalDirectiveKey } from '../directiveRegistry';

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches a stanza header: `[stanza-name]` */
const STANZA_RE = /^\[(.+)\]\s*$/;

/**
 * Matches a key/value directive.
 *
 * The key may not start with whitespace and the `=` may be surrounded by
 * optional whitespace.  The value extends to the end of the line (trailing
 * whitespace is preserved because Splunk does the same).
 */
const DIRECTIVE_RE = /^([^\s=][^=]*?)\s*=\s*(.*)$/;

/** Matches a comment line. Splunk .conf uses `#` only — `;` is not a comment. */
const COMMENT_RE = /^#/;

/** Matches a blank / whitespace-only line. */
const BLANK_RE = /^\s*$/;

// Splunk uses trailing backslash for line continuation (not leading whitespace).
// A line continues only when it ends with an ODD number of backslashes — an even
// count is escaped literal backslashes (e.g. a Windows path "C:\\dir\\"), not a
// continuation marker.
function endsWithContinuation(value: string): boolean {
  let count = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

// ---------------------------------------------------------------------------
// Class-based directive detection
// ---------------------------------------------------------------------------

/**
 * Directive prefixes that use the `PREFIX-<className>` convention in
 * props.conf / transforms.conf.
 */
const CLASS_DIRECTIVE_PREFIXES = [
  'EXTRACT',
  'REPORT',
  'LOOKUP',
  'FIELDALIAS',
  'EVAL',
  'SEDCMD',
  'TRANSFORMS',
] as const;

/**
 * Given a raw directive key like `EXTRACT-myfield`, split it into the
 * directive type (`EXTRACT`) and the class name (`myfield`).  If the key does
 * not match any known class-based prefix it returns the full key as the
 * directive type with no class name.
 *
 * The prefix comparison is case-SENSITIVE. Splunk attribute names are, so
 * `extract-f` is not `EXTRACT-f` — it is an unknown attribute a real indexer
 * silently ignores. Matching it case-insensitively made the simulator extract
 * fields from config that ships dead, and (because the key then carried a
 * `className`) skipped the very mis-case check that exists to catch this.
 * `miscasedPrefix` carries the canonical spelling so the caller can say so.
 */
function parseDirectiveKey(key: string): {
  directiveType: string;
  className?: string;
  miscasedPrefix?: string;
} {
  for (const prefix of CLASS_DIRECTIVE_PREFIXES) {
    if (key.length > prefix.length + 1 && key[prefix.length] === '-') {
      const candidatePrefix = key.slice(0, prefix.length);
      if (candidatePrefix === prefix) {
        return {
          directiveType: prefix,
          className: key.slice(prefix.length + 1),
        };
      }
      if (candidatePrefix.toUpperCase() === prefix) {
        return { directiveType: key, miscasedPrefix: prefix };
      }
    }
  }

  return { directiveType: key };
}

// ---------------------------------------------------------------------------
// Stanza classification helpers
// ---------------------------------------------------------------------------

/**
 * Determine the stanza type and extract the relevant pattern if applicable.
 */
function classifyStanza(
  name: string,
): Pick<ConfStanza, 'type' | 'sourcePattern' | 'hostPattern'> {
  if (name === 'default') {
    return { type: 'default' };
  }

  if (name.startsWith('source::')) {
    return {
      type: 'source',
      sourcePattern: name.slice('source::'.length),
    };
  }

  if (name.startsWith('host::')) {
    return {
      type: 'host',
      hostPattern: name.slice('host::'.length),
    };
  }

  // Everything else is a sourcetype stanza.
  return { type: 'sourcetype' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the raw text of a Splunk `.conf` file into a structured
 * representation.
 *
 * @param text     - The full text content of the configuration file.
 * @param fileName - Which file is being parsed (used in diagnostic messages).
 * @returns A `ParsedConf` with the parsed stanzas and any errors.
 */
export function parseConf(
  text: string,
  fileName: 'props.conf' | 'transforms.conf',
): ParsedConf {
  const lines = text.split(/\r?\n/);
  const stanzas: ConfStanza[] = [];
  const errors: ValidationDiagnostic[] = [];

  // The "current" stanza being accumulated.  Lines that appear before any
  // explicit stanza header are implicitly in a virtual [default] stanza.
  let currentStanza: ConfStanza | null = null;

  // Reference to the most recently parsed directive so we can handle
  // continuation lines.
  let lastDirective: ConfDirective | null = null;

  /**
   * Flush the current stanza into the results array and reset tracking state.
   */
  function flushStanza(endLine: number): void {
    if (currentStanza) {
      currentStanza.lineRange.end = endLine;
      stanzas.push(currentStanza);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-based

    // --- Comments ---
    if (COMMENT_RE.test(line)) {
      continue;
    }

    // --- Blank lines ---
    if (BLANK_RE.test(line)) {
      // Reset continuation tracking -- a blank line terminates continuation.
      lastDirective = null;
      continue;
    }

    // --- Stanza headers ---
    const stanzaMatch = STANZA_RE.exec(line);
    if (stanzaMatch) {
      // Flush the previous stanza (end on the line before this header).
      flushStanza(lineNumber - 1);

      const rawName = stanzaMatch[1].trim();
      const classification = classifyStanza(rawName);

      currentStanza = {
        name: rawName,
        ...classification,
        directives: [],
        lineRange: { start: lineNumber, end: lineNumber },
      };
      lastDirective = null;
      continue;
    }

    // --- Continuation lines (Splunk: previous directive value ends with a single \) ---
    if (lastDirective && endsWithContinuation(lastDirective.value)) {
      // Drop the continuation backslash and append the next line verbatim — Splunk
      // preserves the continuation line's leading whitespace (no trimStart).
      lastDirective.value = lastDirective.value.slice(0, -1) + line;
      continue;
    }

    // --- Directives (key = value) ---
    const directiveMatch = DIRECTIVE_RE.exec(line);
    if (directiveMatch) {
      const rawKey = directiveMatch[1].trim();
      const rawValue = directiveMatch[2];

      const { directiveType, className, miscasedPrefix } = parseDirectiveKey(rawKey);

      // A mis-cased class prefix (`extract-f`) is ignored by Splunk exactly like
      // a mis-cased plain attribute, and is the harder one to spot by eye.
      if (miscasedPrefix !== undefined) {
        const canonical = `${miscasedPrefix}${rawKey.slice(miscasedPrefix.length)}`;
        errors.push({
          level: 'warning',
          message: `"${rawKey}" is ignored — attribute names are case-sensitive. Did you mean "${canonical}"?`,
          file: fileName,
          line: lineNumber,
          directiveKey: rawKey,
          suggestion: `Change "${rawKey}" to "${canonical}".`,
        });
      }

      // Splunk attribute names are case-sensitive, so a mis-cased name (e.g.
      // `kv_mode` instead of `KV_MODE`) is silently ignored — the default applies.
      // Flag case-only mismatches (a canonical name exists but the casing differs)
      // so the config bug surfaces. Class directives (EXTRACT-*, …) have a className
      // and are skipped; unknown attributes return no canonical and are not flagged.
      if (className === undefined && miscasedPrefix === undefined) {
        const canonical = getCanonicalDirectiveKey(rawKey, fileName);
        if (canonical && canonical !== rawKey) {
          errors.push({
            level: 'warning',
            message: `"${rawKey}" is ignored — attribute names are case-sensitive. Did you mean "${canonical}"?`,
            file: fileName,
            line: lineNumber,
            directiveKey: rawKey,
            suggestion: `Change "${rawKey}" to "${canonical}".`,
          });
        }
      }

      const directive: ConfDirective = {
        key: rawKey,
        value: rawValue,
        line: lineNumber,
        directiveType,
        ...(className !== undefined ? { className } : {}),
      };

      // If no stanza has been opened yet, create an implicit [default].
      if (!currentStanza) {
        currentStanza = {
          name: 'default',
          type: 'default',
          directives: [],
          lineRange: { start: lineNumber, end: lineNumber },
        };
      }

      currentStanza.directives.push(directive);
      lastDirective = directive;
      continue;
    }

    // --- Malformed line ---
    // If we reach here the line is not a comment, blank, stanza header,
    // directive, or valid continuation.
    errors.push({
      level: 'error',
      message: `Malformed line: "${line.length > 80 ? line.slice(0, 80) + '...' : line}"`,
      file: fileName,
      line: lineNumber,
    });
    lastDirective = null;
  }

  // Flush the last stanza.
  flushStanza(lines.length);

  return { stanzas: mergeDuplicateStanzas(stanzas), errors };
}

/**
 * Splunk treats repeated stanzas with the same name in one file as a single
 * stanza (Admin manual, "How app configuration files work"). Concatenate their
 * directives in file order so later definitions win: within-stanza last-wins is
 * applied downstream (`mergeDirectives` for props; the transform readers take the
 * last REGEX/FORMAT/INGEST_EVAL for transforms).
 */
function mergeDuplicateStanzas(stanzas: ConfStanza[]): ConfStanza[] {
  const byKey = new Map<string, ConfStanza>();
  const order: ConfStanza[] = [];
  for (const stanza of stanzas) {
    const key = `${stanza.type} ${stanza.name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.directives.push(...stanza.directives);
      existing.lineRange.end = Math.max(existing.lineRange.end, stanza.lineRange.end);
    } else {
      const clone: ConfStanza = {
        ...stanza,
        directives: [...stanza.directives],
        lineRange: { ...stanza.lineRange },
      };
      byKey.set(key, clone);
      order.push(clone);
    }
  }
  return order;
}
